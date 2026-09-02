// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { mkdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type ExecResult = { exitCode: number; stdout: string; stderr: string };
export type ExecOptions = { env?: Record<string, string>; stdoutFile?: string };
export type Exec = (argv: readonly string[], options?: ExecOptions) => Promise<ExecResult>;
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export type ReconcileCoderDependencies = {
  exec: Exec;
  http: Http;
  mkdir: (path: string) => Promise<unknown>;
  fileSize: (path: string) => Promise<number>;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  env: Record<string, string | undefined>;
  root: string;
  log: (message: string) => void;
};

type Versions = { CODER_CHART_VERSION: string; CODER_SERVER_VERSION: string };
type CoderUser = { username?: string };

const chart = "oci://ghcr.io/coder/chart/coder";
const tokenJsonPath = "jsonpath={.data.coder-token}";
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));

export const defaultExec: Exec = async (argv, options = {}) => {
  if (options.stdoutFile) {
    const output = await open(options.stdoutFile, "w", 0o600);
    await output.chmod(0o600);
    try {
      const child = Bun.spawn([...argv], {
        cwd: defaultRoot,
        env: { ...process.env, ...options.env },
        stdout: output.fd,
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      return { exitCode, stdout: "", stderr };
    } finally {
      await output.close();
    }
  }
  const child = Bun.spawn([...argv], {
    cwd: defaultRoot,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const defaults: ReconcileCoderDependencies = {
  exec: defaultExec,
  http: fetch,
  mkdir: (path) => mkdir(path, { recursive: true, mode: 0o700 }),
  fileSize: async (path) => (await stat(path)).size,
  now: () => new Date(),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  env: process.env,
  root: defaultRoot,
  log: console.log,
};

function readVersions(content: string): Versions {
  const values = Object.fromEntries(
    content.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  if (!values.CODER_CHART_VERSION || !values.CODER_SERVER_VERSION) throw new Error("deploy/local/versions.env is missing Coder versions");
  return values as Versions;
}

async function required(exec: Exec, argv: readonly string[], options?: ExecOptions): Promise<string> {
  const result = await exec(argv, options);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${argv.join(" ")} failed`);
  return result.stdout.trim();
}

async function token(exec: Exec, optional = false): Promise<string> {
  const result = await exec(["kubectl", "get", "secret", "factory-runtime", "-n", "factory-platform", "-o", tokenJsonPath]);
  if (result.exitCode !== 0) {
    if (optional) return "";
    throw new Error(result.stderr.trim() || "Failed to read the Coder token from factory-runtime");
  }
  const encoded = result.stdout.trim();
  return Buffer.from(encoded, "base64").toString();
}

async function request(http: Http, path: string, sessionToken?: string): Promise<Response | undefined> {
  try {
    return await http(`http://coder.localhost${path}`, {
      headers: sessionToken ? { "Coder-Session-Token": sessionToken } : undefined,
    });
  } catch {
    return undefined;
  }
}

async function factoryIsHealthy(http: Http): Promise<boolean> {
  try {
    return (await http("http://factory.localhost/healthz")).ok;
  } catch {
    return false;
  }
}

async function currentVersion(deps: ReconcileCoderDependencies): Promise<string> {
  const buildInfo = await request(deps.http, "/api/v2/buildinfo");
  if (buildInfo?.ok) {
    try {
      const body = await buildInfo.json() as { version?: unknown };
      if (typeof body.version === "string") return body.version.split("+")[0] ?? "";
    } catch {
      // A reachable but incomplete installation can return a non-JSON response during startup.
    }
  }
  const image = await deps.exec(["kubectl", "get", "deployment", "coder", "-n", "coder", "-o", "jsonpath={.spec.template.spec.containers[0].image}"]);
  return image.exitCode === 0 ? image.stdout.trim().replace(/^.*:/, "").replace(/@.*$/, "") : "";
}

function helmArgs(root: string, chartVersion: string, bootstrap: boolean): string[] {
  return [
    "helm", "upgrade", "--install", "coder", chart, "--version", chartVersion, "-n", "coder",
    "-f", join(root, "deploy/local/coder-values.yaml"),
    ...(bootstrap ? ["-f", join(root, "deploy/local/coder-bootstrap-values.yaml")] : []),
    "--force-conflicts", "--wait", "--timeout", "5m",
  ];
}

async function bootstrapOwners(deps: ReconcileCoderDependencies, sessionToken: string): Promise<void> {
  const script = join(deps.root, "deploy/local/bootstrap-coder-verification.sh");
  await required(deps.exec, [script], { env: { CODER_TOKEN: sessionToken } });
  await required(deps.exec, [script], { env: { CODER_TOKEN: sessionToken, FACTORY_CODER_AUTOMATION_KIND: "staging" } });
}

async function waitForHealth(deps: ReconcileCoderDependencies): Promise<void> {
  for (const delay of [1, 2, 4, 8, 16]) {
    if ((await request(deps.http, "/healthz"))?.ok) break;
    await deps.sleep(delay * 1_000);
  }
  const response = await request(deps.http, "/healthz");
  if (!response?.ok) throw new Error(`Coder health check failed${response ? ` with HTTP ${response.status}` : ""}`);
}

export async function reconcileCoder(overrides: Partial<ReconcileCoderDependencies> = {}): Promise<void> {
  const deps = { ...defaults, ...overrides };
  const versions = readVersions(await Bun.file(join(deps.root, "deploy/local/versions.env")).text());
  let sessionToken = await token(deps.exec, true);
  const current = await currentVersion(deps);
  const cluster = await deps.exec(["kubectl", "get", "cluster", "coder-postgres", "-n", "coder"]);
  if (cluster.exitCode === 0 && current && current !== versions.CODER_SERVER_VERSION) {
    const backupRoot = deps.env.FACTORY_BACKUP_DIR ?? join(deps.env.HOME ?? homedir(), ".local/state/agentic-software-factory/backups");
    await deps.mkdir(backupRoot);
    const uri = Buffer.from(await required(deps.exec, ["kubectl", "get", "secret", "coder-postgres-app", "-n", "coder", "-o", "jsonpath={.data.uri}"]), "base64").toString();
    const timestamp = deps.now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const backup = join(backupRoot, `coder-${current.replace(/^v/, "")}-to-${versions.CODER_SERVER_VERSION.replace(/^v/, "")}-${timestamp}.dump`);
    await required(deps.exec, ["kubectl", "exec", "-n", "coder", "coder-postgres-1", "-c", "postgres", "--", "pg_dump", uri, "--format=custom"], { stdoutFile: backup });
    if (await deps.fileSize(backup) === 0) throw new Error(`Coder backup is empty: ${backup}`);
    deps.log(`Backed up Coder before ${current} -> ${versions.CODER_SERVER_VERSION} migration.`);
  }

  const me = await request(deps.http, "/api/v2/users/me", sessionToken);
  const healthy = me?.ok === true;
  let bootstrap = !healthy || !(await factoryIsHealthy(deps.http));
  if (healthy) {
    for (const username of ["factory-verification", "factory-stage"]) {
      const response = await request(deps.http, `/api/v2/users?q=${username}&limit=100`, sessionToken);
      if (!response?.ok) throw new Error(`Coder user lookup for ${username} failed${response ? ` with HTTP ${response.status}` : ""}`);
      const body = await response.json() as { users?: unknown };
      if (!Array.isArray(body.users)) throw new Error(`Coder user lookup for ${username} returned an invalid response`);
      if ((body.users as CoderUser[]).filter((user) => user.username === username).length !== 1) bootstrap = true;
    }
  }

  if (bootstrap) {
    await required(deps.exec, helmArgs(deps.root, versions.CODER_CHART_VERSION, true));
    if (!healthy) {
      await required(deps.exec, [join(deps.root, "deploy/local/recover-coder-owner-token.sh")]);
      sessionToken = await token(deps.exec);
    }
    await bootstrapOwners(deps, sessionToken);
    return;
  }

  await required(deps.exec, helmArgs(deps.root, versions.CODER_CHART_VERSION, false));
  await waitForHealth(deps);
  await bootstrapOwners(deps, sessionToken);
}
