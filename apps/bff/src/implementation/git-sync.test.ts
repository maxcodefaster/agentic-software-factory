/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GitBranchSynchronizer, type GitCommand } from './git-sync';

const roots: string[] = [];
setDefaultTimeout(15_000);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('GitBranchSynchronizer', () => {
  test('keeps the ticket head when it already contains the default head', async () => {
    const repository = await fixture();
    const commands: GitCommand[] = [];
    const result = await testSynchronizer({ onCommand: (command) => commands.push(command) }).synchronize(input(repository));

    expect(result).toEqual({ defaultSha: repository.defaultSha, previousHeadSha: repository.headSha, preparedHeadSha: repository.headSha, merged: false });
    expect(await remoteHead(repository, 'ticket')).toBe(repository.headSha);
    expect(commands.some((command) => command.args[0] === 'push')).toBe(false);
  });

  test('creates and pushes a normal merge commit when default advanced', async () => {
    const repository = await fixture({ diverged: true });
    const result = await testSynchronizer().synchronize(input(repository));

    expect(result.merged).toBe(true);
    expect(result.preparedHeadSha).not.toBe(repository.headSha);
    expect(await remoteHead(repository, 'ticket')).toBe(result.preparedHeadSha);
    expect((await git(repository.origin, ['rev-list', '--parents', '-n', '1', result.preparedHeadSha])).trim().split(' ')).toHaveLength(3);
    expect((await git(repository.origin, ['show', '-s', '--format=%an', result.preparedHeadSha])).trim()).toBe('Agentic Software Factory');
  });

  test('aborts an ordinary merge conflict without changing the remote', async () => {
    const repository = await fixture({ diverged: true, ticketFile: 'ticket\n', defaultFile: 'default\n' });
    let privateDirectory = '';
    await expect(testSynchronizer({ onCommand: (command) => { privateDirectory ||= command.cwd; } }).synchronize(input(repository))).rejects.toThrow('default branch could not be merged');
    expect(await remoteHead(repository, 'ticket')).toBe(repository.headSha);
    await expect(readFile(privateDirectory)).rejects.toThrow();
  });

  test('rejects a concurrent remote ticket update', async () => {
    const repository = await fixture({ diverged: true });
    let moved = false;
    const synchronizer = testSynchronizer({
      beforePush: async () => {
        if (moved) return;
        moved = true;
        await checkout(repository.work, 'ticket');
        await writeFile(join(repository.work, 'concurrent.txt'), 'concurrent\n');
        await git(repository.work, ['add', 'concurrent.txt']);
        await git(repository.work, ['commit', '-m', 'concurrent']);
        await git(repository.work, ['push', 'origin', 'ticket']);
      },
    });

    await expect(synchronizer.synchronize(input(repository))).rejects.toThrow('ticket branch moved while it was being synchronized');
    expect(await remoteHead(repository, 'ticket')).not.toBe(repository.headSha);
  });

  test('never uses force flags, redacts credentials, and removes its private directory', async () => {
    const repository = await fixture({ diverged: true });
    const commands: GitCommand[] = [];
    let privateDirectory = '';
    const token = 'secret-token-that-must-not-escape';
    const synchronizer = testSynchronizer({
      onCommand: (command) => {
        commands.push(command);
        privateDirectory ||= command.cwd;
      },
    });
    await synchronizer.synchronize({ ...input(repository), token });

    expect(commands.flatMap((command) => command.args).some((arg) => arg.includes('force'))).toBe(false);
    expect(JSON.stringify(commands)).not.toContain(token);
    expect(await readFile(join(repository.origin, 'config'), 'utf8')).not.toContain(token);
    await expect(readFile(privateDirectory)).rejects.toThrow();
  });

  test('validates repository coordinates, branch names, and SHAs', async () => {
    const repository = await fixture();
    const synchronizer = new GitBranchSynchronizer();
    await expect(synchronizer.synchronize({ ...input(repository), owner: '../escape' })).rejects.toThrow('owner');
    await expect(synchronizer.synchronize({ ...input(repository), branch: 'bad..branch' })).rejects.toThrow('branch');
    await expect(synchronizer.synchronize({ ...input(repository), headSha: 'abc' })).rejects.toThrow('SHA');
  });

  test('accepts only HTTPS network clone URLs and rejects remote-helper syntax', async () => {
    const repository = await fixture();
    const synchronizer = new GitBranchSynchronizer();
    for (const cloneUrl of [
      'http://forgejo.example/factory/app.git',
      'ssh://git@forgejo.example/factory/app.git',
      'git@forgejo.example:factory/app.git',
      'ext::sh -c id',
      'file:///tmp/app.git',
    ]) {
      await expect(synchronizer.synchronize({ ...input(repository), cloneUrl })).rejects.toThrow('HTTPS');
    }
  });

  test('passes only the required environment allowlist to Git children', async () => {
    const repository = await fixture();
    const commands: GitCommand[] = [];
    process.env.BETTER_AUTH_SECRET = 'must-not-reach-git';
    process.env.FORGEJO_IMPLEMENTATION_TOKEN = 'must-not-reach-git';
    try {
      await testSynchronizer({ onCommand: (command) => commands.push(command) }).synchronize(input(repository));
    } finally {
      delete process.env.BETTER_AUTH_SECRET;
      delete process.env.FORGEJO_IMPLEMENTATION_TOKEN;
    }
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.environmentKeys).not.toContain('BETTER_AUTH_SECRET');
      expect(command.environmentKeys).not.toContain('FORGEJO_IMPLEMENTATION_TOKEN');
      expect(command.environmentKeys).toEqual(expect.arrayContaining(['GIT_TERMINAL_PROMPT', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'PATH']));
    }
  });
});

