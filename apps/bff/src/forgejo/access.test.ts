/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, mock, test } from 'bun:test';

import { ForgejoClient } from './client';
import { forgejoTeamAccess } from './access';

test('maps each Factory group only to its team and hides an empty default team', () => {
  expect(forgejoTeamAccess({
    baseTeam: 'factory-users',
    tenantTeam: 'factory',
    tenantGroup: 'tenant-factory',
    teams: [
      { slug: 'factory', group: null },
      { slug: 'payments', group: 'team-payments' },
      { slug: 'operations', group: 'team-operations' },
    ],
    applications: [
      { team: 'payments', repositoryName: 'payments-api' },
      { team: 'operations', repositoryName: 'operations-api' },
    ],
    users: [
      { username: 'alice', groups: ['tenant-factory', 'team-payments'] },
      { username: 'bob', groups: ['tenant-factory', 'team-operations'] },
      { username: 'outsider', groups: ['team-payments'] },
      { username: 'factory-review', groups: ['tenant-factory', 'team-payments', 'team-operations'] },
    ],
    serviceUsers: ['factory-implementation', 'factory-review'],
  })).toEqual([
    { name: 'factory-users', usernames: [], repositories: [] },
    { name: 'factory-users-payments', usernames: ['alice'], repositories: ['payments-api'] },
    { name: 'factory-users-operations', usernames: ['bob'], repositories: ['operations-api'] },
  ]);
});

test('isolates team repositories and denies direct cross-team Forgejo access', async () => {
  const teams = [{ id: 7, name: 'factory-users-payments' }, { id: 8, name: 'factory-users-operations' }];
  const members = new Map([[7, new Set(['alice', 'stale-user', 'factory-review'])], [8, new Set(['bob'])]]);
  const repositories = new Map([[7, new Set(['operations-api', 'stale-api'])], [8, new Set(['payments-api'])]]);
  const patches: unknown[] = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json(teams);
    const teamMatch = url.pathname.match(/^\/api\/v1\/teams\/(\d+)$/);
    if (teamMatch && method === 'PATCH') {
      patches.push(JSON.parse(String(init?.body)));
      return Response.json(teams.find((team) => team.id === Number(teamMatch[1])));
    }
    const collectionMatch = url.pathname.match(/^\/api\/v1\/teams\/(\d+)\/(members|repos)$/);
    if (collectionMatch && method === 'GET') {
      const id = Number(collectionMatch[1]);
      return collectionMatch[2] === 'members'
        ? Response.json([...members.get(id)!].map((login) => ({ login })))
        : Response.json([...repositories.get(id)!].map((name) => ({ name })));
    }
    if (url.pathname.startsWith('/api/v1/users/') && method === 'GET') {
      return Response.json({ login: decodeURIComponent(url.pathname.split('/').at(-1)!) });
    }
    const memberMatch = url.pathname.match(/^\/api\/v1\/teams\/(\d+)\/members\/(.+)$/);
    if (memberMatch) {
      const values = members.get(Number(memberMatch[1]))!;
      method === 'PUT' ? values.add(decodeURIComponent(memberMatch[2]!)) : values.delete(decodeURIComponent(memberMatch[2]!));
      return new Response(null, { status: 204 });
    }
    const repositoryMatch = url.pathname.match(/^\/api\/v1\/teams\/(\d+)\/repos\/factory\/(.+)$/);
    if (repositoryMatch) {
      const values = repositories.get(Number(repositoryMatch[1]))!;
      method === 'PUT' ? values.add(decodeURIComponent(repositoryMatch[2]!)) : values.delete(decodeURIComponent(repositoryMatch[2]!));
      return new Response(null, { status: 204 });
    }
    const projectMatch = url.pathname.match(/^\/api\/v1\/repos\/factory\/(.+)$/);
    if (projectMatch && method === 'GET') {
      const username = new Headers(init?.headers).get('x-forgejo-user');
      const repository = decodeURIComponent(projectMatch[1]!);
      const allowed = teams.some((team) => members.get(team.id)!.has(username ?? '') && repositories.get(team.id)!.has(repository));
      return allowed ? Response.json({ name: repository }) : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.ensureReadTeam('factory', 'factory-users-payments', ['alice'], ['payments-api']);
  await client.ensureReadTeam('factory', 'factory-users-operations', ['bob'], ['operations-api']);

  expect(patches).toEqual([
    expect.objectContaining({ name: 'factory-users-payments', permission: 'read', includes_all_repositories: false }),
    expect.objectContaining({ name: 'factory-users-operations', permission: 'read', includes_all_repositories: false }),
  ]);
  expect(members.get(7)).toEqual(new Set(['alice']));
  expect(repositories.get(7)).toEqual(new Set(['payments-api']));
  expect(repositories.get(8)).toEqual(new Set(['operations-api']));
  expect((await fetch('https://forgejo.example/api/v1/repos/factory/payments-api', { headers: { 'x-forgejo-user': 'alice' } })).status).toBe(200);
  expect((await fetch('https://forgejo.example/api/v1/repos/factory/operations-api', { headers: { 'x-forgejo-user': 'alice' } })).status).toBe(404);
});

test('paginates team, member, and repository listings before reconciling access', async () => {
  const calls: string[] = [];
  const firstTeams = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, name: `other-${index}` }));
  const firstMembers = Array.from({ length: 50 }, (_, index) => ({ login: `active-${index}` }));
  const firstRepositories = Array.from({ length: 50 }, (_, index) => ({ name: `active-${index}` }));
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json(url.searchParams.get('page') === '1' ? firstTeams : [{ id: 77, name: 'factory-users' }]);
    if (url.pathname === '/api/v1/teams/77' && init?.method === 'PATCH') return Response.json({ id: 77, name: 'factory-users' });
    if (url.pathname === '/api/v1/teams/77/members') return Response.json(url.searchParams.get('page') === '1' ? firstMembers : [{ login: 'stale-user' }]);
    if (url.pathname === '/api/v1/teams/77/repos') return Response.json(url.searchParams.get('page') === '1' ? firstRepositories : [{ name: 'stale-repository' }]);
    return new Response(null, { status: 204 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.ensureReadTeam('factory', 'factory-users', firstMembers.map((member) => member.login), firstRepositories.map((repository) => repository.name));

  expect(calls).toContain('GET /api/v1/orgs/factory/teams?limit=50&page=2');
  expect(calls).toContain('GET /api/v1/teams/77/members?limit=50&page=2');
  expect(calls).toContain('GET /api/v1/teams/77/repos?limit=50&page=2');
  expect(calls).toContain('DELETE /api/v1/teams/77/members/stale-user');
  expect(calls).toContain('DELETE /api/v1/teams/77/repos/factory/stale-repository');
});

