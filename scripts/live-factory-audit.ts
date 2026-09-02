/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const passwords = {
  admin: process.env.ADMIN_PASSWORD,
  business: process.env.BUSINESS_PASSWORD,
  developer: process.env.DEVELOPER_PASSWORD,
};
const expectedRequirementTitle = process.env.EXPECTED_REQUIREMENT_TITLE?.trim() || "";
if (Object.values(passwords).some((password) => !password))
  throw new Error("persona passwords are required");
const preflight = await fetch('http://factory.localhost/healthz', { signal: AbortSignal.timeout(10_000) });
if (!preflight.ok) throw new Error(`Factory preflight returned ${preflight.status}`);
await preflight.body?.cancel();

const personas = {
  admin: "developer@example.test",
  business: "business@example.test",
  developer: "implementer@example.test",
} as const;
const viewports = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
} as const;
const locales = ["en", "de"] as const;
const evidence: unknown[] = [];
const browser = await chromium.launch({
  headless: true,
});

try {
  for (const [persona, email] of Object.entries(personas)) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: viewports.desktop });
    const page = await context.newPage();
    const errors = observe(page);
    const password = passwords[persona as keyof typeof passwords];
    if (!password) throw new Error(`missing password for ${persona}`);
    await login(page, email, password);
    const session = await page.request
      .get("http://factory.localhost/api/v1/session")
      .then((response) => response.json());
    for (const locale of locales) {
      await page.evaluate((value) => localStorage.setItem("factory-locale-v2", value), locale);
      for (const [viewportName, viewport] of Object.entries(viewports)) {
        await page.setViewportSize(viewport);
        for (const team of ["factory", "platform"]) {
          errors.console.length = 0;
          errors.page.length = 0;
          errors.requests.length = 0;
          await page.goto(`http://factory.localhost/?team=${team}`, {
            waitUntil: "networkidle",
          });
          const audit = await page.evaluate(() => ({
            title: document.title,
            locale: document.documentElement.lang,
            mainCount: document.querySelectorAll("main").length,
            unnamedButtons: [...document.querySelectorAll("button")].filter(
              (button) =>
                !(
                  button.textContent?.trim() || button.getAttribute("aria-label")
                ),
            ).length,
            imagesWithoutAlt: [...document.querySelectorAll("img")].filter(
              (image) => !image.hasAttribute("alt"),
            ).length,
            horizontalOverflow:
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            duplicateIds: [...document.querySelectorAll("[id]")]
              .map((element) => element.id)
              .filter((id, index, all) => all.indexOf(id) !== index),
            bodyText: document.body.innerText,
            systemHeaderRows: document.querySelectorAll('[data-system-header-row]').length,
            systemHeaderIsCard: document.querySelector('[data-system-header]')?.classList.contains('factory-card') ?? false,
            ideActions: [...document.querySelectorAll('button, a')].filter((element) => /System-IDE starten oder öffnen|Start or open System IDE/.test(element.textContent ?? '')).length,
          }));
          const accessibility = await new AxeBuilder({ page }).analyze();
          const seriousViolations = accessibility.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
          const expectedPersona =
            persona === "admin"
              ? ["business", "developer"]
              : [persona];
          const personaControls = {
            canCreate: session.capabilities.requirementsCreate,
            canDevelop: session.capabilities.implementationStart,
            canAdminister: session.capabilities.applicationsManage,
          };
          const row = {
            persona,
            locale,
            viewport: viewportName,
            team,
            sessionPersonas: session.personas,
            title: audit.title,
            mainCount: audit.mainCount,
            unnamedButtons: audit.unnamedButtons,
            imagesWithoutAlt: audit.imagesWithoutAlt,
            horizontalOverflow: audit.horizontalOverflow,
            duplicateIds: audit.duplicateIds,
            personaControls,
            systemHeaderRows: audit.systemHeaderRows,
            systemHeaderIsCard: audit.systemHeaderIsCard,
            ideActions: audit.ideActions,
            completedRequirementVisible: expectedRequirementTitle
              ? team === "factory" && audit.bodyText.includes(expectedRequirementTitle)
              : null,
            consoleErrors: [...errors.console],
            pageErrors: [...errors.page],
            requestFailures: [...errors.requests],
            accessibilityViolations: seriousViolations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length })),
          };
          evidence.push(row);
          if (
            JSON.stringify([...session.personas].sort()) !==
              JSON.stringify(expectedPersona.sort()) ||
            audit.locale !== locale ||
            audit.mainCount !== 1 ||
            audit.unnamedButtons !== 0 ||
            audit.imagesWithoutAlt !== 0 ||
            audit.horizontalOverflow > 1 ||
            audit.duplicateIds.length > 0 ||
            audit.systemHeaderRows !== (team === 'factory' ? 2 : 0) ||
            audit.systemHeaderIsCard ||
            audit.ideActions !== (personaControls.canDevelop && team === 'factory' ? 1 : 0) ||
            errors.page.length > 0 ||
            seriousViolations.length > 0 ||
            errors.requests.some((failure) => failure.status >= 500)
          )
            process.exitCode = 1;
          if (
            (expectedPersona.includes("business") || expectedPersona.includes("developer")) !== personaControls.canCreate ||
            expectedPersona.includes("developer") !==
              personaControls.canDevelop ||
            (expectedPersona.includes("admin") || expectedPersona.includes("developer")) !== personaControls.canAdminister ||
            (expectedRequirementTitle && team === "factory" && !audit.bodyText.includes(expectedRequirementTitle))
          )
            process.exitCode = 1;
          await verifySystemMenu(page, personaControls.canAdminister);
        }
      }
    }
    await verifyLogout(page);
    await context.close();
  }
} finally {
  await browser.close();
}

