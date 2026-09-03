/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'factory-api-artifacts-'));
const temporarySpec = join(temporaryRoot, 'factory-api.openapi.json');
const temporaryClient = join(temporaryRoot, 'client');
const secondSpec = join(temporaryRoot, 'factory-api.second.openapi.json');
const secondClient = join(temporaryRoot, 'client-second');

try {
  await run(['bun', 'apps/bff/scripts/api-spec.ts', `--output=${temporarySpec}`]);
  await run(['bun', 'x', 'orval', '--config', './orval.config.ts'], {
    FACTORY_API_SPEC: temporarySpec,
    FACTORY_API_CLIENT_OUTPUT: temporaryClient,
  });
  await run(['bun', 'apps/bff/scripts/api-spec.ts', `--output=${secondSpec}`]);
  await run(['bun', 'x', 'orval', '--config', './orval.config.ts'], {
    FACTORY_API_SPEC: secondSpec,
    FACTORY_API_CLIENT_OUTPUT: secondClient,
  });

  const mismatches = [
    ...await compareFiles(join(root, 'apps/bff/openapi/factory-api.openapi.json'), temporarySpec),
    ...await compareTrees(join(root, 'web/src/app/generated/api'), temporaryClient),
    ...await compareFiles(temporarySpec, secondSpec, 'two independently generated OpenAPI documents'),
    ...await compareTrees(temporaryClient, secondClient),
    ...await checkSourceBoundaries(),
  ];
  const [specSize, clientSize] = await Promise.all([
    stat(temporarySpec).then((file) => file.size),
    stat(join(temporaryClient, 'factory-api.ts')).then((file) => file.size),
  ]);
  if (specSize >= 250_000) mismatches.push(`OpenAPI document is too large (${specSize} bytes, limit 249999)`);
  if (clientSize >= 250_000) mismatches.push(`Angular client is too large (${clientSize} bytes, limit 249999)`);
  if (mismatches.length) {
    console.error('Generated API artifacts are stale:');
    for (const mismatch of mismatches) console.error(`- ${mismatch}`);
    console.error('Run `bun run api:generate` and commit the resulting artifacts.');
    process.exit(1);
  }
  console.log('Generated API artifacts match the Elysia routes and Orval configuration.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function run(argv: string[], environment: Record<string, string> = {}): Promise<void> {
  const process = Bun.spawn(argv, {
    cwd: root,
    env: { ...Bun.env, ...environment },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (await process.exited !== 0) throw new Error(`${argv.join(' ')} failed`);
}

async function compareTrees(expectedRoot: string, actualRoot: string): Promise<string[]> {
  const [expectedFiles, actualFiles] = await Promise.all([listFiles(expectedRoot), listFiles(actualRoot)]);
  const mismatches: string[] = [];
  const paths = new Set([...expectedFiles, ...actualFiles]);
  for (const path of [...paths].sort()) {
    if (!expectedFiles.includes(path)) mismatches.push(`unexpected generated file ${path}`);
    else if (!actualFiles.includes(path)) mismatches.push(`missing generated file ${path}`);
    else mismatches.push(...await compareFiles(join(expectedRoot, path), join(actualRoot, path), path));
  }
  return mismatches;
}

async function compareFiles(expected: string, actual: string, display = relative(root, expected)): Promise<string[]> {
  const [expectedFile, actualFile] = await Promise.all([Bun.file(expected), Bun.file(actual)]);
  if (!await expectedFile.exists()) return [`missing committed artifact ${display}`];
  if (!await actualFile.exists()) return [`generator did not produce ${display}`];
  return Buffer.from(await expectedFile.arrayBuffer()).equals(Buffer.from(await actualFile.arrayBuffer()))
    ? []
    : [`content differs for ${display}`];
}

async function listFiles(directory: string, base = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path, base));
    else if (entry.isFile()) files.push(relative(base, path));
  }
  return files;
}

async function checkSourceBoundaries(): Promise<string[]> {
  const mismatches: string[] = [];
  const webRoot = join(root, 'web/src/app');
  for (const path of await listFiles(webRoot)) {
    if (!path.endsWith('.ts') || path.endsWith('.spec.ts') || path.startsWith('generated/')) continue;
    const source = await Bun.file(join(webRoot, path)).text();
    if (source.includes('/api/v1/') && path !== 'core/api/error-response.interceptor.ts') {
      mismatches.push(`${path} calls /api/v1 directly instead of using the generated client`);
    }
    if (/from ['"](?:drizzle-orm|@agentic-software-factory\/db)/.test(source)) {
      mismatches.push(`${path} imports the database layer`);
    }
  }

  const contractsRoot = join(root, 'packages/api-contracts/src');
  for (const path of await listFiles(contractsRoot)) {
    if (!path.endsWith('.ts')) continue;
    const source = await Bun.file(join(contractsRoot, path)).text();
    if (/from ['"](?:drizzle-orm|@agentic-software-factory\/db)/.test(source)) {
      mismatches.push(`packages/api-contracts/src/${path} imports the database layer`);
    }
  }
  return mismatches;
}
