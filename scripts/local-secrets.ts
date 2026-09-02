// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { randomBytes } from "node:crypto";

export type SecretExecResult = { exitCode: number; stdout: string; stderr: string };
export type SecretExec = (argv: readonly string[], stdin?: string) => Promise<SecretExecResult>;
export type SecretData = Record<string, string>;
export type LocalSecretOverrides = {
  factoryAuth?: Readonly<Record<string, string | undefined>>;
  coderBootstrap?: Readonly<Record<string, string | undefined>>;
};

type SecretRef = { namespace: string; name: string };
type GeneratedKey = { key: string; encoding: "hex" | "base64" };
type SecretDefinition = SecretRef & {
  generated?: readonly GeneratedKey[];
  fixed?: Readonly<Record<string, string>>;
};

const definitions: readonly SecretDefinition[] = [
  {
    namespace: "factory-platform",
    name: "factory-auth",
    generated: [
      { key: "better-auth-secret", encoding: "hex" },
      { key: "bootstrap-user-password", encoding: "base64" },
      { key: "e2e-business-password", encoding: "base64" },
      { key: "e2e-developer-password", encoding: "base64" },
      { key: "coder-client-secret", encoding: "hex" },
      { key: "forgejo-client-secret", encoding: "hex" },
    ],
    fixed: {
      "bootstrap-user-email": "developer@example.test",
      "bootstrap-user-name": "Factory Developer",
      "coder-client-id": "agentic-software-factory-coder",
      "forgejo-client-id": "agentic-software-factory-forgejo",
    },
  },
  {
    namespace: "coder",
    name: "coder-bootstrap",
    generated: [{ key: "owner-password", encoding: "base64" }],
    fixed: {
      "owner-email": "coder-admin@example.test",
      "owner-username": "factory-admin",
    },
  },
  {
    namespace: "factory-platform",
    name: "factory-runtime",
    generated: [{ key: "mcp-api-key", encoding: "hex" }],
  },
];

export const defaultSecretExec: SecretExec = async (argv, stdin) => {
  const child = Bun.spawn(argv, {
    cwd: import.meta.dir + "/..",
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const decode = (data: SecretData, key: string): string => {
  const value = data[key];
  return value ? Buffer.from(value, "base64").toString() : "";
};

const encode = (value: string): string => Buffer.from(value).toString("base64");

async function readSecret(exec: SecretExec, ref: SecretRef): Promise<SecretData | undefined> {
  const result = await exec(["kubectl", "get", "secret", ref.name, "-n", ref.namespace, "-o", "json", "--ignore-not-found"]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `failed to read ${ref.namespace}/${ref.name}`);
  if (!result.stdout.trim()) return undefined;
  const parsed = JSON.parse(result.stdout) as { data?: SecretData };
  return parsed.data ?? {};
}

async function createSecret(exec: SecretExec, ref: SecretRef): Promise<void> {
  const result = await exec(["kubectl", "create", "secret", "generic", ref.name, "-n", ref.namespace]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `failed to create ${ref.namespace}/${ref.name}`);
}

async function patchSecret(exec: SecretExec, ref: SecretRef, values: Readonly<Record<string, string>>): Promise<void> {
  if (Object.keys(values).length === 0) return;
  const data = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encode(value)]));
  const result = await exec(
    ["kubectl", "patch", "secret", ref.name, "-n", ref.namespace, "--type", "merge", "--patch-file", "/dev/stdin"],
    JSON.stringify({ data }),
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `failed to patch ${ref.namespace}/${ref.name}`);
}

async function reconcileValues(
  exec: SecretExec,
  ref: SecretRef,
  desired: Readonly<Record<string, string>>,
): Promise<{ data: SecretData; changed: boolean }> {
  let data = await readSecret(exec, ref);
  if (data === undefined) {
    await createSecret(exec, ref);
    data = {};
  }
  const changed = Object.fromEntries(Object.entries(desired).filter(([key, value]) => decode(data!, key) !== value));
  await patchSecret(exec, ref, changed);
  return {
    changed: Object.keys(changed).length > 0,
    data: { ...data, ...Object.fromEntries(Object.entries(changed).map(([key, value]) => [key, encode(value)])) },
  };
}

