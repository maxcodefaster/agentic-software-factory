/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { chromium, type BrowserContext, type Page } from '../example/node_modules/playwright';
import type { ApplicationsResponse, DeveloperWorkspace } from '@agentic-software-factory/api-contracts/applications';

const developerPassword = process.env.DEVELOPER_PASSWORD;
const developerEmail = process.env.DEVELOPER_EMAIL ?? 'implementer@example.test';
const businessPassword = process.env.BUSINESS_PASSWORD;
const systemId = process.env.FACTORY_SYSTEM_ID ?? 'factory/example';
if (!developerPassword || !businessPassword) throw new Error('developer and business passwords are required');

const factoryUrl = 'http://factory.localhost';
const browser = await chromium.launch({ headless: true });
try {
  const developer = await browser.newContext();
  const developerPage = await developer.newPage();
  await loginFactory(developerPage, developerEmail, developerPassword);
  let system = await activeSystem(developerPage);
  const workspaceResponse = await developerPage.evaluate(async ({ id, team }) => {
    const response = await fetch(`/api/v1/applications/${encodeURIComponent(id)}/workspace?team=${encodeURIComponent(team)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    return { status: response.status, body: await response.text() };
  }, { id: system.id, team: system.team });
  if (workspaceResponse.status >= 400) throw new Error(`developer workspace returned ${workspaceResponse.status}: ${workspaceResponse.body}`);
  let workspace = JSON.parse(workspaceResponse.body) as DeveloperWorkspace;
  const workspaceDeadline = Date.now() + 11 * 60 * 1_000;
  while (!workspace.ideUrl && Date.now() < workspaceDeadline) {
    await developerPage.waitForTimeout(2_000);
    const current = await activeSystem(developerPage);
    workspace = {
      workspaceId: current.workspaceId ?? workspace.workspaceId,
      workspaceUrl: current.workspaceUrl,
      ideUrl: current.ideUrl,
      terminalUrl: current.terminalUrl,
      servicesUrl: current.servicesUrl,
      apps: current.apps,
    };
  }
  system = await activeSystem(developerPage);
  const links = {
    ide: requiredUrl(workspace.ideUrl ?? system.ideUrl, 'IDE'),
  };

  const developerResult = {
    ide: await openCoderTarget(developer, links.ide, 'IDE', true),
  };
  for (const [name, result] of Object.entries(developerResult)) {
    if (result.status >= 400 || result.body.includes('Unable to fetch workspace') || result.body.includes('origin not allowed')) {
      throw new Error(`${name} handoff failed with ${result.status}: ${result.body.slice(0, 160)} ${JSON.stringify({ failures: result.failures, meStatus: result.meStatus, me: result.me })}`);
    }
  }

  const ide = new URL(links.ide);
  const redirect = ide.searchParams.get('redirect');
  const rawIde = redirect ? new URL(redirect, 'http://coder.localhost').toString() : ide.toString();
  const sharedApp = requiredUrl(system.apps[0]?.url, 'shared staging application');
  await developer.close();

  const business = await browser.newContext();
  const businessPage = await business.newPage();
  await loginFactory(businessPage, 'business@example.test', businessPassword);
  const businessSystem = await activeSystem(businessPage);
  if (businessSystem.ideUrl || businessSystem.terminalUrl || businessSystem.servicesUrl || businessSystem.workspaceUrl) {
    throw new Error('business user received developer workspace controls from Factory');
  }
  const businessApplication = await openCoderTarget(business, sharedApp, 'business staging');
  const businessIde = await openCoderTarget(business, rawIde, 'business IDE');
  const ideHost = new URL(rawIde).hostname;
  const businessReachedIde = new URL(businessIde.url).hostname === ideHost && businessIde.meStatus === 200;
  if (businessApplication.status >= 400 || businessReachedIde) {
    throw new Error(`business isolation failed: app=${businessApplication.status}, ide=${JSON.stringify(businessIde)}`);
  }
  await business.close();

  console.log(JSON.stringify({ developer: developerResult, business: { application: businessApplication.status, ide: businessIde.status } }));
} finally {
  await browser.close();
}

async function activeSystem(page: Page): Promise<ApplicationsResponse['applications'][number]> {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/v1/applications?team=factory');
    return { status: result.status, body: await result.text() };
  });
  if (response.status >= 400) throw new Error(`applications returned ${response.status}`);
  const systems = (JSON.parse(response.body) as ApplicationsResponse).applications;
  const system = systems.find((candidate) => candidate.id === systemId);
  if (!system) throw new Error('Factory returned no System');
  return system;
}

async function openCoderTarget(context: BrowserContext, url: string, name: string, expectProcessTerminal = false) {
  const page = await context.newPage();
  const failures: Array<{ status: number; url: string }> = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push({ status: response.status(), url: response.url() });
  });
  let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(1_000);
  if (new URL(page.url()).hostname === 'coder.localhost' && new URL(page.url()).pathname === '/login') {
    const oidc = page.getByRole('link', { name: /Agentic Software Factory anmelden|Sign in with Agentic Software Factory/i });
    if (await oidc.count()) {
      const previous = page.url();
      await oidc.click();
      await page.waitForURL((current) => current.toString() !== previous, { timeout: 90_000 });
      await page.waitForLoadState('domcontentloaded');
      response = null;
    }
  }
  await page.waitForTimeout(name === 'IDE' ? 8_000 : 1_500);
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
  const processTerminal = expectProcessTerminal ? await waitForProcessTerminal(page) : 0;
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/v2/users/me');
    return { status: response.status, body: response.ok ? await response.json() : null };
  });
  const result = { status: response?.status() ?? 200, url: page.url(), body, processTerminal, failures, meStatus: me.status, me: me.body };
  await page.close();
  return result;
}

async function waitForProcessTerminal(page: Page): Promise<number> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const found = await page.evaluate(() => [...document.querySelectorAll('[aria-label], [title]')]
      .some((element) => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`.includes('Dev: Processes')));
    if (found) return 1;
    await page.waitForTimeout(1_000);
  }
  return 0;
}

function requiredUrl(value: string | null | undefined, name: string): string {
  if (!value) throw new Error(`Factory returned no ${name} URL`);
  return value;
}

async function loginFactory(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${factoryUrl}/login`, { waitUntil: 'domcontentloaded' });
  const emailField = page.getByLabel(/Email|E-Mail/i);
  await emailField.waitFor({ state: 'visible' });
  await emailField.fill(email);
  await page.getByLabel(/Password|Passwort/i).fill(password);
  await page.getByRole('button', { name: /Sign in|Anmelden/i }).click();
  await page.waitForURL((url) => url.hostname === 'factory.localhost' && url.pathname !== '/login');
}
