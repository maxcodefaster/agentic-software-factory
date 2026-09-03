// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { describe, expect, test } from "bun:test";
import { checkCommands, deployCommands, downCommands, e2eCommands, parseCommand, pruneCommands, run, statusCommands, subcommands, upCommands, type Command } from "./factory";

describe("factory command", () => {
  test("exposes and validates lifecycle commands", () => {
    expect(subcommands).toEqual(["up", "down", "deploy", "prune", "reset", "status", "check", "e2e"]);
    expect(() => parseCommand([])).toThrow();
    expect(() => parseCommand(["reset"])).toThrow();
    expect(parseCommand(["reset", "--data", "--dry-run"])).toEqual({ command: "reset", args: ["--data", "--dry-run"] });
    expect(parseCommand(["deploy", "--dry-run"])).toEqual({ command: "deploy", args: ["--dry-run"] });
    expect(() => parseCommand(["status", "extra"])).toThrow();
    expect(parseCommand(["up"])).toEqual({ command: "up", args: ["./example"] });
    expect(() => parseCommand(["up", "one", "two"])).toThrow();
    expect(parseCommand(["up", "example"])).toEqual({ command: "up", args: ["example"] });
  });

  test("passes the data acknowledgement to direct maintenance", async () => {
    const commands: Command[] = [];
    expect(await run(["reset", "--data", "--dry-run"], async (command) => { commands.push(command); return { exitCode: 0 }; })).toBe(0);
    expect(commands[0]?.argv).toEqual(["bun", "scripts/local-maintenance.ts", "reset", "--data", "--dry-run"]);
  });

  test("status is Kubernetes-only and read-only", async () => {
    const forbidden = /\b(apply|create|delete|patch|replace|scale|stop|down|rm|exec|rollout|annotate)\b/;
    expect(statusCommands.every(({ argv }) => !forbidden.test(argv.join(" ")))).toBe(true);
    expect(statusCommands[0]?.argv.join(" ")).toContain("kubectl config current-context");
    expect(statusCommands.map(({ argv }) => argv.join(" ")).join(" ")).toContain("kubectl get cluster");
    expect(statusCommands.map(({ argv }) => argv.join(" ")).join(" ")).toContain("kubectl get certificate factory-tls");
    expect(statusCommands.map(({ argv }) => argv.join(" ")).join(" ")).toContain("/healthz");
    expect(statusCommands.map(({ argv }) => argv.join(" ")).join(" ")).toContain("/readyz");
    expect(statusCommands.map(({ argv }) => argv.join(" ")).join(" ")).not.toContain("/statusz");
    const code = await run(["status"], async () => ({ exitCode: 0 }));
    expect(code).toBe(0);
  });

  test("smoke authenticates the admin-only status endpoint", async () => {
    const smoke = await Bun.file(new URL("smoke.sh", import.meta.url)).text();
    const command = e2eCommands.find(({ component }) => component === "smoke")?.argv.join(" ") ?? "";
    expect(smoke).toContain('curl -fsS -b "$admin_cookie_jar" "$factory_url/statusz"');
    expect(smoke).toContain('SMOKE_ADMIN_PASSWORD:?SMOKE_ADMIN_PASSWORD is required');
    expect(command).toContain("SMOKE_ADMIN_PASSWORD=$(kubectl get secret factory-auth");
    expect(command).toContain("bootstrap-user-password");
  });

  test("down stops the stack without removing resources", () => {
    const commands = downCommands.map(({ argv }) => argv.join(" "));
    expect(commands).toEqual(["./deploy/local/down.sh"]);
    expect(commands.join(" ")).not.toMatch(/\b(delete|destroy|rm|prune)\b/);
  });

  test("deploy and prune expose dry-runs without invoking up phases", () => {
    expect(deployCommands(true)[0]?.argv).toEqual(["./deploy/local/deploy-factory.sh", "--dry-run"]);
    expect(pruneCommands(true)[0]?.argv).toEqual(["bun", "scripts/local-maintenance.ts", "prune", "--dry-run"]);
    const deploy = deployCommands().flatMap((command) => command.argv).join(" ");
    expect(deploy).not.toMatch(/prerequisite|coder|forgejo|template|onboarding/);
  });

  test("up reconciles components without phase or model runners", () => {
    const commands = upCommands("example-system").map(({ argv }) => argv.join(" ")).join("\n");
    expect(commands).not.toContain(["local", "up.sh"].join("-"));
    expect(commands).not.toContain(["provision", "local", "stack.sh"].join("-"));
    expect(commands).not.toContain(["configure", "coder", "model"].join("-"));
    expect(commands).not.toContain(["factory", "provision", "state"].join("-"));
    expect(commands).toContain("install-local-prerequisites.sh");
    expect(commands).toContain("bootstrap-forgejo.sh");
    expect(upCommands("example-system").find(({ component }) => component === "coder")).toEqual({ component: "coder", argv: [], operation: "reconcile-coder" });
    expect(commands).not.toContain("reconcile-coder.sh");
    expect(commands).toContain("push-coder-template.sh");
    expect(commands).toContain("local-secrets.ts");
    expect(commands).toContain("reconcile-secret-rollout.sh forgejo");
    expect(commands).toContain("reconcile-secret-rollout.sh coder");
    expect(commands).toContain("deploy-factory.sh --full-stack");
    expect(commands).toContain("onboarding/register");
    expect(commands).toContain('test "$code" = 202');
    expect(commands).not.toContain("current_checksum");
    expect(commands).toContain("coder-template-identity.sh");
    expect(commands).not.toContain("for file in main.tf README.md workspace-clone.sh");
    expect(commands).not.toContain('kubectl label namespace "$namespace"');
    expect(commands).toContain("factory.application/local-stack-owner");
    expect(commands).toContain("Refusing to use pre-existing namespace without Factory local-stack identity");
    expect(commands).toContain("kubectl get secret coder-forgejo-external-auth -n coder");
    expect(commands).toContain("kubectl create secret generic coder-forgejo-external-auth -n coder");
    expect(commands).not.toContain("git diff --binary");
  });

  test("accepts asynchronous onboarding registration", () => {
    const onboarding = upCommands("example-system").find(({ component }) => component === "onboarding")?.argv.join(" ") ?? "";
    expect(onboarding).toContain('test "$code" = 202');
    expect(onboarding).not.toContain('test "$code" = 201');
  });

  test("derives custom development image tags from source", async () => {
    const script = new URL("../deploy/local/resolve-dev-image.sh", import.meta.url).pathname;
    expect((await Bun.$`sh ${script} registry.example/team/factory:dev abc123`.text()).trim()).toBe("registry.example/team/factory:dev-abc123");
    expect((await Bun.$`sh ${script} registry.example:5000/team/factory abc123`.text()).trim()).toBe("registry.example:5000/team/factory:abc123");
  });

  test("checks omit root orchestration, include every local contract, and omit example release checks", async () => {
    const commands = checkCommands.map(({ argv }) => argv.join(" ")).join("\n");
    expect(commands).not.toContain(["release", "check"].join(":"));
    expect(commands).toContain("bun run api:check");
    const tests = Array.from(new Bun.Glob("*.sh").scanSync(new URL("../deploy/local/tests", import.meta.url).pathname)).sort();
    for (const test of tests) expect(commands).toContain(`deploy/local/tests/${test}`);
  });

  test("development image context digest covers HEAD, staged, unstaged, and untracked source", async () => {
    const source = await Bun.$`mktemp -d`.text().then((value) => value.trim());
    const context = await Bun.$`mktemp -d`.text().then((value) => value.trim());
    try {
      await Bun.$`mkdir -p ${source}/apps/bff/src ${source}/deploy/local ${source}/packages/api-contracts ${source}/packages/db ${source}/packages/design-system ${source}/web`;
      await Bun.write(`${source}/apps/bff/src/main.ts`, "head\n");
      await Bun.write(`${source}/apps/bff/Dockerfile`, "FROM scratch\n");
      await Bun.write(`${source}/deploy/local/bootstrap-users.ts`, "export {};\n");
      await Bun.write(`${source}/packages/db/package.json`, "{}\n");
      await Bun.write(`${source}/packages/db/schema.ts`, "export {};\n");
      for (const file of [".dockerignore", "package.json", "bun.lock", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES"]) await Bun.write(`${source}/${file}`, `${file}\n`);
      await Bun.$`git -C ${source} init -q`;
      await Bun.$`git -C ${source} config user.name contract`;
      await Bun.$`git -C ${source} config user.email contract@example.invalid`;
      await Bun.$`git -C ${source} add --all`;
      await Bun.$`git -C ${source} commit -q -m head`;
      const digest = async () => (await Bun.$`sh ${new URL("prepare-dev-image-context.sh", import.meta.url).pathname} ${source} ${context}`.text()).trim();
      const head = await digest();
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      await Bun.write(`${source}/package.json`, "staged\n"); await Bun.$`git -C ${source} add package.json`;
      const staged = await digest();
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      await Bun.write(`${source}/apps/bff/src/main.ts`, "unstaged\n");
      const unstaged = await digest();
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      await Bun.write(`${source}/apps/bff/src/untracked.ts`, "untracked\n");
      const untracked = await digest();
      expect(new Set([head, staged, unstaged, untracked]).size).toBe(4);
      expect(await Bun.file(`${context}/apps/bff/src/untracked.ts`).text()).toBe("untracked\n");
      expect(await Bun.file(`${context}/packages/db/schema.ts`).text()).toBe("export {};\n");
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      expect(await digest()).toBe(untracked);
      await Bun.$`chmod 755 ${source}/apps/bff/src/main.ts`;
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      const executable = await digest();
      expect(executable).not.toBe(untracked);
      await Bun.$`chmod 644 ${source}/apps/bff/src/main.ts`;
      await Bun.write(`${source}/apps/bff/.npmrc`, "//registry.example.invalid/:_authToken=secret\n");
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      expect(digest()).rejects.toThrow();
      expect(await Bun.file(`${context}/apps/bff/.npmrc`).exists()).toBe(false);
      await Bun.$`rm ${source}/apps/bff/.npmrc`;
      await Bun.write(`${source}/apps/bff/src/release-secret.txt`, "secret\n");
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      expect(digest()).rejects.toThrow();
      expect(await Bun.file(`${context}/apps/bff/src/release-secret.txt`).exists()).toBe(false);
    } finally {
      await Bun.$`rm -rf ${source} ${context}`;
    }
  }, 20_000);

  test("development image context digest covers intent-to-add files before the first commit", async () => {
    const source = await Bun.$`mktemp -d`.text().then((value) => value.trim());
    const context = await Bun.$`mktemp -d`.text().then((value) => value.trim());
    try {
      await Bun.$`mkdir -p ${source}/apps/bff ${source}/deploy/local ${source}/packages/api-contracts ${source}/packages/db ${source}/packages/design-system ${source}/web`;
      for (const file of [".dockerignore", "package.json", "bun.lock", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES", "apps/bff/package.json", "deploy/local/bootstrap-users.ts"]) {
        await Bun.write(`${source}/${file}`, `${file}\n`);
      }
      await Bun.$`git -C ${source} init -q`;
      await Bun.$`git -C ${source} add -N .`;
      const digest = async () => (await Bun.$`sh ${new URL("prepare-dev-image-context.sh", import.meta.url).pathname} ${source} ${context}`.text()).trim();
      const before = await digest();
      await Bun.$`rm -rf ${context}`; await Bun.$`mkdir ${context}`;
      await Bun.write(`${source}/deploy/local/bootstrap-users.ts`, "changed\n");
      expect(await digest()).not.toBe(before);
    } finally {
      await Bun.$`rm -rf ${source} ${context}`;
    }
  });

  test("no command uses the removed root container orchestrator", () => {
    const commands = [...statusCommands, ...downCommands, ...upCommands("example-system"), ...checkCommands]
      .map(({ argv }) => argv.join(" "))
      .join("\n");
    expect(commands).not.toContain(["docker", "compose"].join(" "));
  });

  test("e2e runs status as its preflight", async () => {
    const seen: Command[] = [];
    const code = await run(["e2e"], async (command) => {
      seen.push(command);
      return { exitCode: command.component === "factory-ready" ? 1 : 0 };
    });
    expect(code).toBe(1);
    const preflight = statusCommands.map(({ component }) => component);
    expect(seen.map(({ component }) => component)).toEqual(preflight.slice(0, preflight.indexOf("factory-ready") + 1));
  });

  test("e2e runs the real lifecycle before browser checks with Kubernetes secrets", () => {
    const components = e2eCommands.map(({ component }) => component);
    expect(components).not.toContain("interview");
    expect(components.indexOf("lifecycle")).toBe(components.indexOf("coder-sso") + 1);
    expect(components.indexOf("lifecycle")).toBeLessThan(components.indexOf("browser"));
    const lifecycle = e2eCommands.find(({ component }) => component === "lifecycle")?.argv.join(" ") ?? "";
    expect(lifecycle).toContain("bun scripts/e2e-lifecycle.ts");
    expect(lifecycle).toContain("ADMIN_PASSWORD=$(kubectl get secret factory-auth");
    expect(lifecycle).toContain("bootstrap-user-password");
    expect(lifecycle).toContain("e2e-business-password");
    expect(lifecycle).toContain("forgejo-token");
    expect(lifecycle).toContain("FACTORY_SYSTEM_ID=");
    expect(lifecycle).toContain("length == 1");
  });

  test("e2e establishes business Coder SSO after persona checks and before lifecycle", () => {
    const components = e2eCommands.map(({ component }) => component);
    expect(components.indexOf("coder-sso")).toBe(components.indexOf("personas") + 1);
    expect(components.indexOf("lifecycle")).toBe(components.indexOf("coder-sso") + 1);

    const coderSso = e2eCommands.find(({ component }) => component === "coder-sso")?.argv.join(" ") ?? "";
    expect(coderSso).toContain("bun scripts/e2e-coder-sso.ts");
    expect(coderSso).toContain("BUSINESS_PASSWORD=$(kubectl get secret factory-auth");
    expect(coderSso).not.toContain("ADMIN_PASSWORD=$(kubectl get secret factory-auth");
    expect(coderSso).not.toContain("DEVELOPER_PASSWORD=$(kubectl get secret factory-auth");
    expect(coderSso).not.toContain("bootstrap-user-password");
    expect(coderSso).toContain("e2e-business-password");
    expect(coderSso).not.toContain("e2e-developer-password");
    expect(coderSso).not.toContain("coder-token");
    expect(coderSso).not.toContain("factory-runtime");
  });
});

test("mise defines only the public task names", async () => {
  const mise = await Bun.file(new URL("../mise.toml", import.meta.url)).text();
  const names = [...mise.matchAll(/^\[tasks(?:\.([a-z0-9]+)|\."([^"]+)")\]$/gm)].map((match) => match[1] ?? match[2]);
  expect(names).toEqual(["up", "down", "deploy", "prune", "reset", "status", "check", "e2e"]);
  expect([...mise.matchAll(/^run = "([^"]+)"$/gm)].map((match) => match[1])).toEqual(
    names.map((name) => `bun scripts/factory.ts ${name}`),
  );
  expect(mise).not.toContain("usage_");
});