export async function reconcileLocalSecrets(
  rotateGenerated: boolean,
  exec: SecretExec = defaultSecretExec,
  overrides: LocalSecretOverrides = {},
  generate: (encoding: GeneratedKey["encoding"]) => string = (encoding) => randomBytes(24).toString(encoding),
): Promise<readonly string[]> {
  const changed: string[] = [];
  const resolved = new Map<string, SecretData>();

  for (const definition of definitions) {
    const current = await readSecret(exec, definition) ?? {};
    const supplied = definition.name === "factory-auth" ? overrides.factoryAuth
      : definition.name === "coder-bootstrap" ? overrides.coderBootstrap : undefined;
    const desired: Record<string, string> = {
      ...definition.fixed,
      ...Object.fromEntries(Object.entries(supplied ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    };
    for (const generated of definition.generated ?? []) {
      const existing = decode(current, generated.key);
      desired[generated.key] = supplied?.[generated.key]
        ?? (existing && !rotateGenerated ? existing : generate(generated.encoding));
    }
    const result = await reconcileValues(exec, definition, desired);
    resolved.set(`${definition.namespace}/${definition.name}`, result.data);
    if (result.changed) changed.push(`${definition.namespace}/${definition.name}`);
  }

  const auth = resolved.get("factory-platform/factory-auth")!;
  const oidc = await reconcileValues(exec, { namespace: "coder", name: "coder-oidc" }, {
    "client-id": decode(auth, "coder-client-id"),
    "client-secret": decode(auth, "coder-client-secret"),
  });
  if (oidc.changed) changed.push("coder/coder-oidc");

  const postgres = await readSecret(exec, { namespace: "coder", name: "coder-postgres-app" });
  const databaseUrl = postgres && decode(postgres, "uri");
  if (!databaseUrl) throw new Error("coder/coder-postgres-app is missing data.uri");
  const database = await reconcileValues(exec, { namespace: "coder", name: "coder-db-url" }, { url: databaseUrl });
  if (database.changed) changed.push("coder/coder-db-url");

  return changed;
}

async function main(args: readonly string[]): Promise<number> {
  if (args.some((arg) => arg !== "--rotate-generated")) {
    console.error("usage: local-secrets.ts [--rotate-generated]");
    return 2;
  }
  const context = await defaultSecretExec(["kubectl", "config", "current-context"]);
  if (context.exitCode !== 0 || context.stdout.trim() !== "orbstack") {
    console.error("Refusing local Secret reconciliation outside the orbstack Kubernetes context.");
    return 1;
  }
  try {
    const environment = (name: string) => process.env[name] || undefined;
    const changed = await reconcileLocalSecrets(args.includes("--rotate-generated"), defaultSecretExec, {
      factoryAuth: {
        "better-auth-secret": environment("BETTER_AUTH_SECRET"),
        "bootstrap-user-email": environment("AUTH_BOOTSTRAP_USER_EMAIL"),
        "bootstrap-user-name": environment("AUTH_BOOTSTRAP_USER_NAME"),
        "bootstrap-user-password": environment("AUTH_BOOTSTRAP_USER_PASSWORD"),
        "e2e-business-password": environment("AUTH_E2E_BUSINESS_PASSWORD"),
        "e2e-developer-password": environment("AUTH_E2E_DEVELOPER_PASSWORD"),
        "coder-client-id": environment("CODER_OIDC_CLIENT_ID"),
        "coder-client-secret": environment("CODER_OIDC_CLIENT_SECRET"),
        "forgejo-client-id": environment("FORGEJO_OIDC_CLIENT_ID"),
        "forgejo-client-secret": environment("FORGEJO_OIDC_CLIENT_SECRET"),
      },
      coderBootstrap: {
        "owner-email": environment("CODER_BOOTSTRAP_OWNER_EMAIL"),
        "owner-username": environment("CODER_BOOTSTRAP_OWNER_USERNAME"),
        "owner-password": environment("CODER_BOOTSTRAP_OWNER_PASSWORD"),
      },
    });
    console.log(changed.length ? `Reconciled local Secrets: ${changed.join(", ")}` : "Local Secrets already match.");
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
