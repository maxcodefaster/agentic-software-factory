// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { describe, expect, test } from "bun:test";
import { reconcileCoder, type Exec, type ExecOptions, type Http } from "./reconcile-coder";

type Invocation = { argv: readonly string[]; options?: ExecOptions };

const encoded = (value: string) => Buffer.from(value).toString("base64");
const response = (body: unknown, status = 200) => Response.json(body, { status });

function harness(options: { healthy?: boolean; factoryHealthy?: boolean; users?: string[]; current?: string; cluster?: boolean; buildInfo?: boolean; deployment?: boolean } = {}) {
  const invocations: Invocation[] = [];
  const requests: string[] = [];
  const healthy = options.healthy ?? true;
  const users = options.users ?? ["factory-verification", "factory-stage"];
  const exec: Exec = async (argv, execOptions) => {
    invocations.push({ argv, options: execOptions });
    const command = argv.join(" ");
    if (command.includes("factory-runtime") && command.includes("coder-token")) return { exitCode: 0, stdout: encoded("owner-token"), stderr: "" };
    if (command.includes("coder-postgres-app")) return { exitCode: 0, stdout: encoded("postgres://coder"), stderr: "" };
    if (command.startsWith("kubectl get cluster")) return { exitCode: options.cluster === false ? 1 : 0, stdout: "", stderr: "" };
    if (command.startsWith("kubectl get deployment coder")) return { exitCode: options.deployment === false ? 1 : 0, stdout: `ghcr.io/coder/coder:${options.current ?? "v2.37.0"}`, stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const http: Http = async (url, init) => {
    const parsed = new URL(url);
    requests.push(`${init?.headers ? "authenticated " : ""}${parsed.host}${parsed.pathname}${parsed.search}`);
    if (parsed.hostname === "factory.localhost") return new Response("ok", { status: options.factoryHealthy === false ? 503 : 200 });
    if (parsed.pathname === "/api/v2/buildinfo") {
      if (options.buildInfo === false) throw new Error("Coder is unreachable");
      return response({ version: options.current ?? "v2.37.0+build" });
    }
    if (parsed.pathname === "/api/v2/users/me") return response({}, healthy ? 200 : 401);
    if (parsed.pathname === "/api/v2/users") {
      const username = parsed.searchParams.get("q") ?? "";
      return response({ users: users.includes(username) ? [{ username }] : [] });
    }
    if (parsed.pathname === "/healthz") return new Response("ok");
    throw new Error(`unexpected request ${url}`);
  };
  return { invocations, requests, exec, http };
}

describe("Coder reconciliation", () => {
  test("keeps a healthy current installation on the normal Helm values", async () => {
    const run = harness();
    await reconcileCoder({ exec: run.exec, http: run.http, sleep: async () => {} });

    const helm = run.invocations.filter(({ argv }) => argv[0] === "helm");
    expect(helm).toHaveLength(1);
    expect(helm[0]?.argv).toContain("2.37.0");
    expect(helm[0]?.argv.some((arg) => arg.endsWith("coder-bootstrap-values.yaml"))).toBe(false);
    const owners = run.invocations.filter(({ argv }) => argv[0]?.endsWith("bootstrap-coder-verification.sh"));
    expect(owners.map(({ options }) => options?.env)).toEqual([
      { CODER_TOKEN: "owner-token" },
      { CODER_TOKEN: "owner-token", FACTORY_CODER_AUTOMATION_KIND: "staging" },
    ]);
    expect(run.requests.filter((path) => path === "coder.localhost/healthz")).toHaveLength(2);
  });

  test("defers normal OIDC values until Factory is available after bootstrap", async () => {
    const run = harness({ healthy: false, factoryHealthy: false });
    let tokenReads = 0;
    const exec: Exec = async (argv, options) => {
      if (argv.join(" ").includes("factory-runtime") && argv.join(" ").includes("coder-token")) {
        tokenReads++;
        run.invocations.push({ argv, options });
        return { exitCode: 0, stdout: encoded(tokenReads === 1 ? "stale-token" : "renewed-token"), stderr: "" };
      }
      return run.exec(argv, options);
    };
    await reconcileCoder({ exec, http: run.http, sleep: async () => {} });

    const helm = run.invocations.filter(({ argv }) => argv[0] === "helm");
    expect(helm).toHaveLength(1);
    expect(helm[0]?.argv.some((arg) => arg.endsWith("coder-bootstrap-values.yaml"))).toBe(true);
    expect(run.invocations.some(({ argv }) => argv[0]?.endsWith("recover-coder-owner-token.sh"))).toBe(true);
    const owners = run.invocations.filter(({ argv }) => argv[0]?.endsWith("bootstrap-coder-verification.sh"));
    expect(owners).toHaveLength(2);
    expect(owners.every(({ options }) => options?.env?.CODER_TOKEN === "renewed-token")).toBe(true);
  });

  test("keeps a healthy bootstrap installation off OIDC while Factory is unavailable", async () => {
    const run = harness({ factoryHealthy: false });
    await reconcileCoder({ exec: run.exec, http: run.http, sleep: async () => {} });

    const helm = run.invocations.filter(({ argv }) => argv[0] === "helm");
    expect(helm).toHaveLength(1);
    expect(helm[0]?.argv.some((arg) => arg.endsWith("coder-bootstrap-values.yaml"))).toBe(true);
  });

  test("backs up PostgreSQL before changing Coder versions", async () => {
    const run = harness({ current: "v2.36.1" });
    const directories: string[] = [];
    const logs: string[] = [];
    await reconcileCoder({
      exec: run.exec,
      http: run.http,
      env: { FACTORY_BACKUP_DIR: "/backups", HOME: "/home/test" },
      mkdir: async (path) => directories.push(path),
      fileSize: async () => 512,
      now: () => new Date("2026-09-02T12:34:56.000Z"),
      sleep: async () => {},
      log: (message) => logs.push(message),
    });

    expect(directories).toEqual(["/backups"]);
    const dump = run.invocations.find(({ argv }) => argv.includes("pg_dump"));
    expect(dump?.argv).toContain("postgres://coder");
    expect(dump?.options?.stdoutFile).toBe("/backups/coder-2.36.1-to-2.37.0-20260902T123456Z.dump");
    expect(logs).toEqual(["Backed up Coder before v2.36.1 -> v2.37.0 migration."]);
  });

  test("does not back up an existing database when the installed Coder version is unknown", async () => {
    const run = harness({ healthy: false, buildInfo: false, deployment: false });
    await reconcileCoder({ exec: run.exec, http: run.http, sleep: async () => {} });

    expect(run.invocations.some(({ argv }) => argv.includes("pg_dump"))).toBe(false);
  });

  test("bootstraps when either automation owner is missing", async () => {
    const run = harness({ users: ["factory-verification"] });
    await reconcileCoder({ exec: run.exec, http: run.http, sleep: async () => {} });
    const helm = run.invocations.filter(({ argv }) => argv[0] === "helm");
    expect(helm).toHaveLength(1);
    expect(helm[0]?.argv.some((arg) => arg.endsWith("coder-bootstrap-values.yaml"))).toBe(true);
    expect(run.invocations.some(({ argv }) => argv[0]?.endsWith("recover-coder-owner-token.sh"))).toBe(false);
  });
});
