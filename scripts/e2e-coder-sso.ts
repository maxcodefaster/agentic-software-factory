/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const factoryUrl = 'http://factory.localhost';
const coderUrl = 'http://coder.localhost';
const factorySignInTimeoutMs = 75_000;

export interface CoderAccessOptions {
  email: string;
  password: string;
  forgejo?: boolean;
}

async function main(): Promise<void> {
  const password = process.env.BUSINESS_PASSWORD;
  if (!password) throw new Error('missing business password');

  await establishCoderAccess({ email: 'business@example.test', password });
  console.log('Coder SSO preflight: 1/1');
}

export async function establishCoderAccess({ email, password, forgejo = false }: CoderAccessOptions): Promise<void> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      await establishCoderSso(context, page, email, password);
      if (forgejo) await establishForgejoAccess(context, page);
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch {
    throw new Error(forgejo ? 'Coder and Forgejo access setup failed' : 'Coder SSO setup failed');
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function establishCoderSso(context: BrowserContext, page: Page, email: string, password: string): Promise<void> {
  await signIntoFactory(page, email, password);
  await page.goto(`${coderUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 90_000 });

  const sso = page.getByRole('link', { name: /Mit Agentic Software Factory anmelden|Sign in with Agentic Software Factory/i });
  await sso.waitFor({ state: 'visible', timeout: 30_000 });
  await sso.click();
  await finishOidcFlow(page);

  const response = await context.request.get(`${coderUrl}/api/v2/users/me`, { timeout: 30_000 });
  if (!response.ok()) throw new Error('Coder session verification failed');
  const user = await response.json() as { email?: unknown };
  if (typeof user.email !== 'string' || user.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error('Coder session belongs to the wrong persona');
  }
}

async function signIntoFactory(page: Page, email: string, password: string): Promise<void> {
  const deadline = Date.now() + factorySignInTimeoutMs;
  let rateLimitCount = 0;
  while (Date.now() < deadline) {
    const loaded = await page.goto(`${factoryUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (loaded?.status() === 429) {
      await waitForRateLimit(page, loaded.headers()['retry-after'], rateLimitCount, deadline);
      rateLimitCount += 1;
      continue;
    }

    await page.getByLabel(/Email|E-Mail/i).fill(email);
    await page.getByLabel(/Password|Passwort/i).fill(password);
    const submitted = page.waitForResponse((response) => new URL(response.url()).pathname === '/sign-in/email');
    await page.getByRole('button', { name: /Sign in|Anmelden/i }).click();
    const response = await submitted;
    if (response.status() === 429) {
      await waitForRateLimit(page, response.headers()['retry-after'], rateLimitCount, deadline);
      rateLimitCount += 1;
      continue;
    }
    if (!response.ok()) throw new Error('Factory sign-in failed');
    await page.waitForURL((url) => url.hostname === 'factory.localhost' && url.pathname !== '/login', { timeout: 30_000 });
    return;
  }
  throw new Error('Factory sign-in was rate limited');
}

async function establishForgejoAccess(context: BrowserContext, page: Page): Promise<void> {
  await page.goto(`${coderUrl}/external-auth/forgejo`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await forgejoAuthenticated(context)) break;

    const current = new URL(page.url());
    if (current.hostname === 'forgejo-factory.localhost') {
      const factorySignIn = page.getByRole('link', { name: /^(Sign in with Factory|Anmelden mit Factory)$/i })
        .or(page.getByRole('button', { name: /^(Sign in with Factory|Anmelden mit Factory)$/i })).first();
      if (await factorySignIn.isVisible().catch(() => false)) {
        await factorySignIn.click();
        continue;
      }

      const authorize = page.getByRole('button', { name: /^(Authorize Application|Authorize|Anwendung autorisieren|Autorisieren)$/i }).first();
      if (await authorize.isVisible().catch(() => false)) {
        await authorize.click();
        continue;
      }
    }
    if (current.hostname === 'factory.localhost' && current.pathname === '/consent') {
      const allow = page.getByRole('button', { name: /^(Allow|Erlauben)$/i }).first();
      if (await allow.isVisible().catch(() => false)) {
        await allow.click();
        continue;
      }
    }
    await page.waitForTimeout(250);
  }

  if (!await forgejoAuthenticated(context)) throw new Error('Coder external authentication failed');
}

async function forgejoAuthenticated(context: BrowserContext): Promise<boolean> {
  const response = await context.request.get(`${coderUrl}/api/v2/external-auth/forgejo`, { timeout: 30_000 }).catch(() => null);
  if (!response) return false;
  if (!response.ok()) return false;
  const body = await response.json().catch(() => null) as { authenticated?: unknown } | null;
  return body?.authenticated === true;
}

async function finishOidcFlow(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  let consentSubmitted = false;
  while (Date.now() < deadline) {
    const current = new URL(page.url());
    if (current.hostname === 'coder.localhost' && current.pathname !== '/login' && current.pathname !== '/api/v2/users/oidc/callback') return;
    if (!consentSubmitted && current.hostname === 'factory.localhost' && current.pathname === '/consent') {
      const allow = page.getByRole('button', { name: /Allow|Erlauben/i });
      if (await allow.isVisible().catch(() => false)) {
        await allow.click();
        consentSubmitted = true;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error('Coder SSO did not complete');
}

async function waitForRateLimit(page: Page, retryAfter: string | undefined, count: number, deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  const boundedDelay = Math.min(5_000, 1_000 * 2 ** Math.min(count, 3));
  await page.waitForTimeout(Math.min(Math.max(retryAfterMs(retryAfter), boundedDelay), remaining));
}

function retryAfterMs(value: string | undefined): number {
  if (!value) return 0;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  return Math.max(0, Number.isFinite(parsed) ? parsed : 0);
}

if (import.meta.main) {
  await main().catch(() => {
    console.error('Coder SSO preflight failed');
    process.exitCode = 1;
  });
}
