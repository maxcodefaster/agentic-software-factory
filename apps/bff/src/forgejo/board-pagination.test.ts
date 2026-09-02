/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, mock, test } from 'bun:test';

import { BOARD_PAGE_SIZE, ForgejoClient, type Issue } from './client';

test('exposes more than 200 issues through bounded cursor pages', async () => {
  const calls: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    const page = Number(url.searchParams.get('page'));
    const start = (page - 1) * BOARD_PAGE_SIZE;
    const count = Math.max(0, Math.min(BOARD_PAGE_SIZE, 205 - start));
    return Response.json(Array.from({ length: count }, (_, index) => issue(start + index + 1)), {
      headers: { 'X-Total-Count': '205' },
    });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  const numbers: number[] = [];
  let cursor: string | undefined;
  do {
    const board = await client.board(cursor);
    numbers.push(...Object.values(board.columns).flat().map((card) => card.number));
    expect(board.total).toBe(205);
    cursor = board.nextCursor ?? undefined;
  } while (cursor);

  expect(numbers).toHaveLength(205);
  expect(numbers.at(-1)).toBe(205);
  expect(calls).toHaveLength(5);
  expect(calls.at(-1)).toContain(`limit=${BOARD_PAGE_SIZE}&page=5`);
});

function issue(number: number): Issue {
  return {
    id: number, number, title: `Issue ${number}`, body: '', html_url: `https://forgejo.example/issues/${number}`,
    state: 'open', labels: [], assignee: null, user: { login: 'alice', full_name: 'Alice', avatar_url: '' },
    created_at: '2026-01-01T00:00:00Z', updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(),
  };
}
