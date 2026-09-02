/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { ForgejoClient } from './client';
import { UpstreamTimeoutError } from '../integrations/fetch';

describe('Forgejo application onboarding API', () => {
  test('applies the Forgejo deadline while preserving caller cancellation', async () => {
    const signals: AbortSignal[] = [];
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      timeoutMs: 1,
      fetch: async (_input, init) => {
        signals.push(init?.signal as AbortSignal);
        return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      },
    });
    await expect(client.ready()).rejects.toBeInstanceOf(UpstreamTimeoutError);

    const caller = new AbortController();
    const reason = new Error('request cancelled');
    const cancelled = client.getIssue(1, caller.signal);
    caller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(signals.every((signal) => signal !== caller.signal)).toBe(true);
  });
  test('lists owner repositories for import', async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const url = new URL(input.toString());
        const method = init.method ?? 'GET';
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ method, path: `${url.pathname}${url.search}`, body });
        if (url.pathname === '/api/v1/orgs/factory/repos') return Response.json([{
          name: 'app', full_name: 'factory/app', description: '', private: true, template: false,
          default_branch: 'main', html_url: 'https://forgejo.example/factory/app',
        }]);
        return new Response(null, { status: 404 });
      },
    });

    expect((await client.listOwnerRepositories('factory')).map((repository) => repository.name)).toEqual(['app']);
    expect(requests).toEqual([{ method: 'GET', path: '/api/v1/orgs/factory/repos?limit=50&page=1', body: undefined }]);
  });

  test('lists only repositories assigned to a named Forgejo team', async () => {
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input) => {
        const url = new URL(input.toString());
        if (url.pathname === '/api/v1/orgs/factory/teams') return Response.json([{ id: 7, name: 'factory-users-payments' }]);
        if (url.pathname === '/api/v1/teams/7/repos') return Response.json([{
          name: 'payments', full_name: 'factory/payments', description: '', private: true, template: false,
          default_branch: 'main', html_url: 'https://forgejo.example/factory/payments',
        }]);
        return new Response(null, { status: 404 });
      },
    });

    expect((await client.listTeamRepositories('factory', 'factory-users-payments')).map((repository) => repository.full_name)).toEqual(['factory/payments']);
    expect(await client.listTeamRepositories('factory', 'factory-users-platform')).toEqual([]);
  });

  test('lists direct collaborators separately from effective permissions', async () => {
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input) => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith('/collaborators')) return Response.json([{ login: 'direct-user', full_name: '', avatar_url: '' }]);
        if (url.pathname.endsWith('/team-user/permission')) return Response.json({ permission: 'write' });
        return new Response(null, { status: 404 });
      },
    });

    expect(await client.directCollaborators('factory', 'app')).toEqual(['direct-user']);
    expect(await client.collaboratorPermission('factory', 'app', 'team-user')).toBe('write');
  });

  test('separates the review approval actor from the admin merge actor', async () => {
    let protection: Record<string, unknown> | undefined;
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const url = new URL(input.toString());
        const method = init.method ?? 'GET';
        if (method === 'GET' && url.pathname.endsWith('/branch_protections/main')) return new Response(null, { status: 404 });
        if (method === 'POST' && url.pathname.endsWith('/branch_protections')) {
          protection = JSON.parse(String(init.body));
          return Response.json(protection);
        }
        return new Response(null, { status: 404 });
      },
    });

    await client.ensureMainBranchProtection('factory', 'app', 'main', {
      mergeActor: 'factory-admin',
      reviewActor: 'factory-review',
    });
    expect(protection).toMatchObject({
      required_approvals: 1,
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: ['factory-admin'],
      push_whitelist_deploy_keys: false,
      enable_merge_whitelist: true,
      merge_whitelist_usernames: ['factory-admin'],
      enable_approvals_whitelist: true,
      approvals_whitelist_username: ['factory-review'],
      block_on_outdated_branch: true,
    });
  });

  test('preserves existing CI status checks while adding Factory checks', async () => {
    let protection: Record<string, unknown> | undefined;
    let calls = 0;
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (_input, init = {}) => {
        calls += 1;
        if (calls === 1) return Response.json({ status_check_contexts: ['ci/test', 'security/scan'] });
        if (calls === 2) { protection = JSON.parse(String(init.body)); return Response.json(protection); }
        return new Response(null, { status: 404 });
      },
    });

    const diff = await client.ensureMainBranchProtection('factory', 'app', 'main', { mergeActor: 'merge', reviewActor: 'review' });
    expect(protection?.status_check_contexts).toEqual(['ci/test', 'security/scan', 'factory/specification', 'factory/verification']);
    expect(diff).toEqual({ created: false, addedStatusChecks: ['factory/specification', 'factory/verification'], preservedStatusChecks: ['ci/test', 'security/scan'] });
  });

  test('fails startup verification when a token belongs to the wrong actor', async () => {
    const client = new ForgejoClient('https://forgejo.example', 'wrong-token', 'factory', 'requirements', 'main', {
      fetch: async () => Response.json({ login: 'factory-admin' }),
    });

    await expect(client.assertAuthenticatedLogin('factory-review')).rejects.toThrow(
      'Forgejo token authenticated as factory-admin; expected factory-review',
    );
  });

  test('delegates only pull review operations to the review token client', async () => {
    const authorizations: string[] = [];
    const fetch = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      authorizations.push(new Headers(init.headers).get('Authorization') ?? '');
      return Response.json({ login: 'actor' });
    };
    const integration = new ForgejoClient('https://forgejo.example', 'admin-token', 'factory', 'requirements', 'main', { fetch });
    const review = new ForgejoClient('https://forgejo.example', 'review-token', 'factory', 'requirements', 'main', { fetch });
    const client = integration.withPullReviewActor(review);

    await client.authenticatedUser();
    await client.listPullReviews('factory', 'app', 1);

    expect(authorizations).toEqual(['token admin-token', 'token review-token']);
  });

  test('protects ticket branches from rewind and deletion while allowing only the implementation identity to push', async () => {
    let protection: Record<string, unknown> | undefined;
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const url = new URL(input.toString());
        if (init.method === 'GET' && url.pathname.endsWith('/branch_protections/factory%2Frequirement-*')) return new Response(null, { status: 404 });
        if (init.method === 'POST' && url.pathname.endsWith('/branch_protections')) {
          protection = JSON.parse(String(init.body));
          return Response.json(protection, { status: 201 });
        }
        return new Response(null, { status: 404 });
      },
    });

    await client.ensureImplementationBranchProtection('factory', 'app', 'factory-implementation');

    expect(protection).toMatchObject({
      rule_name: 'factory/requirement-*',
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: ['factory-implementation'],
      push_whitelist_deploy_keys: false,
      apply_to_admins: true,
    });
  });

  test('removes a legacy Factory implementation rule only when its policy signature still matches', async () => {
    const deleted: string[] = [];
    let protection: Record<string, unknown> = {
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: ['factory-implementation'],
      push_whitelist_teams: [],
      push_whitelist_deploy_keys: false,
      enable_merge_whitelist: false,
      enable_status_check: false,
      required_approvals: 0,
      enable_approvals_whitelist: false,
      block_on_rejected_reviews: false,
      block_on_official_review_requests: false,
      block_on_outdated_branch: false,
      dismiss_stale_approvals: false,
      ignore_stale_approvals: false,
      require_signed_commits: false,
      protected_file_patterns: '',
      unprotected_file_patterns: '',
      apply_to_admins: true,
    };
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const path = new URL(input.toString()).pathname;
        if ((init.method ?? 'GET') === 'GET') return Response.json(protection);
        if (init.method === 'DELETE') deleted.push(path);
        return new Response(null, { status: 204 });
      },
    });

    await client.removeFactoryImplementationBranchProtection('factory', 'app', 'factory-implementation', undefined);
    expect(deleted).toHaveLength(1);

    protection = { ...protection, push_whitelist_usernames: ['factory-implementation', 'operator'] };
    await client.removeFactoryImplementationBranchProtection('factory', 'app', 'factory-implementation', true);
    expect(deleted).toHaveLength(1);
  });

  test('allows recorded contributors on only their exact implementation branch', async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const branch = 'factory/requirement-7-fixed';
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const url = new URL(input.toString());
        const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        requests.push({ method: init.method ?? 'GET', path: url.pathname, body });
        if (!init.body && url.pathname.includes('/branch_protections/')) {
          return Response.json({ push_whitelist_usernames: ['factory-implementation', 'alice'] });
        }
        if (init.method === 'PATCH' && url.pathname.includes('/branch_protections/')) return Response.json(body);
        if (init.method === 'PUT' && url.pathname.endsWith('/collaborators/bob')) return new Response(null, { status: 204 });
        return new Response(null, { status: 404 });
      },
    });

    await client.ensureImplementationContributorAccess('factory', 'app', branch, 'factory-implementation', 'bob');

    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({ permission: 'write' });
    expect(requests.find((request) => request.method === 'PATCH')?.body).toMatchObject({
      enable_push_whitelist: true,
      push_whitelist_usernames: ['factory-implementation', 'bob', 'alice'],
      apply_to_admins: true,
    });
    expect(requests.some((request) => request.path.includes('requirement-*'))).toBe(false);
  });

  test('removes completed branch access and downgrades an inactive contributor to read', async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const url = new URL(input.toString());
        const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        requests.push({ method: init.method ?? 'GET', path: url.pathname, body });
        if (url.pathname.endsWith('/branch_protections') && (init.method ?? 'GET') === 'GET') {
          return Response.json([{ rule_name: 'factory/requirement-*', push_whitelist_usernames: ['factory-implementation'] }]);
        }
        if (url.pathname.includes('/branch_protections/') && (init.method ?? 'GET') === 'GET') {
          return Response.json({ push_whitelist_usernames: ['factory-implementation', 'alice'] });
        }
        if (url.pathname.includes('/branch_protections/') && init.method === 'PATCH') return Response.json(body);
        if (url.pathname.includes('/branch_protections/') && init.method === 'DELETE') return new Response(null, { status: 204 });
        if (url.pathname.endsWith('/collaborators/alice') && init.method === 'PUT') return new Response(null, { status: 204 });
        return new Response(null, { status: 404 });
      },
    });

    await client.releaseImplementationContributorAccess('factory', 'app', 'factory/requirement-7-fixed', 'factory-implementation', 'alice');

    expect(requests.find((request) => request.method === 'PATCH')?.body).toMatchObject({ push_whitelist_usernames: ['factory-implementation'] });
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({ permission: 'read' });
    expect(requests.some((request) => request.method === 'DELETE' && request.path.includes('/branch_protections/'))).toBe(true);
  });

  test('keeps repository write while another exact delivery branch remains active', async () => {
    const collaboratorUpdates: unknown[] = [];
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith('/branch_protections') && (init.method ?? 'GET') === 'GET') {
          return Response.json([{ rule_name: 'factory/requirement-8-other', push_whitelist_usernames: ['factory-implementation', 'alice'] }]);
        }
        if (url.pathname.includes('/branch_protections/') && (init.method ?? 'GET') === 'GET') return Response.json({ push_whitelist_usernames: ['factory-implementation', 'alice'] });
        if (url.pathname.includes('/branch_protections/') && init.method === 'PATCH') return Response.json({});
        if (url.pathname.includes('/branch_protections/') && init.method === 'DELETE') return new Response(null, { status: 204 });
        if (url.pathname.endsWith('/collaborators/alice') && init.method === 'PUT') collaboratorUpdates.push(init.body);
        return new Response(null, { status: 204 });
      },
    });

    await client.releaseImplementationContributorAccess('factory', 'app', 'factory/requirement-7-fixed', 'factory-implementation', 'alice');

    expect(collaboratorUpdates).toEqual([]);
  });

  test('verifies a pre-existing branch still points at its requested origin after create returns 409', async () => {
    const requests: string[] = [];
    const client = new ForgejoClient('https://forgejo.example', 'secret', 'factory', 'requirements', 'main', {
      fetch: async (input, init = {}) => {
        const path = new URL(input.toString()).pathname;
        requests.push(`${init.method ?? 'GET'} ${path}`);
        if (init.method === 'POST') return Response.json({ message: 'exists' }, { status: 409 });
        if (path.endsWith('/branches/main')) return Response.json({ commit: { id: 'base-sha' } });
        if (path.endsWith('/branches/ticket')) return Response.json({ commit: { id: 'other-sha' } });
        return new Response(null, { status: 404 });
      },
    });

    await expect(client.ensureBranch('factory', 'app', 'ticket', 'main', undefined, true)).rejects.toMatchObject({ status: 409 });
    expect(requests).toContain('GET /api/v1/repos/factory/app/branches/ticket');
    expect(requests).toContain('GET /api/v1/repos/factory/app/branches/main');
  });
});
