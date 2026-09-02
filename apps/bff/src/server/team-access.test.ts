/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, mock, test } from 'bun:test';

import { ForgejoClient, teamMarker } from '../forgejo/client';
import { adaptForgejo } from './adapters';

const labels = [
  { id: 1, name: 'status/ideation', color: 'aaa', exclusive: true },
  { id: 2, name: 'spec/draft', color: 'aaa', exclusive: true },
];

function issue(number: number, team?: string) {
  return {
    id: number, number, title: `Requirement ${number}`, body: `Body${team ? teamMarker(team) : ''}`,
    html_url: `https://forge.example/issues/${number}`, state: 'open', labels,
    user: { login: 'alice', full_name: 'Alice', avatar_url: '' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
}

test('filters shared Forgejo issues into the selected authorized board', async () => {
  const fetch = mock(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/issues')) return Response.json([issue(1), issue(2, 'payments'), issue(3, 'operations')]);
    throw new Error(`unexpected ${url.pathname}`);
  });
  const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch }), 'factory');
  const board = await service.board({ identity: { issuer: 'issuer', subject: 'alice' }, signal: new AbortController().signal, team: 'payments', teams: ['factory', 'payments'] });

  expect((board.columns.ideation ?? []).map((card) => card.number)).toEqual([2]);
});

test('checks stored requirement ownership before mutation regardless of query state', async () => {
  const calls: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname.endsWith('/issues/3')) return Response.json(issue(3, 'operations'));
    return new Response(null, { status: 204 });
  });
  const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch }), 'factory');
  const scope = { identity: { issuer: 'issuer', subject: 'alice' }, signal: new AbortController().signal, team: 'payments', teams: ['factory', 'payments'] };

  await expect(service.closeRequirement(3, scope)).rejects.toMatchObject({ message: 'requirement not found', status: 404 });
  expect(calls).toEqual(['GET /api/v1/repos/factory/requirements/issues/3']);
});

test('routes duplicate issue numbers to the selected registered System repository', async () => {
  const paths: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith('/issues/7')) return Response.json(issue(7, 'payments'));
    throw new Error(`unexpected ${url.pathname}`);
  });
  const service = adaptForgejo(new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', { fetch }), 'factory');
  const base = { identity: { issuer: 'issuer', subject: 'alice' }, signal: new AbortController().signal, team: 'payments', teams: ['payments'] };

  await service.getIssue(7, { ...base, repository: { owner: 'payments', name: 'orders', systemId: 'payments/orders' } });
  await service.getIssue(7, { ...base, repository: { owner: 'payments', name: 'ledger', systemId: 'payments/ledger' } });
  expect(paths).toEqual([
    '/api/v1/repos/payments/orders/issues/7',
    '/api/v1/repos/payments/ledger/issues/7',
  ]);
});
