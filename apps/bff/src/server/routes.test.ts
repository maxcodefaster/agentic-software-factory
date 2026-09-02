/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createInterviewOperationReconciler, createServer } from './routes';
import { createHttpBoundary, SPA_CONTENT_SECURITY_POLICY, type RequestLog } from './boundary';
import type {
  AuthService,
  CoderService,
  ForgejoService,
  Identity,
  ServerServices,
  InterviewState,
} from './types';
import type { ApplicationDefinition } from '../applications/catalog';
import { coderWorkspaceName } from '../applications/catalog';
import { ApplicationError } from '../errors';
import { UpstreamHttpError } from '../integrations/fetch';

const identity: Identity = {
  issuer: 'https://issuer.example',
  subject: 'alice-id',
  email: 'alice@example.test',
  emailVerified: true,
  name: 'Alice',
  groups: ['tenant-factory', 'tenant-factory-business', 'tenant-factory-developer'],
};

const board = {
  repository: 'factory/requirements',
  total: 1,
  truncated: false,
  nextCursor: null,
  columns: {
    ideation: [],
    requirements: [
      {
        number: 2,
        title: 'Visible card',
        body: 'Outcome',
        url: 'https://forgejo.example/factory/requirements/issues/2',
        status: 'requirements',
        labels: [],
        author: 'alice',
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T01:00:00Z',
        applications: [],
      },
    ],
    implementation: [],
    done: [],
  },
};

const emptyState = {
  version: 0,
  runId: '',
  chatId: null,
  turns: [],
  pending: null,
  pendingOperation: null,
  done: false,
  startedAt: '',
  startedBy: '',
  retakes: 0,
};

const application: ApplicationDefinition = {
  id: 'factory/agentic-software-factory-app', team: 'factory', name: 'Example Application', description: 'Example application',
  repositoryOwner: 'factory', repositoryName: 'agentic-software-factory-app',
  repositoryUrl: 'https://forgejo.example/factory/agentic-software-factory-app',
  cloneUrl: 'http://forgejo/factory/agentic-software-factory-app.git', defaultBranch: 'main',
  defaultSha: 'a'.repeat(40),
  declaredApps: [{ slug: 'preview', displayName: 'Live preview' }],
};

const requirementSpec = {
  goal: 'Faster onboarding', users: ['Engineers'], userStories: ['As an engineer, I can onboard.'],
  acceptanceCriteria: ['Onboarding completes.'], nonFunctionalRequirements: [],
  moscow: { must: ['Onboarding'], should: [], could: [] }, openQuestions: [], nonGoals: [],
};

function services(overrides: Partial<ServerServices> = {}) {
  const transition = mock(async (number: number, status: string) => ({
    number,
    title: 'Moved',
    body: 'Body',
    status,
    updatedAt: '2026-08-20T02:00:00Z',
  }));
  const forgejo: ForgejoService = {
    ready: mock(async () => undefined),
    board: mock(async () => board),
    createRequirement: mock(async ({ title, body }) => ({
      number: 3,
      title,
      body,
      status: 'ideation',
      updatedAt: '2026-08-20T01:00:00Z',
    })),
    updateRequirement: mock(async (number, input) => ({
      number,
      title: input.title ?? 'Requirement',
      body: input.body ?? 'Body',
      status: 'ideation',
      updatedAt: '2026-08-20T02:00:00Z',
    })),
    closeRequirement: mock(async () => undefined),
    transition,
    accept: mock(async () => ({ requirementId: 'req_1' })),
    getProposal: mock(async () => ({ specification: {} })),
    propose: mock(async () => ({ proposedBy: 'coder#owner-1' })),
    getInterview: mock(async () => ({
      state: emptyState,
      spec: null,
    })),
    reconcilableInterviews: mock(async () => []),
    beginInterview: mock(async (_number, _actor, _retake, binding, pending) => ({ ...emptyState, ...binding, version: 1, pending })),
    prepareInterviewAnswer: mock(async (_number, actor, answer, payload, operationId) => ({
      ...emptyState,
      version: answer.expectedVersion,
      runId: 'run-1',
      chatId: 'chat-1',
      pendingOperation: { operationId, answer, payload, previousQuestionId: answer.questionId, expectedVersion: answer.expectedVersion, phase: 'answer' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: actor },
    })),
    setInterviewOperationPhase: mock(async (_number, operationId) => ({ ...emptyState, runId: 'run-1', pendingOperation: { operationId, answer: { questionId: 'q', expectedVersion: 1, selected: [], customText: 'answer' }, payload: 'answer', previousQuestionId: 'q', expectedVersion: 1, phase: 'proposal' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: 'alice' } })),
    setInterviewOperationFailure: mock(async () => ({ ...emptyState })),
    completeInterviewAnswer: mock(async () => ({ ...emptyState, version: 2, runId: 'run_1', done: true })),
    recordInterviewRefinement: mock(async () => ({ ...emptyState, version: 2, runId: 'run_1' })),
    getIssue: mock(async () => ({ title: 'Requirement', body: 'Body', status: 'requirements', team: 'factory', applications: [] })),
    events: mock(async () => []),
  };
  const coder: CoderService = {
    summary: mock(async () => ({ count: 0, workspaces: [], available: false })),
    developerSummary: mock(async () => ({ count: 0, workspaces: [], available: false })),
    developmentTools: mock(async () => ({ coderIdentity: true, forgejoConnected: true, forgejoUsername: 'developer', connectUrl: 'https://coder.example/external-auth/forgejo' })),
    ensureDeveloperWorkspace: mock(async () => ({ id: 'workspace-1', name: 'developer-app', template: 'Agentic Software Factory', status: 'running', healthy: true, lastUsedAt: '2026-08-20T01:00:00Z', url: 'https://coder.example/workspace', apps: [], parameters: { workspace_kind: 'developer' } })),
    developerWorkspaceById: mock(async () => ({ id: 'workspace-1', name: 'developer-app', template: 'Agentic Software Factory', status: 'running', healthy: true, lastUsedAt: '2026-08-20T01:00:00Z', url: 'https://coder.example/workspace', apps: [], parameters: { workspace_kind: 'developer' } })),
    chatCapability: mock(async () => ({ available: false, reason: 'not configured' })),
    interviewReadiness: mock(async () => ({ available: true })),
    startRequirementsChat: mock(async () => ({ chatId: 'chat-1', question: { id: 'q-1', header: 'Scope', prompt: 'Which outcome matters?', type: 'single' as const, options: [{ value: 'option-0', label: 'A', description: null }, { value: 'option-1', label: 'B', description: null }], allowCustom: true, hint: null } })),
    answerRequirementsChat: mock(async () => null),
    sharpenRequirementsChat: mock(async () => null),
    submitRequirementsProposal: mock(async () => undefined),
    chatUrl: (chatId) => `https://coder.example/agents/${chatId}`,
  };
  const auth: AuthService = {
    uiConfig: { localEmailPassword: true, organizationSignIn: true, postLoginRedirect: '/' },
    authenticate: mock(async (request) =>
      request.headers.get('authorization') === 'Bearer valid' ? identity : null),
    authenticateMcp: mock(async (request) => request.headers.get('authorization') === 'Bearer coder-oidc' ? identity.subject : null),
    handle: mock(async (action) => Response.json({ action })),
    handler: mock(async () => Response.json({ protocol: 'oauth' }, { status: 400 })),
    logoutBridgeRequest: mock(async () => Response.redirect('http://bff.local/login', 303)),
  };
  const value: ServerServices = {
    forgejo,
    coder,
    auth,
    authPublicOrigin: 'https://factory.example',
    coderPublicUrl: 'https://coder.example',
    applications: {
      list: mock(async () => [application]),
      get: mock(async (id: string) => id === application.id ? application : null),
    },
    listUsers: mock(async () => ({ users: [] })),
    startedAt: Date.now() - 5_000,
    tenant: {
      id: 'factory', group: 'tenant-factory', adminGroup: 'tenant-factory-admin',
      businessGroup: 'tenant-factory-business', developerGroup: 'tenant-factory-developer',
      teams: [{ slug: 'factory', displayName: 'Factory', group: null }],
    },
    identityByUserId: mock(async () => identity),
    log: () => undefined,
    ...overrides,
  };
  return { value, forgejo, coder, transition, auth };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://bff.local${path}`, init);
}

async function settle(): Promise<void> {
  await Bun.sleep(0);
  await Bun.sleep(0);
}

async function eventually(assertion: () => void): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { assertion(); return; } catch (error) { failure = error; }
    await Bun.sleep(2);
  }
  throw failure;
}

test('leaves OAuth form bodies unread for the delegated auth handler', async () => {
  const base = services();
  const handler = mock(async (incoming: Request) => {
    expect(incoming.bodyUsed).toBe(false);
    const form = await incoming.formData();
    return Response.json({ grantType: form.get('grant_type') });
  });
  const app = createServer(services({ auth: { ...base.auth, handler } }).value);
  const response = await app.handle(request('/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code' }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ grantType: 'authorization_code' });
});

