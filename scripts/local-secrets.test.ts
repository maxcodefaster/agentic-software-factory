// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { describe, expect, test } from "bun:test";
import { reconcileLocalSecrets, type SecretData, type SecretExec } from "./local-secrets";

const encoded = (values: Record<string, string>): SecretData =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value).toString("base64")]));

function fixture() {
  const secrets = new Map<string, SecretData>([
    ["factory-platform/factory-auth", encoded({
      "better-auth-secret": "keep-auth",
      "bootstrap-user-email": "stale@example.test",
      "bootstrap-user-name": "Stale Name",
      "bootstrap-user-password": "keep-bootstrap",
      "e2e-business-password": "keep-business",
      "e2e-developer-password": "keep-developer",
      "coder-client-id": "stale-coder",
      "coder-client-secret": "keep-coder-secret",
      "forgejo-client-id": "stale-forgejo",
      "forgejo-client-secret": "keep-forgejo-secret",
    })],
    ["coder/coder-bootstrap", encoded({
      "owner-email": "stale@example.test",
      "owner-username": "stale-owner",
      "owner-password": "keep-owner-password",
    })],
    ["coder/coder-oidc", encoded({ "client-id": "old-copy", "client-secret": "old-copy" })],
    ["coder/coder-db-url", encoded({ url: "old-db" })],
    ["coder/coder-postgres-app", encoded({ uri: "postgres://current" })],
    ["factory-platform/factory-runtime", encoded({ "mcp-api-key": "keep-mcp-key" })],
  ]);
  const patches: string[] = [];
  const exec: SecretExec = async (argv, stdin) => {
    const command = argv.join(" ");
    const namespace = argv[argv.indexOf("-n") + 1]!;
    const name = argv[1] === "create" ? argv[4]! : argv[3]!;
    const id = `${namespace}/${name}`;
    if (argv[1] === "get") {
      const data = secrets.get(id);
      return { exitCode: 0, stdout: data ? JSON.stringify({ data }) : "", stderr: "" };
    }
    if (argv[1] === "create") {
      secrets.set(id, {});
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (argv[1] === "patch") {
      patches.push(command);
      const patch = JSON.parse(stdin!) as { data: SecretData };
      secrets.set(id, { ...secrets.get(id), ...patch.data });
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return { exec, patches, secrets };
}

const decoded = (data: SecretData | undefined, key: string) => Buffer.from(data?.[key] ?? "", "base64").toString();

describe("local Secret reconciliation", () => {
  test("preserves generated credentials and repairs fixed configuration and derived copies", async () => {
    const { exec, patches, secrets } = fixture();
    const generated: string[] = [];
    const changed = await reconcileLocalSecrets(false, exec, {}, (encoding) => { generated.push(encoding); return "unexpected"; });

    expect(generated).toEqual([]);
    expect(changed).toEqual([
      "factory-platform/factory-auth",
      "coder/coder-bootstrap",
      "coder/coder-oidc",
      "coder/coder-db-url",
    ]);
    const auth = secrets.get("factory-platform/factory-auth");
    expect(decoded(auth, "better-auth-secret")).toBe("keep-auth");
    expect(decoded(auth, "bootstrap-user-password")).toBe("keep-bootstrap");
    expect(decoded(secrets.get("factory-platform/factory-runtime"), "mcp-api-key")).toBe("keep-mcp-key");
    expect(decoded(auth, "bootstrap-user-email")).toBe("developer@example.test");
    expect(decoded(auth, "coder-client-id")).toBe("agentic-software-factory-coder");
    expect(decoded(secrets.get("coder/coder-oidc"), "client-secret")).toBe("keep-coder-secret");
    expect(decoded(secrets.get("coder/coder-db-url"), "url")).toBe("postgres://current");

    patches.length = 0;
    expect(await reconcileLocalSecrets(false, exec)).toEqual([]);
    expect(patches).toEqual([]);
  });

  test("rotates generated credentials only with the explicit rotation flag", async () => {
    const { exec, secrets } = fixture();
    let next = 0;
    await reconcileLocalSecrets(true, exec, {}, (encoding) => `${encoding}-${++next}`);

    expect(next).toBe(8);
    expect(decoded(secrets.get("factory-platform/factory-auth"), "better-auth-secret")).toBe("hex-1");
    expect(decoded(secrets.get("coder/coder-bootstrap"), "owner-password")).toBe("base64-7");
    expect(decoded(secrets.get("coder/coder-oidc"), "client-secret")).toBe("hex-5");
    expect(decoded(secrets.get("factory-platform/factory-runtime"), "mcp-api-key")).toBe("hex-8");
  });

  test("always reconciles environment-backed values without rotating unrelated credentials", async () => {
    const { exec, secrets } = fixture();
    await reconcileLocalSecrets(false, exec, {
      factoryAuth: {
        "coder-client-id": "configured-coder",
        "coder-client-secret": "configured-secret",
      },
    });

    expect(decoded(secrets.get("factory-platform/factory-auth"), "coder-client-secret")).toBe("configured-secret");
    expect(decoded(secrets.get("factory-platform/factory-auth"), "better-auth-secret")).toBe("keep-auth");
    expect(decoded(secrets.get("coder/coder-oidc"), "client-id")).toBe("configured-coder");
    expect(decoded(secrets.get("coder/coder-oidc"), "client-secret")).toBe("configured-secret");
  });
});
