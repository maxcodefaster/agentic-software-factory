/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, type Browser, type ConsoleMessage } from 'playwright';

import { SPA_CONTENT_SECURITY_POLICY } from './boundary';

const webRoot = join(import.meta.dir, '../../../../web/dist/portal/browser');
const capabilities = {
  boardRead: true, requirementsCreate: false, requirementsEdit: false, requirementsClose: false,
  requirementsMove: false, requirementsInterview: false, requirementsPropose: false, requirementsAccept: false,
  applicationsRead: true, developerWorkspaceCreate: false, implementationRead: false, implementationStart: false,
  implementationPrepare: false, implementationReview: false, implementationComplete: false,
  monitoringRead: false, applicationsManage: false,
};
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

describe('SPA browser CSP', () => {
  beforeAll(async () => {
    if (!await Bun.file(join(webRoot, 'index.html')).exists()) {
      throw new Error('build the web app before running the SPA browser CSP test');
    }
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/api/v1/session') return Response.json({
          id: 'browser-test', email: 'browser@example.test', displayName: 'Browser Test', initials: 'BT',
          teams: ['factory'], ownerTeams: [], admin: false, personas: ['business'], capabilities,
        });
        if (url.pathname === '/auth/config') return Response.json({
          localEmailPassword: true, organizationSignIn: true, postLoginRedirect: '/',
        }, { headers: { 'cache-control': 'no-store' } });
        if (url.pathname === '/branding.css') return new Response('', { headers: { 'content-type': 'text/css' } });
        const path = ['/', '/login', '/consent'].includes(url.pathname) ? 'index.html' : url.pathname.slice(1);
        const file = Bun.file(join(webRoot, path));
        if (!await file.exists()) return new Response('not found', { status: 404 });
        return new Response(file, {
          headers: {
            'content-type': file.type,
            'content-security-policy': SPA_CONTENT_SECURITY_POLICY,
          },
        });
      },
    });
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  test('applies dynamically inserted Angular component styles without script CSP violations', async () => {
    const page = await browser.newPage();
    const violations: ConsoleMessage[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().toLowerCase().includes('content security policy')) violations.push(message);
    });

    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('factory-root').waitFor();

    expect(await page.locator('factory-root').evaluate((element) => getComputedStyle(element).display)).toBe('block');
    expect(await page.locator('head style').count()).toBeGreaterThan(0);
    expect(violations.map((message) => message.text())).toEqual([]);
    await page.close();
  }, 30_000);

  test('renders the Angular login route under the SPA CSP', async () => {
    const page = await browser.newPage();
    const violations: ConsoleMessage[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().toLowerCase().includes('content security policy')) violations.push(message);
    });

    await page.goto(`http://127.0.0.1:${server.port}/login?return_to=%2F`, { waitUntil: 'domcontentloaded' });
    await page.locator('factory-login').waitFor();

    expect(await page.getByRole('button').count()).toBeGreaterThan(0);
    expect(violations.map((message) => message.text())).toEqual([]);
    await page.close();
  }, 30_000);
});
