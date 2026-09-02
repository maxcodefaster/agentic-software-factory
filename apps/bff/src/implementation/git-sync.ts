/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitSynchronizationInput {
  cloneUrl: string;
  token: string;
  owner: string;
  repository: string;
  branch: string;
  defaultBranch: string;
  headSha: string;
  defaultSha: string;
  signal?: AbortSignal;
}

export interface GitSynchronizationResult {
  defaultSha: string;
  previousHeadSha: string;
  preparedHeadSha: string;
  merged: boolean;
}

export interface GitCommand {
  cwd: string;
  args: string[];
  environmentKeys: string[];
}

interface GitBranchSynchronizerOptions {
  onCommand?: (command: GitCommand) => void;
  beforePush?: () => Promise<void>;
  allowLocalFilesystem?: boolean;
}

export class GitBranchSynchronizer {
  constructor(private readonly options: GitBranchSynchronizerOptions = {}) {}

  async synchronize(input: GitSynchronizationInput): Promise<GitSynchronizationResult> {
    validateCoordinate(input.owner, 'owner');
    validateCoordinate(input.repository, 'repository');
    validateBranch(input.branch, 'branch');
    validateBranch(input.defaultBranch, 'default branch');
    validateSha(input.headSha);
    validateSha(input.defaultSha);
    validateCloneUrl(input.cloneUrl, this.options.allowLocalFilesystem === true);

    const root = await mkdtemp(join(tmpdir(), 'factory-git-sync-'));
    const repositoryDirectory = join(root, 'repository');
    const gitEnvironment: Record<string, string> = {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      HOME: root,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      ...(process.env.SSL_CERT_FILE ? { GIT_SSL_CAINFO: process.env.SSL_CERT_FILE, SSL_CERT_FILE: process.env.SSL_CERT_FILE } : {}),
    };
    const credentialEnvironment: Record<string, string> = input.token ? {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: token ${input.token}`,
    } : {};
    Object.assign(gitEnvironment, credentialEnvironment);
    const run = (args: string[], allowFailure = false) => this.git(repositoryDirectory, args, gitEnvironment, input.signal, allowFailure);

    try {
      await this.git(root, ['init', repositoryDirectory], gitEnvironment, input.signal);
      await run(['config', 'user.name', 'Agentic Software Factory']);
      await run(['config', 'user.email', 'agentic-software-factory@localhost']);
      await run(['remote', 'add', 'origin', input.cloneUrl]);
      await run(['fetch', '--no-tags', 'origin',
        `refs/heads/${input.branch}:refs/remotes/origin/ticket`,
        `refs/heads/${input.defaultBranch}:refs/remotes/origin/default`]);

      const fetchedHead = (await run(['rev-parse', 'refs/remotes/origin/ticket'])).stdout.trim();
      const fetchedDefault = (await run(['rev-parse', 'refs/remotes/origin/default'])).stdout.trim();
      if (fetchedHead !== input.headSha || fetchedDefault !== input.defaultSha) {
        throw conflict('repository heads changed while synchronization was starting');
      }
      if ((await run(['merge-base', '--is-ancestor', input.defaultSha, input.headSha], true)).exitCode === 0) {
        return { defaultSha: input.defaultSha, previousHeadSha: input.headSha, preparedHeadSha: input.headSha, merged: false };
      }

      await run(['checkout', '--detach', input.headSha]);
      const merge = await run(['merge', '--no-ff', '--no-edit', input.defaultSha], true);
      if (merge.exitCode !== 0) {
        await run(['merge', '--abort'], true);
        throw conflict('default branch could not be merged into the ticket branch');
      }
      const preparedHeadSha = (await run(['rev-parse', 'HEAD'])).stdout.trim();
      await this.options.beforePush?.();
      const push = await run(['push', 'origin', `${preparedHeadSha}:refs/heads/${input.branch}`], true);
      if (push.exitCode !== 0) throw conflict('ticket branch moved while it was being synchronized');
      return { defaultSha: input.defaultSha, previousHeadSha: input.headSha, preparedHeadSha, merged: true };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private async git(
    cwd: string,
    args: string[],
    environment: Record<string, string>,
    signal?: AbortSignal,
    allowFailure = false,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.options.onCommand?.({ cwd, args: [...args], environmentKeys: Object.keys(environment).sort() });
    const process = Bun.spawn(['git', ...args], {
      cwd,
      env: environment,
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (!allowFailure && exitCode !== 0) throw new Error(`git ${args[0]} failed: ${redact(stderr)}`);
    return { stdout, stderr: redact(stderr), exitCode };
  }
}

function validateCoordinate(value: string, name: string): void {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?$/.test(value) || value.includes('..')) throw new Error(`invalid repository ${name}`);
}

function validateBranch(value: string, name: string): void {
  if (!value || value.length > 255 || value.startsWith('-') || value.startsWith('/') || value.endsWith('/')
    || value.includes('..') || value.includes('@{') || value.includes('//') || value.endsWith('.') || value.endsWith('.lock')
    || /[\u0000-\u0020\u007f~^:?*\[\\]/.test(value)
    || value.split('/').some((component) => component.startsWith('.') || component.endsWith('.lock'))) {
    throw new Error(`invalid ${name}`);
  }
}

function validateSha(value: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error('invalid Git SHA');
}

function validateCloneUrl(value: string, allowLocalFilesystem: boolean): void {
  if (allowLocalFilesystem && value.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(value)) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('repository clone URL must use HTTPS'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('repository clone URL must use HTTPS without embedded credentials');
  }
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { status: 409 });
}

function redact(value: string): string {
  return value.replace(/Authorization:\s*token\s+\S+/gi, 'Authorization: [REDACTED]');
}