async function verifySystemMenu(page: Page, canAdminister: boolean): Promise<void> {
  const trigger = page.getByRole('button', { name: /System auswählen|Select System/i });
  if (canAdminister) {
    if (await trigger.count() !== 1) throw new Error('System management is not reachable');
    await trigger.click();
    const create = page.getByRole('button', { name: /Neues System erstellen|Create new System/i });
    await create.waitFor({ state: 'visible' });
    await create.press('Escape');
    await page.locator('[data-outside-click]').waitFor({ state: 'detached' });
  } else if (await page.getByRole('button', { name: /Neues System erstellen|Create new System/i }).count() !== 0) {
    throw new Error('System onboarding is visible without permission');
  }
}

async function verifyLogout(page: Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  await page.getByTestId('account-menu').click();
  const menu = page.getByTestId('account-dropdown');
  await menu.waitFor({ state: 'visible' });
  const submitted = page.waitForResponse((response) => response.url().includes('/auth/logout'));
  await Promise.all([submitted, menu.getByRole('menuitem', { name: /Sign out|Abmelden/ }).click()]);
  const logoutStatus = (await submitted).status();
  if (logoutStatus >= 400) throw new Error(`logout returned ${logoutStatus}`);
  let sessionStatus = 0;
  while (Date.now() < deadline) {
    sessionStatus = (await page.request.get('http://factory.localhost/api/v1/session')).status();
    if (sessionStatus === 401) break;
    await page.waitForTimeout(250);
  }
  if (sessionStatus !== 401) throw new Error(`logout failed with session ${sessionStatus}`);
}

await mkdir("artifacts/live-factory-audit", { recursive: true });
await Bun.write(
  "artifacts/live-factory-audit/evidence.json",
  JSON.stringify(evidence, null, 2),
);
if (evidence.length !== 24) throw new Error(`expected 24 audit cases, got ${evidence.length}`);
console.log(
  JSON.stringify({ cases: evidence.length, failed: process.exitCode === 1 }),
);

async function login(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await page.goto("http://factory.localhost/login", { waitUntil: "domcontentloaded" });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()['retry-after'] ?? '1');
    await page.waitForTimeout(Math.max(1, retryAfter) * 1_000);
  }
  const emailField = page.getByLabel(/Email|E-Mail/i);
  await emailField.waitFor({ state: 'visible' });
  if (await emailField.count() !== 1) {
    throw new Error(`Factory login form is unavailable at ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 200)}`);
  }
  await emailField.fill(email);
  await page.getByLabel(/Password|Passwort/i).fill(password);
  const submit = page.getByRole("button", { name: /Sign in|Anmelden/i });
  const submitted = page.waitForResponse((response) => response.url().includes('/sign-in/email'));
  await submit.click();
  const response = await submitted;
  if (!response.ok()) throw new Error(`Factory sign-in returned ${response.status()}`);
  await page.waitForURL((url) => url.hostname === "factory.localhost" && url.pathname !== "/login");
}

function observe(page: Page) {
  const value = {
    console: [] as string[],
    page: [] as string[],
    requests: [] as Array<{ url: string; status: number }>,
  };
  page.on("console", (message) => {
    if (message.type() === "error") value.console.push(message.text());
  });
  page.on("pageerror", (error) => value.page.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500)
      value.requests.push({ url: response.url(), status: response.status() });
  });
  return value;
}