test('creates an empty scoped team when it is absent', async () => {
  const methods: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    methods.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === '/api/v1/orgs/factory/teams' && init?.method === 'GET') return Response.json([]);
    if (url.pathname === '/api/v1/orgs/factory/teams' && init?.method === 'POST') return Response.json({ id: 9, name: 'factory-users' }, { status: 201 });
    if (init?.method === 'GET') return Response.json([]);
    return new Response(null, { status: 204 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.ensureReadTeam('factory', 'factory-users', [], []);

  expect(methods).toEqual([
    'GET /api/v1/orgs/factory/teams',
    'POST /api/v1/orgs/factory/teams',
    'GET /api/v1/teams/9/members',
    'GET /api/v1/teams/9/repos',
  ]);
});

test('can reconcile team membership without racing lifecycle-owned repository access', async () => {
  const calls: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json([{ id: 7, name: 'factory-users-payments' }]);
    if (url.pathname === '/api/v1/teams/7' && init?.method === 'PATCH') return Response.json({ id: 7, name: 'factory-users-payments' });
    if (url.pathname === '/api/v1/teams/7/members') return Response.json([]);
    if (url.pathname === '/api/v1/users/alice') return Response.json({ login: 'alice' });
    return new Response(null, { status: 204 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.ensureReadTeam('factory', 'factory-users-payments', ['alice'], ['payments-api'], undefined, false);

  expect(calls).toContain('PUT /api/v1/teams/7/members/alice');
  expect(calls.some((call) => call.includes('/repos'))).toBe(false);
});

test('uses an existing team only when it is already least privilege', async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json([{ id: 7, name: 'factory-users', permission: 'read', includes_all_repositories: false, can_create_org_repo: false, units_map: { 'repo.code': 'read', 'repo.issues': 'read', 'repo.pulls': 'read', 'repo.releases': 'read' } }]);
    return new Response(null, { status: 204 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.ensureTeamRepository('factory', 'factory-users', 'payments-api');

  expect(calls).toEqual([
    { method: 'GET', path: '/api/v1/orgs/factory/teams?limit=50&page=1' },
    { method: 'PUT', path: '/api/v1/teams/7/repos/factory/payments-api' },
  ]);
});

test('refuses to mutate an existing overprivileged team during onboarding', async () => {
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', {
    fetch: async () => Response.json([{ id: 7, name: 'factory-users', permission: 'write', includes_all_repositories: false, can_create_org_repo: false }]),
  });

  await expect(client.ensureTeamRepository('factory', 'factory-users', 'payments-api')).rejects.toMatchObject({ status: 409 });
});

test('removes only the named team repository assignment and automation collaborator', async () => {
  const calls: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/v1/orgs/factory/teams') {
      return Response.json([{ id: 7, name: 'factory-users-payments' }, { id: 8, name: 'operators' }]);
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.removeTeamRepository('factory', 'factory-users-payments', 'payments-api');
  await client.removeCollaborator('factory', 'payments-api', 'factory-implementation');

  expect(calls).toContain('DELETE /api/v1/teams/7/repos/factory/payments-api');
  expect(calls).toContain('DELETE /api/v1/repos/factory/payments-api/collaborators/factory-implementation');
  expect(calls.some((call) => call.includes('/teams/8/'))).toBe(false);
});

test('removes a Factory-created policy but preserves operator policy fields when removing checks', async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (method === 'GET') return Response.json({
      status_check_contexts: ['operator/scan', 'factory/specification', 'factory/verification'],
      required_approvals: 2,
      protected_file_patterns: 'release/**',
    });
    return new Response(null, { status: 204 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.removeFactoryMainBranchProtection('factory', 'app', 'main', {
    created: false, addedStatusChecks: ['factory/specification', 'factory/verification'],
  });
  await client.removeFactoryMainBranchProtection('factory', 'app', 'release', {
    created: true, addedStatusChecks: ['factory/specification', 'factory/verification'],
  });

  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
    status_check_contexts: ['operator/scan'], enable_status_check: true,
  });
  expect(calls).not.toContainEqual({ method: 'DELETE', path: '/api/v1/repos/factory/app/branch_protections/release' });
});

test('waits for a database user to sign in to Forgejo before adding team membership', async () => {
  let userExists = false;
  const calls: string[] = [];
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json([{ id: 7, name: 'factory-users' }]);
    if (url.pathname === '/api/v1/teams/7' && init?.method === 'PATCH') return Response.json({ id: 7, name: 'factory-users' });
    if (url.pathname === '/api/v1/teams/7/members' || url.pathname === '/api/v1/teams/7/repos') return Response.json([]);
    if (url.pathname === '/api/v1/users/implementer') return userExists ? Response.json({ login: 'implementer' }) : new Response(null, { status: 404 });
    return new Response(null, { status: 204 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  await client.ensureReadTeam('factory', 'factory-users', ['implementer'], []);
  expect(calls).not.toContain('PUT /api/v1/teams/7/members/implementer');
  userExists = true;
  await client.ensureReadTeam('factory', 'factory-users', ['implementer'], []);
  expect(calls).toContain('PUT /api/v1/teams/7/members/implementer');
});

test('does not swallow membership or authentication 404 responses', async () => {
  const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json([{ id: 7, name: 'factory-users' }]);
    if (url.pathname === '/api/v1/teams/7' && init?.method === 'PATCH') return Response.json({ id: 7, name: 'factory-users' });
    if (url.pathname === '/api/v1/teams/7/members' || url.pathname === '/api/v1/teams/7/repos') return Response.json([]);
    if (url.pathname === '/api/v1/users/alice') return Response.json({ login: 'alice' });
    return new Response(null, { status: 404 });
  });
  const client = new ForgejoClient('https://forgejo.example', 'token', 'factory', 'requirements', 'main', { fetch });

  expect(client.ensureReadTeam('factory', 'factory-users', ['alice'], [])).rejects.toThrow('Forgejo returned 404');
  expect(client.authenticatedUser()).rejects.toThrow('Forgejo returned 404');
});
