/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';
import { ForgejoClient } from './client';

describe('Forgejo collection pagination', () => {
  test.each([50, 51, 100])('reads all %i labels, statuses, and reviews at Forgejo page size 50', async (count) => {
    const calls: string[] = [];
    const values = Array.from({ length: count }, (_, id) => id + 1);
    const page = (url: URL) => values.slice((Number(url.searchParams.get('page')) - 1) * 50, Number(url.searchParams.get('page')) * 50);
    const client = new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
      if (init?.method === 'POST') return Response.json({ id: 1000, ...JSON.parse(String(init.body)) });
      const ids = page(url);
      const headers = { 'x-total-count': String(count) };
      if (url.pathname.endsWith('/labels')) return Response.json(ids.map((id) => ({ id, name: `custom/${id}`, color: 'ffffff', exclusive: false })), { headers });
      if (url.pathname.endsWith('/statuses/abc')) return Response.json(ids.map((id) => ({ id, context: 'ci', status: 'success', description: '', target_url: '', created_at: '' })), { headers });
      return Response.json(ids.map((id) => ({ id, state: 'COMMENT', body: '', commit_id: 'abc', user: { login: 'user', full_name: '', avatar_url: '' }, submitted_at: '' })), { headers });
    } });

    const labels = await client.ensureLabels();
    expect([...labels.keys()].filter((name) => name.startsWith('custom/'))).toHaveLength(count);
    expect(await client.listCommitStatuses('factory', 'app', 'abc')).toHaveLength(count);
    expect(await client.listPullReviews('factory', 'app', 7)).toHaveLength(count);
    expect(calls.some((call) => call.includes('limit=100'))).toBe(false);
    if (count > 50) expect(calls.some((call) => call.endsWith('limit=50&page=2'))).toBe(true);
  });
});