function testSynchronizer(options: ConstructorParameters<typeof GitBranchSynchronizer>[0] = {}): GitBranchSynchronizer {
  return new GitBranchSynchronizer({ ...options, allowLocalFilesystem: true });
}

interface Fixture {
  root: string;
  origin: string;
  work: string;
  headSha: string;
  defaultSha: string;
}

async function fixture(options: { diverged?: boolean; ticketFile?: string; defaultFile?: string } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'factory-git-sync-test-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  await git(root, ['init', '--bare', origin]);
  await git(root, ['clone', origin, work]);
  await git(work, ['config', 'user.name', 'Test']);
  await git(work, ['config', 'user.email', 'test@example.test']);
  await git(work, ['checkout', '-b', 'main']);
  await Bun.write(join(work, 'shared.txt'), 'base\n');
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'base']);
  await git(work, ['push', '-u', 'origin', 'main']);
  await git(work, ['checkout', '-b', 'ticket']);
  await Bun.write(join(work, 'ticket.txt'), 'ticket\n');
  if (options.ticketFile) await Bun.write(join(work, 'shared.txt'), options.ticketFile);
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'ticket']);
  await git(work, ['push', '-u', 'origin', 'ticket']);
  if (options.diverged) {
    await checkout(work, 'main');
    await Bun.write(join(work, 'default.txt'), 'default\n');
    if (options.defaultFile) await Bun.write(join(work, 'shared.txt'), options.defaultFile);
    await git(work, ['add', '.']);
    await git(work, ['commit', '-m', 'default']);
    await git(work, ['push', 'origin', 'main']);
  }
  return { root, origin, work, headSha: await remoteHead({ origin } as Fixture, 'ticket'), defaultSha: await remoteHead({ origin } as Fixture, 'main') };
}

function input(repository: Fixture) {
  return { cloneUrl: repository.origin, token: '', owner: 'factory', repository: 'app', branch: 'ticket', defaultBranch: 'main', headSha: repository.headSha, defaultSha: repository.defaultSha };
}

async function remoteHead(repository: Pick<Fixture, 'origin'>, branch: string): Promise<string> {
  return (await git(repository.origin, ['rev-parse', `refs/heads/${branch}`])).trim();
}

async function checkout(work: string, branch: string): Promise<void> {
  await git(work, ['checkout', branch]);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr}`);
  return stdout;
}