async function mcp(app: ReturnType<typeof createServer>, method: string, params: unknown) {
  const response = await app.handle(
    request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        authorization: 'Bearer coder-oidc',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return { response, body: (await response.json()) as Record<string, any> };
}

describe('Agentic Software Factory Elysia server', () => {
  let webRoot = '';

  beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'factory-web-'));
    await Bun.write(join(webRoot, 'index.html'), '<h1>Portal</h1>');
    await Bun.write(join(webRoot, 'asset.txt'), 'asset');
    await Bun.write(join(webRoot, 'main.ABCDEFGH.js.map'), '{}');
    await Bun.write(join(webRoot, 'manifest.webmanifest'), '{}');
    await Bun.write(join(webRoot, 'internal'), 'not the application shell');
    await Bun.write(join(webRoot, 'main.ABCDEFGH.js'), 'hashed');
    await Bun.write(join(webRoot, 'chunk-I7VILU2Z.js'), 'angular hashed');
    await Bun.write(join(webRoot, 'bootstrap.js'), 'bootstrap');
    await Bun.write(join(webRoot, 'branding.css'), 'branding');
    await Bun.write(join(webRoot, 'favicon.ico'), 'icon');
    await Bun.write(join(webRoot, 'favicon.svg'), '<svg></svg>');
    await mkdir(join(webRoot, 'i18n'), { recursive: true });
    await Bun.write(join(webRoot, 'i18n/en.json'), '{}');
  });

  afterAll(async () => {
    await rm(webRoot, { recursive: true, force: true });
  });

  test('exposes observational liveness, readiness, and optional capability status', async () => {
    const fixture = services();
    const app = createServer(fixture.value);
    const health = await app.handle(request('/healthz'));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', uptimeSeconds: 5 });
    const ready = await app.handle(request('/readyz'));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ready', dependencies: { database: 'ready', forgejo: 'ready' } });

    const unavailable = services({
      forgejo: { ...fixture.forgejo, ready: async () => { throw new Error('down'); } },
    });
    const readiness = await createServer(unavailable.value).handle(request('/readyz'));
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ status: 'not-ready', dependencies: { database: 'ready', forgejo: 'not-ready' } });

    const databaseUnavailable = services({ databaseReady: async () => { throw new Error('down'); } });
    const databaseReadiness = await createServer(databaseUnavailable.value).handle(request('/readyz'));
    expect(databaseReadiness.status).toBe(503);
    expect(await databaseReadiness.json()).toEqual({ status: 'not-ready', dependencies: { database: 'not-ready', forgejo: 'ready' } });

    const aiUnavailable = services({
      coder: { ...fixture.coder, interviewReadiness: async () => ({ available: false, reason: 'provider down' }) },
      auth: { ...fixture.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'tenant-factory-admin'] })) },
    });
    const aiReadiness = await createServer(aiUnavailable.value).handle(request('/readyz'));
    expect(aiReadiness.status).toBe(200);
    expect(await aiReadiness.json()).toEqual({ status: 'ready', dependencies: { database: 'ready', forgejo: 'ready' } });
    const status = await createServer(aiUnavailable.value).handle(request('/statusz', {
      headers: { authorization: 'Bearer valid' },
    }));
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ status: 'ok', capabilities: { aiInterview: 'unavailable', aiInterviewReason: 'provider down' } });
  });

  test('keeps diagnostic traffic available after reconciliation failure and reports recovery', async () => {
    let reconciliationError: Error | null = new Error('Forgejo human access failed');
    const systemsReady = mock(async () => {
      if (reconciliationError) throw reconciliationError;
    });
    const app = createServer(services({ systemsReady }).value);
    const response = await app.handle(request('/readyz'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'not-ready',
      dependencies: { database: 'ready', forgejo: 'ready', systems: 'not-ready' },
    });
    expect(systemsReady).toHaveBeenCalledTimes(1);

    reconciliationError = null;
    const recovered = await app.handle(request('/readyz'));
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      status: 'ready',
      dependencies: { database: 'ready', forgejo: 'ready', systems: 'ready' },
    });
  });

  test('reports persisted System degradation without taking readiness down while one System is usable', async () => {
    const systemsStatus = mock(async () => ({
      status: 'degraded' as const,
      counts: { total: 2, registered: 2, usable: 1, degraded: 1 },
      onboarding: { ready: 2, reconciling: 0, repair: 0, failed: 0, missing: 0 },
      registry: { current: 1, stale: 1, missing: 0, loadErrors: 1 },
      staging: { healthy: 1, stale: 0, reconciling: 0, failed: 1, missing: 0 },
      degradedSystems: [{
        systemId: 'factory/broken',
        onboarding: { phase: 'ready' as const, error: null, updatedAt: '2026-09-01T11:59:00.000Z' },
        registry: { status: 'stale' as const, updatedAt: '2026-09-01T11:59:00.000Z', error: 'Forgejo unavailable' },
        staging: { status: 'failed' as const, phase: 'failed' as const, updatedAt: '2026-09-01T11:59:00.000Z', error: 'workspace failed' },
      }],
    }));
    const base = services();
    const fixture = services({
      systemsStatus,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'tenant-factory-admin'] })) },
    });
    const app = createServer(fixture.value);

    const ready = await app.handle(request('/readyz'));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: 'ready',
      dependencies: { database: 'ready', forgejo: 'ready', systems: 'ready' },
      systems: {
        status: 'degraded',
        counts: { total: 2, registered: 2, usable: 1, degraded: 1 },
        onboarding: { ready: 2, reconciling: 0, repair: 0, failed: 0, missing: 0 },
        registry: { current: 1, stale: 1, missing: 0, loadErrors: 1 },
        staging: { healthy: 1, stale: 0, reconciling: 0, failed: 1, missing: 0 },
      },
    });

    const status = await app.handle(request('/statusz', { headers: { authorization: 'Bearer valid' } }));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      status: 'ok',
      systems: {
        status: 'degraded',
        counts: { total: 2, registered: 2, usable: 1, degraded: 1 },
      },
    });
    expect(systemsStatus).toHaveBeenCalledTimes(2);
  });

  test('restricts capability status to tenant administrators', async () => {
    const base = services();
    const admin = { ...identity, groups: [...identity.groups!, 'tenant-factory-admin'] };
    const app = createServer(services({
      auth: {
        ...base.auth,
        authenticate: mock(async (incoming) => incoming.headers.get('authorization') === 'Bearer admin' ? admin : incoming.headers.get('authorization') === 'Bearer valid' ? identity : null),
      },
    }).value);

    expect((await app.handle(request('/statusz'))).status).toBe(401);
    expect((await app.handle(request('/statusz', { headers: { authorization: 'Bearer valid' } }))).status).toBe(403);
    expect((await app.handle(request('/statusz', { headers: { authorization: 'Bearer admin' } }))).status).toBe(200);
  });

  test('returns not-ready when persisted state has registered Systems but none are usable', async () => {
    const systemsStatus = mock(async () => ({
      status: 'not-ready' as const,
      counts: { total: 1, registered: 1, usable: 0, degraded: 1 },
      onboarding: { ready: 1, reconciling: 0, repair: 0, failed: 0, missing: 0 },
      registry: { current: 0, stale: 1, missing: 0, loadErrors: 1 },
      staging: { healthy: 0, stale: 1, reconciling: 0, failed: 0, missing: 0 },
      degradedSystems: [],
    }));

    const ready = await createServer(services({ systemsStatus }).value).handle(request('/readyz'));

    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      status: 'not-ready',
      dependencies: { database: 'ready', forgejo: 'ready', systems: 'not-ready' },
      systems: { status: 'not-ready', counts: { registered: 1, usable: 0 } },
    });
  });

  test('blocks API mutations until external services are ready', async () => {
    let dependencyError: Error | null = new Error('actors are initializing');
    const systemsReady = mock(async () => {
      if (dependencyError) throw dependencyError;
    });
    const fixture = services({ systemsReady });
    const app = createServer(fixture.value);
    const mutation = () => app.handle(request('/api/v1/requirements', {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Ready gate', body: 'Only mutate after actor initialization.' }),
    }));

    const blocked = await mutation();
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toEqual({ error: 'external services are not ready' });
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();
    expect((await app.handle(request('/api/v1/session', { headers: { authorization: 'Bearer valid' } }))).status).toBe(200);
    expect((await app.handle(request('/auth/logout', { method: 'POST' }))).status).toBe(200);

    dependencyError = null;
    const ready = await mutation();
    expect(ready.status).toBe(201);
    expect(fixture.forgejo.createRequirement).toHaveBeenCalledTimes(1);
  });

  test('exposes only the current logout route', async () => {
    const fixture = services();
    const app = createServer(fixture.value);
    for (const path of ['/auth/login', '/api/auth/login']) expect((await app.handle(request(path))).status).toBe(404);
    expect((await app.handle(request('/api/auth/logout', { method: 'POST' }))).status).toBe(404);
    expect((await app.handle(request('/auth/exchange', { method: 'POST' }))).status).toBe(404);
    expect((await app.handle(request('/api/auth/exchange', { method: 'POST' }))).status).toBe(404);
    expect((await app.handle(request('/api/v1/me', { headers: { authorization: 'Bearer valid' } }))).status).toBe(404);
    expect((await app.handle(request('/api/v1/developer-context', { headers: { authorization: 'Bearer valid' } }))).status).toBe(404);
    expect((await app.handle(request('/auth/logout'))).status).toBe(404);
    expect((await app.handle(request('/auth/logout', { method: 'POST' }))).status).toBe(200);
    expect(fixture.auth.handle).toHaveBeenCalledTimes(1);
  });

  test('publishes the strict auth presentation config without a session and disables storage', async () => {
    const fixture = services();
    const response = await createServer(fixture.value).handle(request('/auth/config'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      localEmailPassword: true,
      organizationSignIn: true,
      postLoginRedirect: '/',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fixture.auth.authenticate).not.toHaveBeenCalled();
  });

  test('redirects anonymous root requests to the configured HTTPS auth origin', async () => {
    const fixture = services({ webRoot });
    const app = createServer(fixture.value);
    const response = await app.handle(request('/'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://factory.example/login?return_to=%2F');
    expect((await app.handle(request('/', { method: 'HEAD' }))).status).toBe(302);
    expect(fixture.auth.authenticate).toHaveBeenCalledTimes(2);
  });

  test('routes signed downstream logout bridges through the auth service', async () => {
    const fixture = services();
    const response = await createServer(fixture.value).handle(request('/__factory/logout?payload=a&signature=b'));
    expect(response.status).toBe(303);
    expect(fixture.auth.logoutBridgeRequest).toHaveBeenCalled();
  });

  test('projects shared default-branch staging without exposing another developer IDE', async () => {
    const developerSummary = mock(async () => ({ count: 0, workspaces: [], available: true }));
    const stagingWorkspace = {
      id: 'staging-1', name: coderWorkspaceName('staging', application.cloneUrl), owner: 'factory-stage', template: 'agentic-software-factory', status: 'running', transition: 'start', healthy: true, outdated: false,
      lastUsedAt: '2026-08-20T01:00:00Z', apps: [{ slug: 'preview', displayName: 'Live preview', url: 'https://preview.example', health: 'healthy' as const }],
      parameters: { repository_url: application.cloneUrl, repository_ref: application.defaultSha, workspace_kind: 'staging' },
    };
    const fixture = services({
      coder: { ...services().value.coder, developerSummary },
      staging: { snapshot: async () => ({ applicationId: application.id, repositoryRef: application.defaultSha, workspace: stagingWorkspace, reconciling: false, error: null, updatedAt: '2026-08-20T01:00:00Z', phase: 'healthy' as const, attempts: 1 }), reconcileById: mock(async () => undefined), retry: mock(async () => undefined) },
    });
    const response = await createServer(fixture.value).handle(request('/api/v1/applications?team=factory', { headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(200);
    const body = await response.json() as { applications: Array<Record<string, unknown>> };
    expect(body).toMatchObject({ applications: [{
      id: application.id, name: 'Example Application', workspaceId: null, workspaceUrl: null, ideUrl: null,
      apps: [{ slug: 'preview', url: expect.stringContaining('preview.example'), health: 'healthy' }],
      releasesUrl: '/factory/agentic-software-factory-app/releases',
    }] });
    expect(body.applications[0]).not.toHaveProperty('services');
    expect(developerSummary).toHaveBeenCalled();
    expect(fixture.value.applications.list).toHaveBeenCalled();
  });

  test('lists only applications assigned to the selected visible team', async () => {
    const base = services();
    const paymentsApplication = { ...application, id: 'payments/app', team: 'payments', name: 'Payments' };
    const operationsApplication = { ...application, id: 'operations/app', team: 'operations', name: 'Operations' };
    const fixture = services({
      applications: {
        list: mock(async () => [paymentsApplication, operationsApplication]),
        get: mock(async () => null),
      },
      tenant: { ...base.value.tenant, teams: [
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments', 'team-operations'] })) },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/applications?team=payments', { headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(200);
    expect((await response.json() as any).applications.map((item: any) => item.id)).toEqual([paymentsApplication.id]);

    const missing = await createServer(fixture.value).handle(request('/api/v1/applications', { headers: { authorization: 'Bearer valid' } }));
    expect(missing.status).toBe(400);
    const empty = await createServer(fixture.value).handle(request('/api/v1/applications?team=', { headers: { authorization: 'Bearer valid' } }));
    expect(empty.status).toBe(400);

    const paymentsOnly = services({
      applications: fixture.value.applications,
      tenant: fixture.value.tenant,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments'] })) },
    });
    const hidden = await createServer(paymentsOnly.value).handle(request('/api/v1/applications?team=operations', { headers: { authorization: 'Bearer valid' } }));
    expect(hidden.status).toBe(404);
  });

  test('returns an assignment-safe user directory to business editors without email', async () => {
    const listUsers = mock(async () => ({ users: [{
      id: 'alice-id', username: 'alice', displayName: 'Alice Example', email: 'alice@example.test', initials: 'AE',
    }] }));
    const response = await createServer(services({ listUsers }).value).handle(request('/api/v1/users', {
      headers: { authorization: 'Bearer valid' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [{
      id: 'alice-id', username: 'alice', displayName: 'Alice Example', initials: 'AE',
    }] });
    expect(listUsers).toHaveBeenCalledTimes(1);
    expect(listUsers).toHaveBeenCalledWith({ groups: undefined, limit: 100 });
  });

  test('denies the user directory only to tenant readers', async () => {
    const base = services();
    const listUsers = mock(async () => ({ users: [{
      id: 'alice-id', username: 'alice', displayName: 'Alice', email: 'alice@example.test', initials: 'A',
    }] }));
    const fixture = services({
      listUsers,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory'] })) },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/users', {
      headers: { authorization: 'Bearer valid' },
    }));

    expect(response.status).toBe(403);
    expect(listUsers).not.toHaveBeenCalled();
  });

  test('filters assignment users to the selected visible team', async () => {
    const base = services();
    const users = [
      { id: 'payments-id', username: 'payments', displayName: 'Payments User', email: 'payments@example.test', initials: 'PU' },
      { id: 'operations-id', username: 'operations', displayName: 'Operations User', email: 'operations@example.test', initials: 'OU' },
    ];
    const fixture = services({
      listUsers: mock(async ({ groups }) => ({ users: users.filter((candidate) => !groups?.length || groups.includes(candidate.id === 'payments-id' ? 'team-payments' : 'team-operations')) })),
      tenant: { ...base.value.tenant, teams: [
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments', 'team-operations'] })) },
      identityByUserId: mock(async (subject) => ({
        ...identity,
        subject,
        groups: ['tenant-factory', subject === 'payments-id' ? 'team-payments' : 'team-operations'],
      })),
    });
    const app = createServer(fixture.value);

    const ambiguous = await app.handle(request('/api/v1/users', { headers: { authorization: 'Bearer valid' } }));
    expect(ambiguous.status).toBe(400);

    const response = await app.handle(request('/api/v1/users?team=payments', { headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [{ id: 'payments-id', username: 'payments', displayName: 'Payments User', initials: 'PU' }] });
    expect(fixture.value.listUsers).toHaveBeenCalledWith({ groups: ['team-payments'], limit: 100 });
    expect(fixture.value.identityByUserId).not.toHaveBeenCalled();

    const hidden = services({
      ...fixture.value,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments'] })) },
    });
    const denied = await createServer(hidden.value).handle(request('/api/v1/users?team=operations', { headers: { authorization: 'Bearer valid' } }));
    expect(denied.status).toBe(404);
  });

  test('allows only tenant administrators to deprovision another tenant user', async () => {
    const base = services();
    const deprovisionUser = mock(async (id: string) => ({
      id, status: 'deprovisioned' as const, persisted: true as const,
      coder: { status: 'suspended' as const, revokedTokenCount: 2 },
      forgejo: { status: 'requested' as const, immediate: true },
    }));
    const app = createServer(services({
      deprovisionUser,
      auth: { ...base.auth, authenticate: mock(async (incoming) => incoming.headers.get('authorization') === 'Bearer valid'
        ? { ...identity, groups: [...identity.groups!, 'tenant-factory-admin'] }
        : null) },
    }).value);

    const response = await app.handle(request('/api/v1/users/bob-id/deprovision', { method: 'POST', headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: 'bob-id', status: 'deprovisioned', persisted: true,
      coder: { status: 'suspended', revokedTokenCount: 2 },
      forgejo: { status: 'requested', immediate: true },
    });
    expect(deprovisionUser).toHaveBeenCalledWith('bob-id');

    const nonAdmin = await createServer(services({ deprovisionUser }).value).handle(request('/api/v1/users/bob-id/deprovision', {
      method: 'POST', headers: { authorization: 'Bearer valid' },
    }));
    expect(nonAdmin.status).toBe(403);
    const unauthenticated = await app.handle(request('/api/v1/users/bob-id/deprovision', { method: 'POST' }));
    expect(unauthenticated.status).toBe(401);
  });

  test('rejects self-deprovision and invalid or foreign user IDs without changing authority', async () => {
    const base = services();
    const deprovisionUser = mock(async () => null);
    const app = createServer(services({
      deprovisionUser,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'tenant-factory-admin'] })) },
    }).value);
    const headers = { authorization: 'Bearer valid' };

    expect((await app.handle(request('/api/v1/users/alice-id/deprovision', { method: 'POST', headers }))).status).toBe(409);
    expect((await app.handle(request('/api/v1/users/%20/deprovision', { method: 'POST', headers }))).status).toBe(400);
    expect((await app.handle(request('/api/v1/users/foreign-id/deprovision', { method: 'POST', headers }))).status).toBe(404);
    expect(deprovisionUser).toHaveBeenCalledTimes(1);
  });

  test('allows developers and admins to onboard Systems while denying business users', async () => {
    const applicationOnboarding = {
      availableRepositories: mock(async () => [{ name: 'new-app', fullName: 'factory/new-app', description: '', defaultBranch: 'main', repositoryUrl: 'https://git/new-app' }]),
      attempts: mock(async () => []),
      loadErrors: mock(() => []),
      reconcileDue: mock(async () => undefined),
      teamFor: mock(async () => null),
      canRegister: mock(async () => true),
      reassign: mock(async () => ({ ...application, team: 'payments' })),
      unregister: mock(async () => undefined),
      createRemediation: mock(async () => ({ pullNumber: 1, pullUrl: 'https://git/pulls/1', branch: 'factory/remediate' })),
      register: mock(async () => ({ ...application, id: 'factory/new-app', repositoryName: 'new-app' })),
    };
    const businessBase = services({ applicationOnboarding });
    const business = services({
      applicationOnboarding,
      auth: { ...businessBase.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-business'] })) },
    });
    const denied = await createServer(business.value).handle(request('/api/v1/applications/onboarding/repositories', { headers: { authorization: 'Bearer valid' } }));
    expect(denied.status).toBe(403);
    expect(applicationOnboarding.availableRepositories).not.toHaveBeenCalled();

    const developerBase = services({ applicationOnboarding });
    const developer = services({
      applicationOnboarding,
      auth: { ...developerBase.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-developer'] })) },
    });
    expect((await createServer(developer.value).handle(request('/api/v1/applications/onboarding/repositories', { headers: { authorization: 'Bearer valid' } }))).status).toBe(200);

    const adminIdentity = { ...identity, groups: ['tenant-factory', 'tenant-factory-admin'] };
    const admin = services({
      applicationOnboarding,
      auth: { ...businessBase.auth, authenticate: mock(async () => adminIdentity) },
    });
    const app = createServer(admin.value);
    expect(await (await app.handle(request('/api/v1/session', { headers: { authorization: 'Bearer valid' } }))).json()).toMatchObject({
      ownerTeams: ['factory'], admin: true,
      personas: ['business', 'developer'],
      capabilities: { requirementsCreate: true, developerWorkspaceCreate: true, implementationReview: true, applicationsManage: true },
    });
    expect((await app.handle(request('/api/v1/applications/onboarding/repositories', { headers: { authorization: 'Bearer valid' } }))).status).toBe(200);
    const missingTeam = await app.handle(request('/api/v1/applications/onboarding/register', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ repository: 'new-app' }),
    }));
    expect(missingTeam.status).toBe(400);

    const unknownTeam = await app.handle(request('/api/v1/applications/onboarding/register', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ repository: 'new-app', team: 'unknown' }),
    }));
    expect(unknownTeam.status).toBe(404);

    const created = await app.handle(request('/api/v1/applications/onboarding/register', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ repository: 'new-app', team: 'factory' }),
    }));
    expect(created.status).toBe(202);
    expect(applicationOnboarding.register).toHaveBeenCalledWith('new-app', 'factory', expect.anything());
  });

  test('accepts onboarding without waiting for staging reconciliation', async () => {
    const reconcileById = mock(async () => new Promise<void>(() => undefined));
    const applicationOnboarding = {
      availableRepositories: mock(async () => []), attempts: mock(async () => []), loadErrors: mock(() => []),
      reconcileDue: mock(async () => undefined), teamFor: mock(async () => null), canRegister: mock(async () => true),
      register: mock(async () => ({ ...application, id: 'factory/new-app', repositoryName: 'new-app' })),
      reassign: mock(async () => application), unregister: mock(async () => undefined),
      createRemediation: mock(async () => ({ pullNumber: 1, pullUrl: 'https://git/pulls/1', branch: 'repair' })),
    };
    const fixture = services({
      applicationOnboarding,
      staging: { snapshot: mock(async () => null), reconcileById, retry: mock(async () => undefined) },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/applications/onboarding/register', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'new-app', team: 'factory' }),
    }));

    expect(response.status).toBe(202);
    expect(reconcileById).not.toHaveBeenCalled();
  });

  test('leaves release creation and repository detachment to Forgejo and operators', async () => {
    const adminIdentity = { ...identity, groups: ['tenant-factory', 'tenant-factory-admin'] };
    const fixture = services({ auth: { ...services().auth, authenticate: mock(async () => adminIdentity) } });
    const app = createServer(fixture.value);
    expect((await app.handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/releases`, {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ version: '1.0.0' }),
    }))).status).toBe(404);
    expect((await app.handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/detach`, {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: application.id }),
    }))).status).toBe(404);
  });

  test('returns authorized workspace monitoring', async () => {
    const developer = {
      id: 'workspace-1', name: 'developer-app', owner: 'alice', template: 'Agentic Software Factory', status: 'running', transition: 'start',
      healthy: true, outdated: false, lastUsedAt: '2026-08-22T10:00:00Z', parameters: { workspace_kind: 'developer', workspace_namespace: 'factory-workspaces' },
      apps: [],
    };
    const review = {
      ...developer, id: 'workspace-2', name: 'verification-app', parameters: { workspace_kind: 'verification', workspace_namespace: 'factory-workspaces' },
    };
    const staging = {
      ...developer, id: 'workspace-3', name: 'staging-app', parameters: { workspace_kind: 'staging', workspace_namespace: 'factory-workspaces' },
    };
    const fixture = services({
      coder: { ...services().value.coder, summary: mock(async () => ({ count: 3, workspaces: [developer, review, staging], available: true })) },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/governance', { headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
    expect(body.workspaces.workspaces).toEqual([
      { ...developer, parameters: undefined, kind: 'developer' },
      { ...review, parameters: undefined, kind: 'verification' },
    ].map(({ parameters: _parameters, apps: _apps, ...workspace }) => workspace));
    expect(body.workspaces.count).toBe(2);
  });

  test('creates developer workspaces through Factory', async () => {
    const ensureDeveloperWorkspace = mock(async () => ({
      id: 'workspace-1', name: 'developer-app', template: 'Agentic Software Factory', status: 'running', healthy: true,
      lastUsedAt: '2026-08-20T01:00:00Z', url: 'https://coder.example/@alice/developer-app',
      ideUrl: 'https://code-server--developer-app--alice.apps.coder.example/',
      terminalUrl: 'https://coder.example/@alice/developer-app.main/terminal',
      apps: [{ slug: 'process-compose', displayName: 'Services', url: 'https://coder.example/@alice/developer-app.main/terminal?app=process-compose', health: 'disabled' as const }],
      parameters: { workspace_kind: 'developer' },
    }));
    const fixture = services({
      coder: {
        ...services().value.coder,
        ensureDeveloperWorkspace,
      },
    });
    const response = await createServer(fixture.value).handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/workspace?team=factory`, {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(201);
    expect(fixture.value.applications.get).toHaveBeenCalledWith(application.id);
    expect(ensureDeveloperWorkspace).toHaveBeenCalledWith(application, expect.anything());
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      workspaceId: 'workspace-1',
      apps: [{ slug: 'process-compose' }],
    });
    for (const field of ['workspaceUrl', 'terminalUrl', 'servicesUrl'] as const) {
      const handoff = new URL(body[field] as string);
      expect(handoff.pathname).toBe('/api/v2/users/oidc/callback');
    }
    const ideHandoff = new URL(body.ideUrl as string);
    expect(ideHandoff.pathname).toBe('/api/v2/users/oidc/callback');
    expect(ideHandoff.searchParams.get('redirect')).toContain('/api/v2/applications/auth-redirect');
    expect(new URL(body.servicesUrl as string).searchParams.get('redirect')).toContain('app=process-compose');
  });

  test('does not open an application workspace through another team scope', async () => {
    const base = services();
    const paymentsApplication = { ...application, id: 'payments/app', team: 'payments' };
    const fixture = services({
      applications: { list: mock(async () => [paymentsApplication]), get: mock(async () => paymentsApplication) },
      tenant: { ...base.value.tenant, teams: [
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments', 'team-operations'] })) },
    });

    const response = await createServer(fixture.value).handle(request(`/api/v1/applications/${encodeURIComponent(paymentsApplication.id)}/workspace?team=operations`, {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(404);
    expect(fixture.coder.ensureDeveloperWorkspace).not.toHaveBeenCalled();
  });

  test('protects API routes and rejects non-contract request fields', async () => {
    const fixture = services();
    const app = createServer(fixture.value);
    expect((await app.handle(request('/api/v1/board'))).status).toBe(401);
    expect((await app.handle(request('/api/v1/requirements', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A', body: 'B' }),
    }))).status).toBe(401);

    const response = await app.handle(
      request('/api/v1/requirements', {
        method: 'POST',
        headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'A', body: 'B', unexpected: true }),
      }),
    );
    expect(response.status).toBe(400);
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();
  });

  test('does not delete requirements after implementation starts', async () => {
    const fixture = services({
      forgejo: {
        ...services().forgejo,
        board: mock(async () => ({ ...board, columns: { ...board.columns, implementation: [{ ...board.columns.requirements[0]!, status: 'implementation' }] } })),
        getIssue: mock(async () => ({ title: 'Visible card', body: 'Outcome', status: 'implementation', team: 'factory', applications: [] })),
        closeRequirement: mock(async () => undefined),
      },
    });
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/2', {
      method: 'DELETE', headers: { authorization: 'Bearer valid' },
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'requirements cannot be deleted after implementation starts' });
    expect(fixture.forgejo.closeRequirement).not.toHaveBeenCalled();
  });

  test.each(['implementation', 'done'] as const)('rejects API visible edits after a requirement reaches %s', async (status) => {
    const base = services();
    const updateRequirement = mock(async () => { throw new Error('must not edit'); });
    const fixture = services({
      forgejo: {
        ...base.forgejo,
        getIssue: mock(async () => ({ title: 'Accepted', body: 'Accepted body', status, team: 'factory', applications: [{ id: application.id, name: application.name }] })),
        updateRequirement,
      },
    });
    const response = await createServer(fixture.value).handle(request(`/api/v1/requirements/2?application=${encodeURIComponent(application.id)}`, {
      method: 'PATCH', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Changed' }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'accepted requirements cannot be edited' });
    expect(updateRequirement).not.toHaveBeenCalled();
  });

  test('projects explicit persona capabilities and keeps tenant-only membership read-only', async () => {
    const base = services();
    const tenantIdentity = { ...identity, groups: ['tenant-factory'] };
    const fixture = services({ auth: { ...base.auth, authenticate: mock(async () => tenantIdentity) } });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid' };

    expect((await app.handle(request('/api/v1/board', { headers }))).status).toBe(200);
    expect((await app.handle(request('/api/v1/governance', { headers }))).status).toBe(200);
    const session = await (await app.handle(request('/api/v1/session', { headers }))).json() as any;
    expect(session.personas).toEqual([]);
    expect(session.capabilities).toMatchObject({
      boardRead: true, monitoringRead: true, requirementsCreate: false,
      developerWorkspaceCreate: false, implementationReview: false, applicationsManage: false,
    });

    const requirement = await app.handle(request('/api/v1/requirements', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A', body: 'B' }),
    }));
    expect(requirement.status).toBe(403);
    expect(await requirement.json()).toEqual({ error: 'business persona required' });
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();

    const workspace = await app.handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/workspace`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}',
    }));
    expect(workspace.status).toBe(403);
    expect(fixture.coder.ensureDeveloperWorkspace).not.toHaveBeenCalled();
  });

  test('lists only configured team boards available through authenticated groups', async () => {
    const base = services();
    const teams = [
      { slug: 'factory', displayName: 'Factory', group: null },
      { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
      { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
    ];
    const fixture = services({
      tenant: { ...base.value.tenant, teams },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments'] })) },
    });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid' };

    expect((await app.handle(request('/api/v1/teams', { headers }))).status).toBe(404);
    expect(await (await app.handle(request('/api/v1/session', { headers }))).json()).toMatchObject({ teams: ['factory', 'payments'] });
  });

  test('rejects an unavailable team query before board reads or requirement writes', async () => {
    const base = services();
    const fixture = services({
      tenant: {
        ...base.value.tenant,
        teams: [
          { slug: 'factory', displayName: 'Factory', group: null },
          { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
        ],
      },
    });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid' };

    const read = await app.handle(request('/api/v1/board?team=operations', { headers }));
    expect(read.status).toBe(404);
    expect(fixture.forgejo.board).not.toHaveBeenCalled();

    const write = await app.handle(request('/api/v1/requirements?team=operations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hidden', body: 'Hidden', team: 'operations' }),
    }));
    expect(write.status).toBe(404);
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();
  });

  test('uses only selected-team applications for board projection and filtering', async () => {
    const base = services();
    const paymentsApplication = { ...application, id: 'payments/app', team: 'payments', name: 'Payments' };
    const operationsApplication = { ...application, id: 'operations/app', team: 'operations', name: 'Operations' };
    const selectedBoard = {
      ...board,
      columns: { ...board.columns, requirements: [{
        ...board.columns.requirements[0]!,
        applications: [
          { id: paymentsApplication.id, name: 'Old payments name' },
          { id: operationsApplication.id, name: 'Operations' },
        ],
      }] },
    };
    const fixture = services({
      forgejo: { ...base.forgejo, board: mock(async () => selectedBoard) },
      applications: {
        list: mock(async () => [paymentsApplication, operationsApplication]),
        get: mock(async () => null),
      },
      tenant: { ...base.value.tenant, teams: [
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments', 'team-operations'] })) },
    });
    const app = createServer(fixture.value);

    const response = await app.handle(request(`/api/v1/board?team=payments&application=${encodeURIComponent(paymentsApplication.id)}`, {
      headers: { authorization: 'Bearer valid' },
    }));
    expect(response.status).toBe(200);
    expect((await response.json() as any).columns.requirements[0].applications).toEqual([{ id: paymentsApplication.id, name: 'Payments' }]);

    const crossTeam = await app.handle(request(`/api/v1/board?team=payments&application=${encodeURIComponent(operationsApplication.id)}`, {
      headers: { authorization: 'Bearer valid' },
    }));
    expect(crossTeam.status).toBe(404);
  });

  test('maps a persisted singleton UUID card application to the sole current System', async () => {
    const base = services();
    const persistedId = '1c71f7e5-ef9e-40bd-93c9-9edaa53c5520';
    const selectedBoard = { ...board, columns: { ...board.columns, requirements: [{ ...board.columns.requirements[0]!, applications: [{ id: persistedId, name: persistedId }] }] } };
    const fixture = services({
      forgejo: { ...base.forgejo, board: mock(async () => selectedBoard) },
      applications: { list: mock(async () => [application]), get: mock(async () => application) },
    });

    const response = await createServer(fixture.value).handle(request(`/api/v1/board?application=${encodeURIComponent(application.id)}`, { headers: { authorization: 'Bearer valid' } }));

    expect(response.status).toBe(200);
    expect((await response.json() as any).columns.requirements[0].applications).toEqual([{ id: application.id, name: application.name }]);
  });

  test('forwards board cursors and returns explicit page metadata', async () => {
    const base = services();
    const nextPage = { ...board, total: 205, truncated: false, nextCursor: null };
    const readBoard = mock(async (_scope: unknown, _cursor?: string) => nextPage);
    const fixture = services({ forgejo: { ...base.forgejo, board: readBoard } });

    const response = await createServer(fixture.value).handle(request('/api/v1/board?team=factory&cursor=5', {
      headers: { authorization: 'Bearer valid' },
    }));

    expect(response.status).toBe(200);
    expect(readBoard.mock.calls[0]?.[1]).toBe('5');
    expect(await response.json()).toMatchObject({ total: 205, truncated: false, nextCursor: null });
  });

  test('uses persisted registration data for team scope when live System metadata fails', async () => {
    const base = services();
    const get = mock(async () => { throw new Error('Forgejo metadata unavailable'); });
    const events = mock(async () => []);
    const fixture = services({
      applications: {
        list: mock(async () => { throw new Error('Forgejo metadata unavailable'); }),
        get,
        listRegistrations: mock(async () => [{ team: application.team, repositoryOwner: application.repositoryOwner, repositoryName: application.repositoryName }]),
        getRegistration: mock(async () => ({ team: application.team, repositoryOwner: application.repositoryOwner, repositoryName: application.repositoryName })),
      },
      forgejo: { ...base.forgejo, events },
    });

    const response = await createServer(fixture.value).handle(request(`/api/v1/requirements/2/events?team=factory&application=${encodeURIComponent(application.id)}`, {
      headers: { authorization: 'Bearer valid' },
    }));

    expect(response.status).toBe(200);
    expect(events).toHaveBeenCalledWith(2, expect.objectContaining({
      team: 'factory',
      repository: { owner: application.repositoryOwner, name: application.repositoryName, systemId: application.id },
    }));
    expect(get).not.toHaveBeenCalled();
  });

  test('rejects cross-team application assignments on requirement creation and update', async () => {
    const base = services();
    const paymentsApplication = { ...application, id: 'payments/app', team: 'payments' };
    const operationsApplication = { ...application, id: 'operations/app', team: 'operations' };
    const fixture = services({
      applications: {
        list: mock(async () => [paymentsApplication, operationsApplication]),
        get: mock(async (id: string) => [paymentsApplication, operationsApplication].find((item) => item.id === id) ?? null),
      },
      tenant: { ...base.value.tenant, teams: [{ slug: 'payments', displayName: 'Payments', group: 'team-payments' }] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments'] })) },
    });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid', 'content-type': 'application/json' };

    const create = await app.handle(request('/api/v1/requirements?team=payments', {
      method: 'POST', headers, body: JSON.stringify({ title: 'Cross-team', body: 'No', team: 'payments', applicationIds: [operationsApplication.id] }),
    }));
    expect(create.status).toBe(404);
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();

    const update = await app.handle(request('/api/v1/requirements/2?team=payments', {
      method: 'PATCH', headers, body: JSON.stringify({ applicationIds: [operationsApplication.id] }),
    }));
    expect(update.status).toBe(404);
    expect(fixture.forgejo.updateRequirement).not.toHaveBeenCalled();
  });

  test('checks a run requirement board before acting on an implementation run ID', async () => {
    const base = services();
    const verification = mock(async () => ({ id: 'run-1' }));
    const getIssue = mock(async () => { throw Object.assign(new Error('requirement not found'), { status: 404 }); });
    const fixture = services({
      forgejo: { ...base.forgejo, getIssue },
      implementation: { requirementScope: mock(async () => ({ requirementNumber: 3, systemId: application.id })), prepareVerification: verification } as never,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-business'] })) },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/implementation-runs/run-1/verification', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(404);
    expect(getIssue).toHaveBeenCalledWith(3, expect.objectContaining({ teams: ['factory'] }));
    expect(verification).not.toHaveBeenCalled();
  });

  test('authorizes a run against its stored System when another System has the same issue number', async () => {
    const base = services();
    const stored = { ...application, id: 'payments/app', team: 'payments', repositoryOwner: 'payments', repositoryName: 'app' };
    const duplicate = { ...application, id: 'operations/app', team: 'operations', repositoryOwner: 'operations', repositoryName: 'app' };
    const prepareVerification = mock(async () => ({ id: 'run-1' }));
    const getIssue = mock(async () => ({ title: 'Duplicate issue number', body: '', status: 'requirements' }));
    const fixture = services({
      applications: {
        list: mock(async () => [stored, duplicate]),
        get: mock(async (id: string) => [stored, duplicate].find((item) => item.id === id) ?? null),
      },
      forgejo: { ...base.forgejo, getIssue },
      implementation: { requirementScope: mock(async () => ({ requirementNumber: 3, systemId: stored.id })), prepareVerification } as never,
      tenant: { ...base.value.tenant, teams: [
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-operations'] })) },
    });

    const response = await createServer(fixture.value).handle(request(`/api/v1/implementation-runs/run-1/verification?team=operations&application=${encodeURIComponent(duplicate.id)}`, {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));

    expect(response.status).toBe(404);
    expect(getIssue).not.toHaveBeenCalled();
    expect(prepareVerification).not.toHaveBeenCalled();
  });

  test('hides System management actions from developers outside the source team', async () => {
    const base = services();
    const hidden = { ...application, id: 'operations/private', team: 'operations' };
    const onboarding = {
      availableRepositories: mock(async () => []),
      attempts: mock(async () => [{ systemId: hidden.id, team: hidden.team, repositoryOwner: 'operations', repositoryName: 'private', phase: 'repair' as const, targetSha: null, contractVersion: null, compatibilityIssues: [], policyPlan: null, lastError: 'secret', attempts: 1, nextAttemptAt: null, updatedAt: '2026-08-20T01:00:00Z' }]),
      loadErrors: mock(() => [{ systemId: hidden.id, error: 'private load error' }]),
      reconcileDue: mock(async () => undefined),
      teamFor: mock(async (id: string) => id === hidden.id ? hidden.team : null),
      canRegister: mock(async () => false),
      register: mock(async () => hidden),
      reassign: mock(async () => hidden),
      unregister: mock(async () => undefined),
      createRemediation: mock(async () => ({ pullNumber: 1, pullUrl: 'https://git/pulls/1', branch: 'repair' })),
    };
    const fixture = services({
      applications: { list: mock(async () => [hidden]), get: mock(async () => hidden) },
      applicationOnboarding: onboarding,
      tenant: { ...base.value.tenant, teams: [
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-developer', 'team-payments'] })) },
    });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid', 'content-type': 'application/json' };

    expect(await (await app.handle(request('/api/v1/applications/onboarding/repositories', { headers }))).json()).toEqual({ repositories: [] });
    expect(await (await app.handle(request('/api/v1/applications/onboarding/attempts', { headers }))).json()).toEqual({ attempts: [], loadErrors: [] });
    expect((await app.handle(request('/api/v1/applications/onboarding/register', { method: 'POST', headers, body: JSON.stringify({ repository: hidden.id, team: 'payments' }) }))).status).toBe(404);
    expect((await app.handle(request(`/api/v1/applications/${encodeURIComponent(hidden.id)}/registration`, { method: 'PATCH', headers, body: JSON.stringify({ team: 'payments' }) }))).status).toBe(404);
    expect((await app.handle(request(`/api/v1/applications/${encodeURIComponent(hidden.id)}/registration`, { method: 'DELETE', headers }))).status).toBe(404);
    expect((await app.handle(request(`/api/v1/applications/${encodeURIComponent(hidden.id)}/remediation`, { method: 'POST', headers, body: '{}' }))).status).toBe(404);
    expect(onboarding.register).not.toHaveBeenCalled();
    expect(onboarding.reassign).not.toHaveBeenCalled();
    expect(onboarding.unregister).not.toHaveBeenCalled();
    expect(onboarding.createRemediation).not.toHaveBeenCalled();
    expect(onboarding.availableRepositories).toHaveBeenCalledWith(['payments'], expect.any(AbortSignal));
  });

  test('requires live Forgejo authorization to re-register a removed System', async () => {
    const base = services();
    const onboarding = {
      availableRepositories: mock(async () => []), attempts: mock(async () => []), loadErrors: mock(() => []),
      reconcileDue: mock(async () => undefined), teamFor: mock(async () => null), canRegister: mock(async () => false),
      register: mock(async () => application), reassign: mock(async () => application), unregister: mock(async () => undefined),
      createRemediation: mock(async () => ({ pullNumber: 1, pullUrl: 'https://git/pulls/1', branch: 'repair' })),
    };
    const fixture = services({
      applicationOnboarding: onboarding,
      tenant: { ...base.value.tenant, teams: [{ slug: 'payments', displayName: 'Payments', group: 'team-payments' }] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-developer', 'team-payments'] })) },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/applications/onboarding/register', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'factory/removed', team: 'payments' }),
    }));

    expect(response.status).toBe(404);
    expect(onboarding.canRegister).toHaveBeenCalledWith('factory/removed', ['payments'], expect.any(AbortSignal));
    expect(onboarding.register).not.toHaveBeenCalled();
  });

  test('rejects an application from another team when starting implementation', async () => {
    const base = services();
    const start = mock(async () => ({ id: 'run-1' }));
    const paymentsApplication = { ...application, id: 'payments/app', team: 'payments' };
    const operationsApplication = { ...application, id: 'operations/app', team: 'operations' };
    const fixture = services({
      implementation: { start } as never,
      forgejo: { ...base.forgejo, getIssue: mock(async () => ({ title: 'Requirement', body: 'Body', status: 'requirements', team: 'payments', applications: [] })) },
      applications: {
        list: mock(async () => [paymentsApplication, operationsApplication]),
        get: mock(async (id: string) => [paymentsApplication, operationsApplication].find((candidate) => candidate.id === id) ?? null),
      },
      tenant: { ...base.value.tenant, teams: [{ slug: 'payments', displayName: 'Payments', group: 'team-payments' }] },
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [...identity.groups!, 'team-payments'] })) },
    });
    const app = createServer(fixture.value);
    const post = (applicationId: string) => app.handle(request('/api/v1/requirements/2/implementation-runs?team=payments', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ applicationId }),
    }));

    expect((await post(operationsApplication.id)).status).toBe(404);
    expect(start).not.toHaveBeenCalled();
    expect((await post(paymentsApplication.id)).status).toBe(202);
    expect(start).toHaveBeenCalledWith(2, paymentsApplication.id, expect.objectContaining({ subject: identity.subject }), expect.any(AbortSignal));
  });

  test('rejects every tenant-only mutation before downstream calls', async () => {
    const base = services();
    const fixture = services({ auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory'] })) } });
    const app = createServer(fixture.value);
    const json = (method: string, body: unknown): RequestInit => ({
      method, headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const mutations: Array<[string, RequestInit]> = [
      ['/api/v1/requirements', json('POST', { title: 'A', body: 'B' })],
      ['/api/v1/requirements/2', json('PATCH', { title: 'Changed' })],
      ['/api/v1/requirements/2', { method: 'DELETE', headers: { authorization: 'Bearer valid' } }],
      ['/api/v1/requirements/2/status', json('PATCH', { status: 'requirements' })],
      ['/api/v1/requirements/2/proposal', json('PUT', requirementSpec)],
      ['/api/v1/requirements/2/accept', json('POST', requirementSpec)],
      ['/api/v1/requirements/2/interview/start', json('POST', {})],
      ['/api/v1/requirements/2/interview/retake', json('POST', {})],
      ['/api/v1/requirements/2/interview', json('POST', { questionId: 'q1', expectedVersion: 0, selected: [], customText: 'Answer' })],
      ['/api/v1/requirements/2/interview/sharpen', json('POST', { note: 'More detail' })],
      [`/api/v1/applications/${encodeURIComponent(application.id)}/workspace`, json('POST', {})],
      ['/api/v1/requirements/2/implementation-runs', json('POST', { applicationId: application.id })],
      ['/api/v1/implementation-runs/run-1/verification', json('POST', {})],
      ['/api/v1/implementation-runs/run-1/review', json('POST', { decision: 'approve', body: '' })],
      ['/api/v1/implementation-runs/run-1/complete', json('POST', {})],
    ];
    for (const [path, init] of mutations) expect((await app.handle(request(path, init))).status).toBe(403);
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();
    expect(fixture.forgejo.updateRequirement).not.toHaveBeenCalled();
    expect(fixture.coder.ensureDeveloperWorkspace).not.toHaveBeenCalled();
  });

  test('allows both product personas to create tickets', async () => {
    for (const [group, expected] of [
      ['tenant-factory-business', 201],
      ['tenant-factory-developer', 201],
    ] as const) {
      const base = services();
      const actorIdentity = { ...identity, groups: ['tenant-factory', group] };
      const fixture = services({ auth: { ...base.auth, authenticate: mock(async () => actorIdentity) } });
      const response = await createServer(fixture.value).handle(request('/api/v1/requirements', {
        method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A', body: 'B' }),
      }));
      expect(response.status).toBe(expected);
    }

    const base = services();
    const fixture = services({ auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-business'] })) } });
    const app = createServer(fixture.value);
    const json = (method: string, body: unknown): RequestInit => ({ method, headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const allowed: Array<[string, RequestInit, number]> = [
      ['/api/v1/requirements/2', json('PATCH', { title: 'Changed' }), 200],
      ['/api/v1/requirements/2', { method: 'DELETE', headers: { authorization: 'Bearer valid' } }, 204],
      ['/api/v1/requirements/2/status', json('PATCH', { status: 'requirements' }), 200],
      ['/api/v1/requirements/2/proposal', json('PUT', requirementSpec), 200],
      ['/api/v1/requirements/2/accept', json('POST', requirementSpec), 200],
      ['/api/v1/requirements/2/interview/start', json('POST', {}), 503],
      ['/api/v1/requirements/2/interview/retake', json('POST', {}), 503],
      ['/api/v1/requirements/2/interview', json('POST', { questionId: 'q1', expectedVersion: 0, selected: [], customText: 'Answer' }), 409],
      ['/api/v1/requirements/2/interview/sharpen', json('POST', { note: 'More detail' }), 409],
    ];
    for (const [path, init, status] of allowed) expect((await app.handle(request(path, init))).status).toBe(status);
  });

  test('uses the trimmed title as the issue body when ticket context is blank', async () => {
    const fixture = services();
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Audit invoices  ', body: '   ' }),
    }));

    expect(response.status).toBe(201);
    expect(fixture.forgejo.createRequirement).toHaveBeenCalledWith(
      { title: '  Audit invoices  ', body: 'Audit invoices', team: 'factory' },
      expect.anything(),
    );
  });

  test('persists an optional assignee while creating a requirement', async () => {
    const base = services();
    const fixture = services({ applications: { ...base.value.applications, list: mock(async () => [application]) } });
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Assigned work', body: 'Context', applicationIds: [application.id], assignee: 'alex' }),
    }));

    expect(response.status).toBe(201);
    expect(fixture.forgejo.updateRequirement).toHaveBeenCalledWith(3, {
      applicationIds: [application.id], assignee: 'alex', expectedUpdatedAt: '2026-08-20T01:00:00Z',
    }, expect.anything());
  });

  test('maps proposal workflow conflicts instead of returning internal errors', async () => {
    const fixture = services({
      forgejo: {
        ...services().forgejo,
        propose: mock(() => Promise.reject(new ApplicationError('conflict', 409, 'a bound AI interview is required'))),
        accept: mock(() => Promise.reject(new ApplicationError('conflict', 409, 'a completed AI interview proposal is required'))),
      } as ForgejoService,
    });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid', 'content-type': 'application/json' };

    const proposal = await app.handle(request('/api/v1/requirements/2/proposal', {
      method: 'PUT', headers, body: JSON.stringify(requirementSpec),
    }));
    expect(proposal.status).toBe(409);
    expect(await proposal.json()).toEqual({ error: 'a bound AI interview is required', code: 'conflict' });

    const acceptance = await app.handle(request('/api/v1/requirements/2/accept', {
      method: 'POST', headers, body: JSON.stringify(requirementSpec),
    }));
    expect(acceptance.status).toBe(409);
    expect(await acceptance.json()).toEqual({ error: 'a completed AI interview proposal is required', code: 'conflict' });
  });

  test('maps stale requirement edits and interview answers to typed conflicts', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const fixture = services();
    fixture.forgejo.updateRequirement = mock(async () => { throw new ApplicationError('conflict', 409, 'requirement changed; refresh before editing it'); });
    fixture.forgejo.getInterview = mock(async () => ({ state: { ...emptyState, version: 2, teamId: 'factory', repository: application.id, requirementNumber: 2, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending }, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async () => { throw new ApplicationError('conflict', 409, 'interview changed; refresh before answering'); });
    const app = createServer(fixture.value);
    const headers = { authorization: 'Bearer valid', 'content-type': 'application/json' };

    const edit = await app.handle(request(`/api/v1/requirements/2?application=${encodeURIComponent(application.id)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ title: 'Changed', expectedUpdatedAt: '2026-08-20T01:00:00Z' }),
    }));
    expect(edit.status).toBe(409);
    expect(await edit.json()).toEqual({ error: 'requirement changed; refresh before editing it', code: 'conflict' });

    const answer = await app.handle(request(`/api/v1/requirements/2/interview?application=${encodeURIComponent(application.id)}`, {
      method: 'POST', headers, body: JSON.stringify({ questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' }),
    }));
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: 'interview changed; refresh before answering', code: 'conflict' });
  });

  test('returns a safe error and does not create a fallback interview when Coder start fails', async () => {
    const logs: unknown[] = [];
    const base = services();
    const startRequirementsChat = mock(async () => { throw new Error('upstream secret: token-123'); });
    const fixture = services({
      coder: {
        ...base.coder,
        chatCapability: mock(async () => ({ available: true })),
        startRequirementsChat,
      },
      log: (entry) => logs.push(entry),
    });
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/2/interview/start', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AI interview could not be started' });
    expect(fixture.forgejo.beginInterview).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ event: 'ai_interview_start_failed', requirementNumber: 2 }));
    expect(JSON.stringify(logs)).not.toContain('token-123');
  });

  test('passes exact-SHA repository context into the requirements interview', async () => {
    const base = services();
    const startRequirementsChat = mock(async () => ({
      chatId: 'chat-1',
      question: { id: 'q-1', header: 'Scope', prompt: 'Which outcome matters?', type: 'single' as const, options: [{ value: 'option-0', label: 'A', description: null }, { value: 'option-1', label: 'B', description: null }], allowCustom: true, hint: null },
    }));
    const fixture = services({
      applications: {
        ...base.value.applications,
        list: mock(async () => [{ ...application, systemContext: 'Repository: payments\nREADME at exact SHA' }]),
      },
      coder: { ...base.coder, chatCapability: mock(async () => ({ available: true })), startRequirementsChat },
    });

    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/2/interview/start?team=factory', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));

    expect(response.status).toBe(200);
    expect(startRequirementsChat).toHaveBeenCalledWith(expect.objectContaining({ systemContext: 'Repository: payments\nREADME at exact SHA' }), expect.anything());
  });

  test('keeps legacy interviews without a Coder chat readable', async () => {
    const fixture = services();
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/2/interview', {
      headers: { authorization: 'Bearer valid' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: { chatId: null }, agent: { available: false } });
    expect(fixture.forgejo.beginInterview).not.toHaveBeenCalled();
  });

  test('gives business product controls and developers the technical superset', async () => {
    const start = mock(async () => ({ id: 'run-1' }));
    const review = mock(async () => ({ id: 'run-1' }));
    const prepareVerification = mock(async () => ({ id: 'run-1' }));
    const complete = mock(async () => ({ id: 'run-1', phase: 'merging' }));
    const implementation = { start, review, prepareVerification, complete, requirementScope: mock(async () => ({ requirementNumber: 2, systemId: application.id })) } as never;
    const body = JSON.stringify({ decision: 'approve', body: '' });

    const developerBase = services();
    const developer = services({
      implementation,
      auth: { ...developerBase.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-developer'] })) },
    });
    const developerApp = createServer(developer.value);
    expect((await developerApp.handle(request('/api/v1/requirements/2/implementation-runs', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: application.id }),
    }))).status).toBe(202);
    expect((await developerApp.handle(request('/api/v1/implementation-runs/run-1/review', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body,
    }))).status).toBe(200);

    const businessBase = services();
    const business = services({
      implementation,
      auth: { ...businessBase.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-business'] })) },
    });
    const businessApp = createServer(business.value);
    expect((await businessApp.handle(request('/api/v1/requirements/2/implementation-runs', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: application.id }),
    }))).status).toBe(403);
    expect((await businessApp.handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/workspace`, {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }))).status).toBe(403);
    expect((await businessApp.handle(request('/api/v1/implementation-runs/run-1/review', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body,
    }))).status).toBe(200);
    expect((await businessApp.handle(request('/api/v1/implementation-runs/run-1/verification', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }))).status).toBe(200);
    expect((await businessApp.handle(request('/api/v1/implementation-runs/run-1/complete', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }))).status).toBe(202);
    expect(review).toHaveBeenCalledTimes(2);
    expect(prepareVerification).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test('requires a verified email before starting implementation', async () => {
    const start = mock(async () => { throw new Error('must not be called'); });
    const base = services();
    const fixture = services({
      implementation: { start } as never,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, emailVerified: false })) },
    });
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/2/implementation-runs', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: application.id }),
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Verify your email address before starting implementation' });
    expect(start).not.toHaveBeenCalled();
  });

  test('hides upstream implementation-start errors', async () => {
    const start = mock(async () => { throw new Error('upstream secret: token-123'); });
    const response = await createServer(services({ implementation: { start } as never }).value).handle(request('/api/v1/requirements/2/implementation-runs', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: application.id }),
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Implementation could not be started' });
  });

  test('returns a safe actionable Forgejo connection error for implementation startup', async () => {
    const start = mock(async () => { throw Object.assign(new Error('Connect Forgejo in Coder before creating a Developer workspace'), { status: 409 }); });
    const response = await createServer(services({ implementation: { start } as never }).value).handle(request('/api/v1/requirements/2/implementation-runs', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: application.id }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Connect Forgejo in Coder before starting implementation' });
  });

  test('preserves self-review denial after persona authorization', async () => {
    const selfReview = mock(async () => { throw Object.assign(new Error('implementation contributors cannot review their delivery'), { status: 403 }); });
    const base = services();
    const fixture = services({
      implementation: { review: selfReview, requirementScope: mock(async () => ({ requirementNumber: 2, systemId: application.id })) } as never,
      auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-developer'] })) },
    });
    const response = await createServer(fixture.value).handle(request('/api/v1/implementation-runs/run-1/review', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', body: '' }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'implementation contributors cannot review their delivery', code: 'forbidden' });
  });

  test('rejects authenticated users outside the configured tenant group', async () => {
    const base = services();
    const fixture = services({ auth: { ...base.auth, authenticate: mock(async () => ({ ...identity, groups: [] })) } });
    const response = await createServer(fixture.value).handle(request('/api/v1/board', { headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(403);
  });

  test('does not expose AI usage accounting', async () => {
    const response = await createServer(services().value).handle(request('/api/v1/ai/usage', {
      headers: { authorization: 'Bearer valid' },
    }));
    expect(response.status).toBe(404);
  });

  test('completes early when the model returns no next question', async () => {
    const order: string[] = [];
    const pending = { id: 'question-5', header: 'Priorität', prompt: 'Was ist wichtiger?', type: 'single' as const, options: [{ value: 'option-0', label: 'Tempo', description: null }], allowCustom: true, hint: null };
    const fixture = services();
    const priorAnswer = { questionId: 'prior', expectedVersion: 1, selected: ['option-0'], customText: '' };
    let state: InterviewState = { ...emptyState, version: 5, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, turns: Array.from({ length: 4 }, () => ({ question: pending, answer: priorAnswer })) };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async (_number, actor, answer, payload, operationId) => {
      order.push('persist');
      state = { ...state, pendingOperation: { operationId, answer, payload, previousQuestionId: pending.id, expectedVersion: 5, phase: 'answer' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: actor } };
      return state;
    });
    fixture.coder.answerRequirementsChat = mock(async (_chat, _question, _answer, _count, _operation, scope) => {
      expect(scope.signal.aborted).toBe(false);
      order.push('send');
      return null;
    });
    const requestAbort = new AbortController();
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview', {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 'question-5', expectedVersion: 5, selected: ['option-0'], customText: '' }),
      signal: requestAbort.signal,
    }));
    expect(response.status).toBe(202);
    expect(order[0]).toBe('persist');
    requestAbort.abort();
    await eventually(() => expect(order.slice(0, 2)).toEqual(['persist', 'send']));
    expect(fixture.coder.answerRequirementsChat).toHaveBeenCalledWith('chat-1', 'question-5', 'Tempo', 5, expect.stringMatching(/^turn_/), expect.anything());
    expect(fixture.coder.submitRequirementsProposal).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat-1', runId: 'run-1', proposalNonce: 'nonce-1' }), expect.stringMatching(/^turn_/), expect.anything());
  });

  test('completes when MCP stored the bound proposal before Coder failed', async () => {
    const pending = { id: 'question-2', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const fixture = services();
    let state: InterviewState = { ...emptyState, version: 2, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, turns: [] };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async (_number, actor, answer, payload, operationId) => {
      state = { ...state, pendingOperation: { operationId, answer, payload, previousQuestionId: pending.id, expectedVersion: 2, phase: 'answer' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: actor } };
      return state;
    });
    fixture.coder.answerRequirementsChat = mock(async () => null);
    fixture.coder.submitRequirementsProposal = mock(async () => { throw new Error('Coder Chat failed after MCP success'); });
    fixture.forgejo.getProposal = mock(async () => ({ specification: {}, provenance: { source: 'coder-ai' } }));

    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: pending.id, expectedVersion: 2, selected: ['small'], customText: '' }),
    }));

    expect(response.status).toBe(202);
    await eventually(() => expect(fixture.forgejo.completeInterviewAnswer).toHaveBeenCalledWith(7, expect.stringMatching(/^turn_/), null, true, expect.anything()));
    expect(fixture.forgejo.setInterviewOperationFailure).not.toHaveBeenCalled();
  });

  test('allows questions six through eight and passes the authoritative count', async () => {
    const pending = { id: 'question-7', header: 'Scope', prompt: 'Which exception matters?', type: 'single' as const, options: [{ value: 'a', label: 'A', description: null }, { value: 'b', label: 'B', description: null }], allowCustom: true, hint: null };
    const priorAnswer = { questionId: 'prior', expectedVersion: 1, selected: ['a'], customText: '' };
    const next = { ...pending, id: 'question-8' };
    const fixture = services();
    let state: InterviewState = { ...emptyState, version: 7, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, turns: Array.from({ length: 6 }, () => ({ question: pending, answer: priorAnswer })) };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async (_number, actor, answer, payload, operationId) => {
      state = { ...state, pendingOperation: { operationId, answer, payload, previousQuestionId: pending.id, expectedVersion: 7, phase: 'answer' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: actor } };
      return state;
    });
    fixture.coder.answerRequirementsChat = mock(async () => next);

    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: pending.id, expectedVersion: 7, selected: ['a'], customText: '' }),
    }));

    expect(response.status).toBe(202);
    await eventually(() => expect(fixture.coder.answerRequirementsChat).toHaveBeenCalledWith('chat-1', 'question-7', 'A', 7, expect.stringMatching(/^turn_/), expect.anything()));
    expect(fixture.forgejo.completeInterviewAnswer).toHaveBeenCalledWith(7, expect.stringMatching(/^turn_/), next, false, expect.anything());
    expect(fixture.coder.submitRequirementsProposal).not.toHaveBeenCalled();
  });

  test('fails visibly instead of discarding a ninth question', async () => {
    const pending = { id: 'question-8', header: 'Scope', prompt: 'Final decision?', type: 'single' as const, options: [{ value: 'a', label: 'A', description: null }, { value: 'b', label: 'B', description: null }], allowCustom: true, hint: null };
    const priorAnswer = { questionId: 'prior', expectedVersion: 1, selected: ['a'], customText: '' };
    const fixture = services();
    let state: InterviewState = { ...emptyState, version: 8, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, turns: Array.from({ length: 7 }, () => ({ question: pending, answer: priorAnswer })) };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async (_number, actor, answer, payload, operationId) => {
      state = { ...state, pendingOperation: { operationId, answer, payload, previousQuestionId: pending.id, expectedVersion: 8, phase: 'answer' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: actor } };
      return state;
    });
    fixture.coder.answerRequirementsChat = mock(async () => ({ ...pending, id: 'question-9' }));

    await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: pending.id, expectedVersion: 8, selected: ['a'], customText: '' }),
    }));

    await eventually(() => expect(fixture.forgejo.setInterviewOperationFailure).toHaveBeenCalledWith(7, expect.stringMatching(/^turn_/), {
      message: 'Coder returned another interview question after the hard limit of eight',
      retryable: false,
    }, expect.anything()));
    expect(fixture.forgejo.completeInterviewAnswer).not.toHaveBeenCalled();
    expect(fixture.coder.submitRequirementsProposal).not.toHaveBeenCalled();
  });

  test('persists a retryable detached failure instead of silently falling back', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const fixture = services();
    let state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async (_number, actor, answer, payload, operationId) => {
      state = { ...state, pendingOperation: { operationId, answer, payload, previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer' as const, createdAt: '2026-08-20T01:00:00Z', createdBy: actor } };
      return state;
    });
    fixture.coder.answerRequirementsChat = mock(async () => { throw new Error('timeout'); });

    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' }),
    }));

    expect(response.status).toBe(202);
    expect((await response.json()).state.pendingOperation).toMatchObject({ payload: 'Small', phase: 'answer' });
    await eventually(() => expect(fixture.forgejo.setInterviewOperationFailure).toHaveBeenCalledWith(7, expect.stringMatching(/^turn_/), {
      message: 'AI interview is blocked because Coder or MCP did not complete the turn',
      retryable: true,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(fixture.forgejo.completeInterviewAnswer).not.toHaveBeenCalled();
  });

  test('GET by a different viewer resumes a pending proposal as its original creator', async () => {
    const pending = { id: 'question-5', header: 'Priority', prompt: 'Which priority?', type: 'single' as const, options: [{ value: 'speed', label: 'Speed', description: null }, { value: 'quality', label: 'Quality', description: null }], allowCustom: true, hint: null };
    const priorAnswer = { questionId: 'prior', expectedVersion: 1, selected: ['speed'], customText: '' };
    const creator = identity;
    const viewer = { ...identity, subject: 'bob-id', email: 'bob@example.test', name: 'Bob', groups: ['tenant-factory'] };
    let sessionIdentity = creator;
    const base = services();
    const fixture = services({
      auth: { ...base.auth, authenticate: mock(async () => sessionIdentity) },
      identityByUserId: mock(async (userId) => userId === creator.subject ? creator : userId === viewer.subject ? viewer : null),
    });
    let state: InterviewState = { ...emptyState, version: 5, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, turns: Array.from({ length: 4 }, () => ({ question: pending, answer: priorAnswer })) };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.forgejo.prepareInterviewAnswer = mock(async (_number, actor, answer, payload, operationId) => {
      state = { ...state, pendingOperation: state.pendingOperation ?? { operationId, answer, payload, previousQuestionId: pending.id, expectedVersion: 5, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: actor } };
      return state;
    });
    fixture.forgejo.setInterviewOperationPhase = mock(async () => {
      if (!state.pendingOperation) throw new Error('operation missing');
      state.pendingOperation.phase = 'proposal';
      return state;
    });
    fixture.coder.submitRequirementsProposal = mock(async (_binding, _operation, scope) => {
      expect(scope.identity.subject).toBe(creator.subject);
      if ((fixture.coder.submitRequirementsProposal as ReturnType<typeof mock>).mock.calls.length === 1) throw new Error('timeout');
    });
    const body = JSON.stringify({ questionId: pending.id, expectedVersion: 5, selected: ['speed'], customText: '' });
    const first = createServer(fixture.value);
    expect((await first.handle(request('/api/v1/requirements/7/interview', { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body }))).status).toBe(202);
    await settle();
    expect(state.pendingOperation?.phase).toBe('proposal');

    sessionIdentity = viewer;
    const restarted = createServer(fixture.value);
    expect((await restarted.handle(request('/api/v1/requirements/7/interview', { headers: { authorization: 'Bearer valid' } }))).status).toBe(200);
    await settle();
    expect(fixture.coder.answerRequirementsChat).toHaveBeenCalledTimes(1);
    expect(fixture.coder.submitRequirementsProposal).toHaveBeenCalledTimes(2);
  });

  test('periodic reconciliation resumes a persisted operation after process restart without a GET', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    const fixture = services();
    fixture.forgejo.reconcilableInterviews = mock(async () => [{ number: 7, state }]);
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.coder.answerRequirementsChat = mock(async (_chat, _question, _answer, _count, _operation, scope) => {
      expect(scope.identity.subject).toBe(identity.subject);
      return { ...pending, id: 'question-2' };
    });

    await createInterviewOperationReconciler(fixture.value).reconcile();

    await eventually(() => expect(fixture.forgejo.completeInterviewAnswer).toHaveBeenCalledWith(7, 'turn-1', expect.objectContaining({ id: 'question-2' }), false, expect.anything()));
    expect(fixture.forgejo.reconcilableInterviews).toHaveBeenCalledWith(expect.objectContaining({ team: 'factory', systemId: application.id }), undefined);
  });

  test('periodic reconciliation rotates a bounded repository budget across Systems', async () => {
    const registrations = ['system-a', 'system-b', 'system-c'].map((id) => ({
      id, team: 'factory', repositoryOwner: 'factory', repositoryName: id,
    }));
    const base = services();
    const fixture = services({
      applications: {
        ...base.value.applications,
        listRegistrations: mock(async () => registrations),
      },
    });
    fixture.forgejo.reconcilableInterviews = mock(async () => []);
    const reconciler = createInterviewOperationReconciler(fixture.value, { repositoriesPerCycle: 1 });

    await reconciler.reconcile();
    await reconciler.reconcile();
    await reconciler.reconcile();
    await reconciler.reconcile();

    expect((fixture.forgejo.reconcilableInterviews as ReturnType<typeof mock>).mock.calls.map((call) => call[0].systemId))
      .toEqual(['system-a', 'system-b', 'system-c', 'system-a']);
  });

  test('periodic reconciliation aborts and waits for an active recovered operation', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    const fixture = services();
    fixture.forgejo.reconcilableInterviews = mock(async () => [{ number: 7, state }]);
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    let activeSignal: AbortSignal | undefined;
    fixture.coder.answerRequirementsChat = mock(async (_chat, _question, _answer, _count, _operation, scope) => {
      activeSignal = scope.signal;
      await new Promise<void>((_, reject) => scope.signal.addEventListener('abort', () => reject(scope.signal.reason), { once: true }));
      return null;
    });
    const controller = new AbortController();
    const running = createInterviewOperationReconciler(fixture.value).reconcile(controller.signal);
    await eventually(() => expect(activeSignal).toBe(controller.signal));

    controller.abort(new Error('worker host stopped'));
    await running;

    expect(fixture.forgejo.setInterviewOperationFailure).not.toHaveBeenCalled();
  });

  test('periodic reconciliation checks the creator current interview capability', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    const fixture = services({ identityByUserId: mock(async () => ({ ...identity, groups: ['tenant-factory'] })) });
    fixture.forgejo.reconcilableInterviews = mock(async () => [{ number: 7, state }]);

    await createInterviewOperationReconciler(fixture.value).reconcile();

    await eventually(() => expect(fixture.forgejo.setInterviewOperationFailure).toHaveBeenCalledWith(7, 'turn-1', {
      message: 'business access is required to resume this interview', retryable: false,
    }, expect.anything()));
    expect(fixture.coder.answerRequirementsChat).not.toHaveBeenCalled();
  });

  test('periodic reconciliation checks the creator current team access', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    const base = services();
    const fixture = services({
      tenant: { ...base.value.tenant, teams: [{ slug: 'factory', displayName: 'Factory', group: 'team-factory' }] },
      identityByUserId: mock(async () => ({ ...identity, groups: ['tenant-factory', 'tenant-factory-business'] })),
    });
    fixture.forgejo.reconcilableInterviews = mock(async () => [{ number: 7, state }]);

    await createInterviewOperationReconciler(fixture.value).reconcile();

    await eventually(() => expect(fixture.forgejo.setInterviewOperationFailure).toHaveBeenCalledWith(7, 'turn-1', {
      message: 'the saved interview actor no longer has access to this team', retryable: false,
    }, expect.anything()));
    expect(fixture.forgejo.getInterview).not.toHaveBeenCalled();
    expect(fixture.coder.answerRequirementsChat).not.toHaveBeenCalled();
  });

  test('explicit retry clears a retryable failure and returns the current state with 202', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const failed: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject, failure: { message: 'Coder timed out', retryable: true, failedAt: '2026-08-20T01:01:00Z' } } };
    const resumed = { ...failed, pendingOperation: { ...failed.pendingOperation!, failure: undefined } };
    const fixture = services();
    fixture.forgejo.getInterview = mock(async () => ({ state: failed, spec: null }));
    fixture.forgejo.setInterviewOperationFailure = mock(async () => resumed);
    fixture.coder.answerRequirementsChat = mock(async () => ({ ...pending, id: 'question-2' }));

    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview/retry', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(202);
    expect((await response.json()).state.pendingOperation.failure).toBeUndefined();
    expect(fixture.forgejo.setInterviewOperationFailure).toHaveBeenCalledWith(7, 'turn-1', null, expect.anything());
    await eventually(() => expect(fixture.coder.answerRequirementsChat).toHaveBeenCalledTimes(1));
  });

  test('rejects retry while an operation is still processing', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    const fixture = services();
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));

    const response = await createServer(fixture.value).handle(request('/api/v1/requirements/7/interview/retry', {
      method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}',
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'interview operation is still processing' });
    expect(fixture.forgejo.setInterviewOperationFailure).not.toHaveBeenCalled();
  });

  test('shares one detached worker across duplicate GET and retry requests', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fixture = services();
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.coder.answerRequirementsChat = mock(async (_chat, _question, _answer, _count, _operation, scope) => {
      expect(scope.signal.aborted).toBe(false);
      await blocked;
      return { ...pending, id: 'question-2' };
    });
    const app = createServer(fixture.value);

    await Promise.all([
      app.handle(request('/api/v1/requirements/7/interview', { headers: { authorization: 'Bearer valid' } })),
      app.handle(request('/api/v1/requirements/7/interview', { headers: { authorization: 'Bearer valid' } })),
      app.handle(request('/api/v1/requirements/7/interview/retry', { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}' })),
    ]);
    await settle();
    expect(fixture.coder.answerRequirementsChat).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(fixture.forgejo.completeInterviewAnswer).toHaveBeenCalledTimes(1);
  });

  test('serializes the same operation across BFF replicas', async () => {
    const pending = { id: 'question-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
    const answer = { questionId: pending.id, expectedVersion: 1, selected: ['small'], customText: '' };
    const state: InterviewState = { ...emptyState, version: 1, teamId: 'factory', repository: application.id, requirementNumber: 7, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1', pending, pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: pending.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:00:00Z', createdBy: identity.subject } };
    let locked = false;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const withInterviewOperationLock = mock(async (_key: string, action: () => Promise<void>) => {
      if (locked) return;
      locked = true;
      try { await action(); } finally { locked = false; }
    });
    const fixture = services({ withInterviewOperationLock });
    fixture.forgejo.getInterview = mock(async () => ({ state, spec: null }));
    fixture.coder.answerRequirementsChat = mock(async () => { await blocked; return { ...pending, id: 'question-2' }; });
    const first = createServer(fixture.value);
    const second = createServer(fixture.value);

    await Promise.all([
      first.handle(request('/api/v1/requirements/7/interview', { headers: { authorization: 'Bearer valid' } })),
      second.handle(request('/api/v1/requirements/7/interview', { headers: { authorization: 'Bearer valid' } })),
    ]);
    await settle();
    expect(withInterviewOperationLock).toHaveBeenCalledTimes(2);
    expect(fixture.coder.answerRequirementsChat).toHaveBeenCalledTimes(1);
    release();
    await settle();
  });

  test('blocks policy-controlled HTTP transitions before calling Forgejo', async () => {
    const fixture = services();
    const app = createServer(fixture.value);
    for (const [status, expected] of [['done', 403], ['implementation', 409]] as const) {
      const response = await app.handle(
        request('/api/v1/requirements/2/status', {
          method: 'PATCH',
          headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        }),
      );
      expect(response.status).toBe(expected);
    }
    expect(fixture.transition).not.toHaveBeenCalled();
  });

  test('allows only configured CORS origins', async () => {
    const fixture = services({ allowedOrigins: ['https://portal.example'] });
    const app = createServer(fixture.value);
    const allowed = await app.handle(
      request('/healthz', { headers: { origin: 'https://portal.example' } }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://portal.example');
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
    expect(allowed.headers.get('access-control-allow-headers')).toContain('X-Requested-With');
    expect(
      (await app.handle(request('/healthz', { headers: { origin: 'https://attacker.example' } }))).status,
    ).toBe(403);
    expect((await app.handle(request('/auth/logout', { method: 'POST', headers: { origin: 'null' } }))).status).toBe(403);
    expect((await app.handle(request('/healthz', { headers: { origin: 'http://bff.local' } }))).status).toBe(200);
  });

  test('serves allowlisted assets and authenticated SPA fallback without hiding missing APIs', async () => {
    const app = createServer(services({ webRoot }).value);
    const hashed = await app.handle(request('/main.ABCDEFGH.js'));
    expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const fallback = await app.handle(request('/board/requirement/7', { headers: { authorization: 'Bearer valid' } }));
    expect(await fallback.text()).toContain('Portal');
    expect(fallback.headers.get('cache-control')).toBe('no-cache');
    expect(fallback.headers.get('referrer-policy')).toBe('same-origin');
    expect(hashed.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await app.handle(request('/api/v1/unknown'))).status).toBe(404);
  });

  test('authenticates every non-root SPA fallback and preserves its return path', async () => {
    const fixture = services({ webRoot });
    const app = createServer(fixture.value);

    const anonymous = await app.handle(request('/board/requirement/7?team=payments'));
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('https://factory.example/login?return_to=%2Fboard%2Frequirement%2F7%3Fteam%3Dpayments');
    expect(fixture.auth.authenticate).toHaveBeenCalledTimes(1);

    const outsider = services({ webRoot });
    outsider.auth.authenticate = mock(async () => ({ ...identity, groups: [] }));
    expect((await createServer(outsider.value).handle(request('/board'))).status).toBe(403);

    const extensionlessFile = await app.handle(request('/internal', { headers: { authorization: 'Bearer valid' } }));
    expect(await extensionlessFile.text()).toContain('Portal');
    expect((await app.handle(request('/internal'))).status).toBe(302);
  });

  test('serves only the explicit public static allowlist without authentication', async () => {
    const fixture = services({ webRoot });
    const app = createServer(fixture.value);
    const paths = [
      '/main.ABCDEFGH.js', '/chunk-I7VILU2Z.js', '/favicon.ico', '/favicon.svg', '/bootstrap.js', '/branding.css',
      '/i18n/en.json',
    ];

    for (const path of paths) expect((await app.handle(request(path))).status).toBe(200);
    expect((await app.handle(request('/chunk-I7VILU2Z.js', { method: 'HEAD' }))).status).toBe(200);
    expect(fixture.auth.authenticate).not.toHaveBeenCalled();
  });

  test('blocks adversarial and unapproved static paths without authentication', async () => {
    const fixture = services({ webRoot });
    const app = createServer(fixture.value);
    const paths = [
      '/asset.txt', '/main.ABCDEFGH.js.map', '/manifest.webmanifest', '/manifest.json', '/robots.txt',
      '/.env', '/nested/.secret', '/nested/.secret.css', '/auth/assets/auth.css', '/auth/assets/auth.js', '/auth/assets/tokens.css',
      '/auth/assets/other.css', '/i18n/en.json.map', '/i18n/en/extra.json',
      '/main.ABCDEFGH.exe', '/%2eenv', '/%E0%A4%A',
    ];

    for (const path of paths) expect((await app.handle(request(path))).status).toBe(404);
    expect(fixture.auth.authenticate).not.toHaveBeenCalled();
  });

  test('never serves Angular for unmatched protocol namespaces', async () => {
    const app = createServer(services().value);
    for (const path of ['/mcp/session', '/.well-known/unknown', '/jwks/extra', '/get-session/extra', '/sign-out/extra', '/callback/unknown']) {
      const response = await app.handle(request(path));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).not.toContain('text/html');
    }
  });

  test('serves only exact auth presentation routes from the Angular shell without authentication', async () => {
    const fixture = services({ webRoot });
    const app = createServer(fixture.value);

    const [login, consent, loginHead, consentHead] = await Promise.all([
      app.handle(request('/login?return_to=%2Fboard')),
      app.handle(request('/consent?client_id=coder&scope=openid')),
      app.handle(request('/login', { method: 'HEAD' })),
      app.handle(request('/consent', { method: 'HEAD' })),
    ]);

    expect(await login.text()).toContain('Portal');
    expect(await consent.text()).toContain('Portal');
    expect(login.headers.get('cache-control')).toBe('no-store');
    expect(consent.headers.get('cache-control')).toBe('no-store');
    expect(login.headers.get('content-security-policy')).toBe(SPA_CONTENT_SECURITY_POLICY);
    expect(loginHead.status).toBe(200);
    expect(consentHead.status).toBe(200);
    expect(fixture.auth.authenticate).not.toHaveBeenCalled();
    expect((await app.handle(request('/login/extra'))).status).toBe(302);
    expect((await app.handle(request('/consent/extra'))).status).toBe(404);
  });

  test('forwards advertised OAuth protocol endpoints to Better Auth', async () => {
    const app = createServer(services().value);
    const response = await app.handle(new Request('http://localhost/oauth2/authorize'));
    expect(response.status).not.toBe(404);
  });

  test('exposes and calls only the requirement proposal MCP tool', async () => {
    const fixture = services();
    const app = createServer(fixture.value);
    const listed = await mcp(app, 'tools/list', {});
    expect(listed.response.status).toBe(200);
    const names = listed.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['requirements_propose']);
    expect(listed.body.result.tools[0].description).toContain('Agentic Software Factory');

    const called = await mcp(app, 'tools/call', {
      name: 'requirements_propose',
      arguments: {
        teamId: 'factory',
        repository: application.id,
        requirementNumber: 2,
        runId: 'run-1',
        chatId: 'chat-1',
        proposalNonce: 'nonce-1',
        goal: 'Enable faster onboarding.',
        users: ['Engineers'],
        userStories: ['As an engineer, I can onboard.'],
        acceptanceCriteria: ['An engineer can complete onboarding.'],
        nonFunctionalRequirements: [],
        moscow: { must: ['Onboarding'], should: [], could: [] },
        openQuestions: [],
        nonGoals: [],
      },
    });
    expect(called.response.status).toBe(200);
    expect(called.body.result.content[0].text).toContain('coder#owner-1');
    expect(fixture.forgejo.propose).toHaveBeenCalledTimes(1);
    expect(fixture.forgejo.propose).toHaveBeenCalledWith(2, identity.subject, expect.anything(), expect.anything(), expect.objectContaining({
      team: 'factory', repository: { owner: application.repositoryOwner, name: application.repositoryName, systemId: application.id },
    }));
  });

  test('rejects MCP proposal provenance outside the registered team repository', async () => {
    const fixture = services();
    const called = await mcp(createServer(fixture.value), 'tools/call', {
      name: 'requirements_propose',
      arguments: {
        teamId: 'factory', repository: 'factory/missing', requirementNumber: 2, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1',
        goal: 'Enable onboarding.', users: ['Engineers'], userStories: [], acceptanceCriteria: ['Onboarding works.'],
        nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [],
      },
    });
    expect(called.body.result.isError).toBe(true);
    expect(called.body.result.content[0].text).toBe('System was not found on this team');
    expect(fixture.forgejo.propose).not.toHaveBeenCalled();
  });

  test('requires a Coder OIDC token and rejects unexposed tools', async () => {
    const fixture = services();
    const app = createServer(fixture.value);
    const unauthorized = await app.handle(
      request('/mcp', {
        method: 'POST',
        headers: { 'X-Coder-Owner-Id': 'owner-1' },
      }),
    );
    expect(unauthorized.status).toBe(401);

    for (const name of ['requirements_search', 'requirements_create', 'requirements_transition']) {
      const called = await mcp(app, 'tools/call', {
        name,
        arguments: {},
      });
      expect(called.response.status).toBe(200);
      expect(called.body.result.isError).toBe(true);
      expect(called.body.result.content[0].text).toBe(`unknown tool '${name}'`);
    }
    expect(fixture.transition).not.toHaveBeenCalled();
  });

  test('ignores caller-controlled Coder owner headers', async () => {
    const victim = { ...identity, subject: 'victim' };
    const fixture = services({
      identityByUserId: mock(async (userId) => userId === identity.subject ? identity : userId === victim.subject ? victim : null),
    });
    const response = await createServer(fixture.value).handle(request('/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer coder-oidc',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'X-Coder-Owner-Id': victim.subject,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'requirements_propose', arguments: {
          teamId: 'factory', repository: application.id, requirementNumber: 2, runId: 'run-1', chatId: 'chat-1', proposalNonce: 'nonce-1',
          goal: 'Enable onboarding.', users: ['Engineers'], userStories: [], acceptanceCriteria: ['Onboarding works.'],
          nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [],
        },
      } }),
    }));

    expect(response.status).toBe(200);
    expect(fixture.auth.authenticateMcp).toHaveBeenCalledTimes(1);
    expect(fixture.forgejo.propose).toHaveBeenCalledWith(2, identity.subject, expect.anything(), expect.anything(), expect.anything());
    expect(fixture.forgejo.propose).not.toHaveBeenCalledWith(2, victim.subject, expect.anything(), expect.anything(), expect.anything());
  });

  test('requires a business persona for the MCP proposal tool', async () => {
    const base = services();
    const tenantReader = { ...identity, groups: ['tenant-factory'] };
    const fixture = services({
      auth: { ...base.auth, authenticateMcp: mock(async () => tenantReader.subject) },
      identityByUserId: mock(async () => tenantReader),
    });
    const called = await mcp(createServer(fixture.value), 'tools/call', {
      name: 'requirements_propose', arguments: { number: 2, ...requirementSpec },
    });
    expect(called.body.result.isError).toBe(true);
    expect(called.body.result.content[0].text).toBe('business persona required');
    expect(fixture.forgejo.propose).not.toHaveBeenCalled();
  });

  test('never falls back to browser authentication for MCP', async () => {
    const fixture = services();
    const response = await createServer(fixture.value).handle(request('/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: '{}',
    }));
    expect(response.status).toBe(401);
    expect(fixture.auth.authenticate).not.toHaveBeenCalled();
  });

  test('enforces global and MCP payload limits with 413 responses', async () => {
    const app = createServer(services().value);
    const global = await app.handle(request('/api/v1/requirements', {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', body: 'x'.repeat(1024 * 1024) }),
    }));
    expect(global.status).toBe(413);
    expect(await global.json()).toEqual({ error: 'payload too large' });

    const mcpPayload = await app.handle(request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer coder-oidc',
      },
      body: JSON.stringify({ padding: 'x'.repeat(256 * 1024) }),
    }));
    expect(mcpPayload.status).toBe(413);
  });

  test('classifies upstream auth as a dependency failure and logs only its safe cause', async () => {
    const logs: RequestLog[] = [];
    const fixture = services({
      log: (entry) => logs.push(entry),
      forgejo: { ...services().forgejo, board: async () => { throw new UpstreamHttpError('Forgejo', 401, 'forgejo-request-7'); } },
    });
    const response = await createServer(fixture.value).handle(request('/api/v1/board?token=leak', {
      headers: { authorization: 'Bearer valid', 'x-request-id': 'request-123' },
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream request failed', code: 'dependency_failure' });
    expect(response.headers.get('x-request-id')).toBe('request-123');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')?.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'http_request', requestId: 'request-123', method: 'GET', path: '/api/v1/board', status: 502,
      error: { code: 'dependency_failure', cause: { type: 'upstream_http', service: 'Forgejo', status: 401, requestId: 'forgejo-request-7' } },
    });
    expect(JSON.stringify(logs[0])).not.toContain('token=leak');
  });

  test('returns 404 for stale static assets instead of serving the application shell', async () => {
    const root = await Bun.$`mktemp -d`.text().then((value) => value.trim());
    try {
      await Bun.write(`${root}/index.html`, '<!doctype html><title>Factory</title>');
      const app = createServer(services({ webRoot: root }).value);
      const asset = await app.handle(request('/styles-stale.css'));
      expect(asset.status).toBe(404);
      expect(asset.headers.get('content-type')).toContain('application/json');
      const route = await app.handle(request('/board/42', { headers: { authorization: 'Bearer valid' } }));
      expect(route.status).toBe(200);
      expect(route.headers.get('content-type')).toContain('text/html');
    } finally {
      await Bun.$`rm -rf ${root}`;
    }
  });

  test('keeps auth presentation public while rate limiting auth operations, MCP, and API writes', async () => {
    const authApp = createServer(services({ rateLimits: { auth: 1 } }).value);
    expect((await authApp.handle(request('/login'))).status).toBe(404);
    expect((await authApp.handle(request('/auth/config'))).status).toBe(200);
    expect((await authApp.handle(request('/auth/config'))).status).toBe(200);
    expect((await authApp.handle(request('/sign-in/email', { method: 'POST' }))).status).not.toBe(429);
    const authLimited = await authApp.handle(request('/sign-in/email', { method: 'POST' }));
    expect(authLimited.status).toBe(429);
    expect(Number(authLimited.headers.get('retry-after'))).toBeGreaterThan(0);

    const authorizeApp = createServer(services({ rateLimits: { auth: 1 } }).value);
    expect((await authorizeApp.handle(request('/oauth2/authorize'))).status).not.toBe(429);
    expect((await authorizeApp.handle(request('/oauth2/authorize'))).status).not.toBe(429);

    const mcpApp = createServer(services({ rateLimits: { mcp: 1 } }).value);
    await mcp(mcpApp, 'tools/list', {});
    expect((await mcp(mcpApp, 'tools/list', {})).response.status).toBe(429);

    const writeApp = createServer(services({ rateLimits: { writes: 1 } }).value);
    const init = { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'application/json' }, body: '{}' };
    expect((await writeApp.handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/workspace`, init))).status).toBe(202);
    const writeLimited = await writeApp.handle(request(`/api/v1/applications/${encodeURIComponent(application.id)}/workspace`, init));
    expect(writeLimited.status).toBe(429);
    expect(writeLimited.headers.get('retry-after')).not.toBeNull();

  });

  test('does not trust a spoofed client address without a trusted socket peer', async () => {
    const boundary = createHttpBoundary(services({ rateLimits: { auth: 1 } }).value);
    const server = { requestIP: () => ({ address: '203.0.113.5' }) };
    const invoke = (address: string) => boundary.onRequest({
      request: request('/sign-in/email', { method: 'POST', headers: { 'x-real-ip': address } }),
      set: { headers: {} },
      server,
    });

    expect(await invoke('192.0.2.10')).toBeUndefined();
    expect((await invoke('192.0.2.11'))?.status).toBe(429);
  });

  test('rate limits ingress clients independently when the socket proxy is trusted', async () => {
    const boundary = createHttpBoundary(services({
      rateLimits: { auth: 1 },
      trustedProxyCidrs: ['10.0.0.0/8'],
    }).value);
    const server = { requestIP: () => ({ address: '10.1.2.3' }) };
    const invoke = (address: string) => boundary.onRequest({
      request: request('/sign-in/email', { method: 'POST', headers: { 'x-real-ip': address } }),
      set: { headers: {} },
      server,
    });

    expect(await invoke('192.0.2.10')).toBeUndefined();
    expect(await invoke('192.0.2.11')).toBeUndefined();
    expect((await invoke('192.0.2.10'))?.status).toBe(429);
    expect((await invoke('192.0.2.11'))?.status).toBe(429);
  });

  test('rejects impractical field and array lengths before service calls', async () => {
    const fixture = services();
    const response = await createServer(fixture.value).handle(request('/api/v1/requirements', {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(257), body: 'valid', applicationIds: Array(101).fill('app') }),
    }));
    expect(response.status).toBe(400);
    expect(fixture.forgejo.createRequirement).not.toHaveBeenCalled();
  });
});
