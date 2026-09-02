/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';
import { ForgejoClient } from '../forgejo/client';
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
      'requirement-write:tenant:factory/requirements:7',
      'requirement-write:tenant:factory/requirements:7',
    ]);
  });
});
