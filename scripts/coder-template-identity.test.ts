// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { expect, test } from "bun:test";

const root = new URL("..", import.meta.url).pathname;
const identityScript = `${root}deploy/local/coder-template-identity.sh`;
const baseEnvironment = {
  FACTORY_REPOSITORY_ORIGIN: "https://forgejo.example",
  FACTORY_DEFAULT_REPOSITORY_URL: "https://forgejo.example/factory/system.git",
  FACTORY_DEFAULT_REPOSITORY_REF: "abc123",
};

async function identity(versions: string, overrides: Record<string, string> = {}, factoryRoot = root): Promise<string> {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim());
  const file = `${directory}/versions.env`;
  try {
    await Bun.write(file, versions);
    const result = Bun.spawnSync(["sh", identityScript], {
      cwd: root,
      env: { ...process.env, ...baseEnvironment, FACTORY_ROOT: factoryRoot, FACTORY_VERSIONS_FILE: file, ...overrides },
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  } finally {
    await Bun.$`rm -rf ${directory}`;
  }
}

test("Coder template identity uses resolved version-backed defaults", async () => {
  const versions = "CODER_ENVBUILDER_DIGEST=env-one\nCODER_SERVER_DIGEST=coder-one\n";
  const baseline = await identity(versions);
  expect(await identity(versions.replace("env-one", "env-two"))).not.toBe(baseline);
  expect(await identity(versions.replace("coder-one", "coder-two"))).not.toBe(baseline);

  const override = { FACTORY_ENVBUILDER_IMAGE: "registry.example/envbuilder:fixed" };
  expect(await identity(versions, override)).toBe(await identity(versions.replace("env-one", "env-two"), override));
});

test("Coder template identity does not depend on the repository path", async () => {
  const first = await Bun.$`mktemp -d`.text().then((value) => value.trim());
  const second = await Bun.$`mktemp -d`.text().then((value) => value.trim());
  try {
    for (const destination of [first, second]) {
      await Bun.$`mkdir -p ${destination}/templates/agentic-software-factory ${destination}/deploy/local`;
      for (const file of ["main.tf", "README.md", "workspace-clone.sh"]) {
        await Bun.write(`${destination}/templates/agentic-software-factory/${file}`, await Bun.file(`${root}templates/agentic-software-factory/${file}`).arrayBuffer());
      }
      await Bun.write(`${destination}/deploy/local/coder-template-defaults.sh`, await Bun.file(`${root}deploy/local/coder-template-defaults.sh`).arrayBuffer());
    }
    const versions = "CODER_ENVBUILDER_DIGEST=env-one\nCODER_SERVER_DIGEST=coder-one\n";
    expect(await identity(versions, {}, first)).toBe(await identity(versions, {}, second));
  } finally {
    await Bun.$`rm -rf ${first} ${second}`;
  }
});
