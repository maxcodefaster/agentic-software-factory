/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';
import { acceptedMarker, ForgejoClient } from '../forgejo/client';
import { fakeForgejo } from '../forgejo/test-support';
import { adaptForgejo } from './adapters';

describe('requirement write locking', () => {
  test('serializes proposal and acceptance for the same repository issue', async () => {
    const fake = fakeForgejo();
    const entered: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    let chain = Promise.resolve();
    let calls = 0;
    const lock = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
      const previous = chain;
      let unlock!: () => void;
      chain = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      entered.push(key);
      calls += 1;
      try {
        if (calls === 1) await first;
        return await action();
      } finally { unlock(); }
    };
    const client = new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch: fake.fetch });
    const service = adaptForgejo(client, 'tenant', lock);
    const scope = {
      identity: { issuer: 'issuer', subject: 'alice' },
      teams: ['tenant'], team: 'tenant', signal: new AbortController().signal,
      repository: { team: 'tenant', owner: 'factory', name: 'requirements', systemId: 'factory/requirements' },
    };

    const spec = { goal: 'Goal', acceptanceCriteria: ['Works'] } as never;
    const proposing = service.propose(7, 'alice', spec, undefined, scope);
    await Promise.resolve();
    const accepting = service.accept(7, 'alice', spec, scope);
    await Promise.resolve();
    expect(entered).toHaveLength(1);
    release();
    await Promise.allSettled([proposing, accepting]);

    expect(entered).toEqual([
      'requirement-write:factory/requirements:7',
      'requirement-write:factory/requirements:7',
    ]);
  });

  test('serializes edit races and rechecks the issue version inside the lock', async () => {
    const fake = fakeForgejo();
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fake.fetch(input, init);
      if ((init?.method ?? 'GET') === 'PATCH' && new URL(String(input)).pathname.endsWith('/issues/7')) {
        fake.issue.updated_at = new Date(Date.parse(fake.issue.updated_at) + 1_000).toISOString();
      }
      return response;
    };
    const locks: string[] = [];
    let chain = Promise.resolve();
    const lock = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
      const previous = chain;
      let release!: () => void;
      chain = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      locks.push(key);
      try { return await action(); } finally { release(); }
    };
    const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch }), 'tenant', lock);
    const scope = { identity: { issuer: 'issuer', subject: 'alice' }, teams: ['tenant'], team: 'tenant', signal: new AbortController().signal, repository: { team: 'tenant', owner: 'factory', name: 'requirements', systemId: 'factory/requirements' } };
    const version = fake.issue.updated_at;

    const results = await Promise.allSettled([
      service.updateRequirement(7, { body: 'first', expectedUpdatedAt: version }, scope),
      service.updateRequirement(7, { body: 'second', expectedUpdatedAt: version }, scope),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(locks).toEqual(['requirement-write:factory/requirements:7', 'requirement-write:factory/requirements:7']);
  });

  test('uses the same lock for edits and interview mutations', async () => {
    const fake = fakeForgejo();
    let active = 0;
    let maximum = 0;
    const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => {
      while (active) await Bun.sleep(1);
      active += 1;
      maximum = Math.max(maximum, active);
      try { await Bun.sleep(2); return await action(); } finally { active -= 1; }
    };
    const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch: fake.fetch }), 'tenant', lock);
    const scope = { identity: { issuer: 'issuer', subject: 'alice' }, teams: ['tenant'], team: 'tenant', signal: new AbortController().signal, repository: { team: 'tenant', owner: 'factory', name: 'requirements', systemId: 'factory/requirements' } };
    const question = { id: 'q1', header: null, prompt: 'Who?', type: 'single' as const, options: [{ value: 'a', label: 'A', description: null }, { value: 'b', label: 'B', description: null }], allowCustom: true, hint: null };

    await Promise.all([
      service.updateRequirement(7, { body: 'edited' }, scope),
      service.beginInterview(7, 'alice', false, { teamId: 'tenant', repository: 'factory/requirements', requirementNumber: 7, runId: 'run', chatId: 'chat', proposalNonce: 'nonce' }, question, 0, scope),
    ]);

    expect(maximum).toBe(1);
    expect((await service.getInterview(7, scope)).state.pending?.id).toBe('q1');
    expect((await service.getIssue(7, scope)).body).toBe('edited');
  });

  test('serializes concurrent interview operations without nested lock acquisition', async () => {
    const fake = fakeForgejo();
    let chain = Promise.resolve();
    let lockCalls = 0;
    const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => {
      lockCalls += 1;
      const previous = chain;
      let release!: () => void;
      chain = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await action(); } finally { release(); }
    };
    const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch: fake.fetch }), 'tenant', lock);
    const scope = { identity: { issuer: 'issuer', subject: 'alice' }, teams: ['tenant'], team: 'tenant', signal: new AbortController().signal, repository: { team: 'tenant', owner: 'factory', name: 'requirements', systemId: 'factory/requirements' } };
    const question = { id: 'q1', header: null, prompt: 'Who?', type: 'single' as const, options: [{ value: 'a', label: 'A', description: null }, { value: 'b', label: 'B', description: null }], allowCustom: true, hint: null };
    await service.beginInterview(7, 'alice', false, { teamId: 'tenant', repository: 'factory/requirements', requirementNumber: 7, runId: 'run', chatId: 'chat', proposalNonce: 'nonce' }, question, 0, scope);
    const answer = { questionId: 'q1', expectedVersion: 1, selected: ['a'], customText: '' };

    await Promise.allSettled([
      service.prepareInterviewAnswer(7, 'alice', answer, 'A', 'one', scope),
      service.prepareInterviewAnswer(7, 'alice', answer, 'A', 'two', scope),
    ]);

    expect(lockCalls).toBe(3);
    expect((await service.getInterview(7, scope)).state.pendingOperation?.operationId).toBeTruthy();
  });

  test.each(['implementation', 'done'] as const)('rejects visible edits in %s after acceptance', async (status) => {
    const fake = fakeForgejo();
    await new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch: fake.fetch }).ensureLabels();
    fake.issue.labels = fake.labels.filter((label) => [`status/${status}`, 'spec/accepted'].includes(label.name));
    fake.issue.body += acceptedMarker({
      requirementId: `req_${'a'.repeat(32)}`, revision: '20260102T030405.006000000Z', digest: `sha256:${'b'.repeat(64)}`,
      path: 'requirements/accepted.yaml', commitSha: 'c'.repeat(40), acceptedAt: '2026-01-02T03:04:05Z', acceptedBy: 'alice',
      specification: { goal: 'Accepted goal', users: [], userStories: [], acceptanceCriteria: ['Accepted'], nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [] },
    });
    const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch: fake.fetch }), 'tenant');
    const scope = { identity: { issuer: 'issuer', subject: 'alice' }, teams: ['tenant'], team: 'tenant', signal: new AbortController().signal, repository: { team: 'tenant', owner: 'factory', name: 'requirements', systemId: 'factory/requirements' } };

    await expect(service.updateRequirement(7, { title: 'Changed', body: 'Changed' }, scope)).rejects.toThrow('accepted requirements cannot be edited');
    expect(fake.issue.title).toBe('Faster onboarding');
    expect(fake.issue.body).toContain('New engineers need a clear start.');
  });
});
