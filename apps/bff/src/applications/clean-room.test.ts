/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { inspectSystemContract, systemContractReferences } from './system-contract';

const root = resolve(import.meta.dir, '../../../../fixtures/clean-room');

for (const name of ['http-service', 'batch-worker']) {
  test(`clean-room ${name} satisfies the canonical repository contract`, async () => {
    const directory = resolve(root, name);
    const manifest = await Bun.file(resolve(directory, '.factory/system.yaml')).text();
    const references = systemContractReferences(manifest);
    expect(references.valid).toBe(true);
    if (!references.valid) return;
    const artifacts = new Map(await Promise.all(references.paths.map(async (path) => [path, await Bun.file(resolve(directory, path)).text()] as const)));
    expect(inspectSystemContract(manifest, artifacts)).toMatchObject({ compatible: true, contract: { version: 1 } });
  });
}

test('example separates lean developer and verification Dockerfiles', async () => {
  const [developer, verification] = await Promise.all([
    Bun.file(resolve(root, '../../example/.devcontainer/Dockerfile')).text(),
    Bun.file(resolve(root, '../../example/.devcontainer/verification/Dockerfile')).text(),
  ]);
  expect(developer).toContain('FROM base AS developer');
  expect(developer).not.toContain('AS verification');
  expect(verification).toContain('FROM base AS verification');
});
