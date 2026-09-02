/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { ApplicationDefinition } from './catalog';
import { StagingReconciler } from './staging';
import { UpstreamTimeoutError } from '../integrations/fetch';

const application = {
  id: 'factory/app', team: 'factory', name: 'App', description: '', repositoryOwner: 'factory', repositoryName: 'app',
  repositoryUrl: 'https://git/app', cloneUrl: 'https://git/app.git', defaultBranch: 'main', defaultSha: 'a'.repeat(40),
  declaredApps: [], workspaceApps: [],
} satisfies ApplicationDefinition;
const workspace = { id: 'staging-1', name: 'staging-app', owner: 'automation', template: 'factory', status: 'running', transition: 'start', healthy: true, outdated: false, lastUsedAt: '', apps: [{ slug: 'app', displayName: 'App', url: 'https://app', health: 'healthy' as const }], parameters: { workspace_kind: 'staging', repository_ref: application.defaultSha } };

function persistedSystem(overrides: Record<string, unknown> = {}) {
  return {
    systemId: application.id,
    onboardingPhase: 'ready',
    onboardingError: null,
    onboardingUpdatedAt: new Date('2026-09-01T11:59:30Z'),
    targetSha: application.defaultSha,
    registered: true,
    projection: application,
    projectionUpdatedAt: new Date('2026-09-01T11:59:30Z'),
    projectionError: null,
    projectionErrorAt: null,
    ...overrides,
  };
}

function fixture() {
  let record: any = null;
  let leased = false;
  const store = {
    desire: mock(async (systemId: string, desiredSha: string) => {
      if (!record) record = { systemId, desiredSha, currentSha: null, phase: 'pending', health: 'unknown', workspace: null, lastError: null, attempts: 0, updatedAt: new Date() };
      if (record.desiredSha !== desiredSha) Object.assign(record, { desiredSha, phase: 'pending', health: 'unknown', lastError: null });
      return record;
    }),
    get: mock(async () => record),
    list: mock(async () => record ? [record] : []),
    observeHealthy: mock(async (_id: string, _sha: string, value: typeof workspace) => {
      if (record) Object.assign(record, { workspace: value, updatedAt: new Date() });
    }),
    retry: mock(async () => {
      if (record) Object.assign(record, { phase: 'pending', attempts: 0, lastError: null, leaseOwner: null, leaseExpiresAt: null });
    }),
    claim: mock(async () => {
      if (leased || record?.phase === 'deleting') return null;
      leased = true;
      Object.assign(record, { phase: 'provisioning', health: 'initializing', attempts: record.attempts + 1 });
      return record.attempts;
    }),
    succeed: mock(async (_id: string, _owner: string, _generation: number, sha: string, value: typeof workspace) => {
      leased = false;
      Object.assign(record, { currentSha: sha, phase: 'healthy', health: 'healthy', workspace: value, lastError: null, updatedAt: new Date() });
      return true;
    }),
    fail: mock(async (_id: string, _owner: string, _generation: number, _sha: string, error: string) => {
      leased = false;
      Object.assign(record, { phase: 'retry-wait', health: 'unhealthy', lastError: error, updatedAt: new Date() });
      return true;
    }),
    claimDeletion: mock(async () => {
      if (leased) return { status: 'busy' as const };
      leased = true;
      if (!record) record = { systemId: application.id, desiredSha: '', currentSha: null, phase: 'deleting', health: 'unknown', workspace: null, lastError: null, attempts: 0, updatedAt: new Date() };
      else Object.assign(record, { phase: 'deleting', health: 'unknown' });
      return { status: 'claimed' as const, generation: 100 };
    }),
    finishDeletion: mock(async () => {
      leased = false;
      Object.assign(record, { workspace: null, currentSha: null, lastError: null });
      return true;
    }),
    failDeletion: mock(async (_id: string, _owner: string, _generation: number, error: string) => {
      leased = false;
      Object.assign(record, { phase: 'failed', health: 'unhealthy', lastError: error });
    }),
  };
  return { store, record: () => record };
}

describe('StagingReconciler', () => {
  test('uses the persistent lease to coalesce reconciliation across replicas', async () => {
    let resolve!: (value: typeof workspace) => void;
    const result = new Promise<typeof workspace>((done) => { resolve = done; });
    const ensureStagingWorkspace = mock(() => result);
    const { store } = fixture();
    const metrics = { measure: async (_input: unknown, action: () => Promise<unknown>) => action() };
    const coder = { ensureStagingWorkspace, stagingWorkspaceById: async () => workspace };
    const firstReplica = new StagingReconciler({ list: async () => [application], get: async () => application } as never, coder as never, store as never, metrics as never, 'template', 'workspaces');
    const secondReplica = new StagingReconciler({ list: async () => [application], get: async () => application } as never, coder as never, store as never, metrics as never, 'template', 'workspaces');

    const first = firstReplica.reconcile(application);
    await Promise.resolve();
    await secondReplica.reconcile(application);
    expect(ensureStagingWorkspace).toHaveBeenCalledTimes(1);
    resolve(workspace);
    await first;
    expect(await secondReplica.snapshot(application.id)).toMatchObject({ reconciling: false, error: null, workspace: { id: 'staging-1' } });
  });

  test('persists a failed new SHA without relabeling the previous workspace', async () => {
    const ensureStagingWorkspace = mock(async () => workspace);
    const { store } = fixture();
    const metrics = { measure: async (_input: unknown, action: () => Promise<unknown>) => action() };
    const reconciler = new StagingReconciler({ list: async () => [application], get: async () => application } as never, { ensureStagingWorkspace, stagingWorkspaceById: async () => workspace } as never, store as never, metrics as never, 'template', 'workspaces');
    await reconciler.reconcile(application);
    ensureStagingWorkspace.mockImplementation(async () => { throw new Error('Coder unavailable'); });
    await reconciler.reconcile({ ...application, defaultSha: 'b'.repeat(40) });

    expect(await reconciler.snapshot(application.id)).toMatchObject({ repositoryRef: 'b'.repeat(40), error: 'Coder unavailable' });
  });

  test('explicit readiness repair resets staging backoff', async () => {
    const ensureStagingWorkspace = mock(async () => workspace);
    const { store } = fixture();
    const metrics = { measure: async (_input: unknown, action: () => Promise<unknown>) => action() };
    const reconciler = new StagingReconciler({ list: async () => [application], get: async () => application } as never, { ensureStagingWorkspace, stagingWorkspaceById: async () => workspace } as never, store as never, metrics as never, 'template', 'workspaces');
    await store.desire(application.id, application.defaultSha);
    Object.assign(await store.get(), { phase: 'retry-wait', lastError: 'old failure' });

    await reconciler.ensureReady(application);

    expect(store.retry).toHaveBeenCalledWith(application.id);
    expect(ensureStagingWorkspace).toHaveBeenCalledTimes(1);
    expect(await reconciler.snapshot(application.id)).toMatchObject({ phase: 'healthy', error: null });
  });

  test('repairs a healthy snapshot when live Coder state no longer matches', async () => {
    const ensureStagingWorkspace = mock(async () => workspace);
    const stagingWorkspaceById = mock(async () => { throw new Error('owner changed'); });
    const { store } = fixture();
    const metrics = { measure: async (_input: unknown, action: () => Promise<unknown>) => action() };
    const reconciler = new StagingReconciler({ list: async () => [application], get: async () => application } as never, { ensureStagingWorkspace, stagingWorkspaceById } as never, store as never, metrics as never, 'template', 'workspaces');
    await reconciler.reconcile(application);

    await reconciler.reconcile(application);

    expect(stagingWorkspaceById).toHaveBeenCalledTimes(1);
    expect(ensureStagingWorkspace).toHaveBeenCalledTimes(2);
  });

  test('keeps the last healthy projection when a live Coder read times out', async () => {
    const ensureStagingWorkspace = mock(async () => workspace);
    const stagingWorkspaceById = mock(async () => { throw new UpstreamTimeoutError('Coder', 20_000); });
    const { store } = fixture();
    const metrics = { measure: async (_input: unknown, action: () => Promise<unknown>) => action() };
    const reconciler = new StagingReconciler({ list: async () => [application], get: async () => application } as never, { ensureStagingWorkspace, stagingWorkspaceById } as never, store as never, metrics as never, 'template', 'workspaces');
    await reconciler.reconcile(application);

    await reconciler.reconcile(application);

    expect(await reconciler.snapshot(application.id)).toMatchObject({ workspace: { id: 'staging-1', healthy: true } });
    expect(ensureStagingWorkspace).toHaveBeenCalledTimes(1);
    expect(store.retry).not.toHaveBeenCalled();
  });

  test('summarizes persisted state without reading live Coder state', async () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const failedApplication = { ...application, id: 'factory/failed', repositoryName: 'failed' };
    const applications = {
      list: mock(async () => { throw new Error('live registry must not be read'); }),
      get: mock(async () => { throw new Error('live registry must not be read'); }),
      persistedStatus: mock(async () => [
        persistedSystem(),
        persistedSystem({
          systemId: failedApplication.id,
          projection: failedApplication,
          projectionError: 'Forgejo unavailable',
          projectionErrorAt: new Date('2026-09-01T11:59:40Z'),
        }),
      ]),
    };
    const stagingWorkspaceById = mock(async () => { throw new Error('Coder must not be read'); });
    const store = {
      list: mock(async () => [
        { systemId: application.id, desiredSha: application.defaultSha, currentSha: application.defaultSha, phase: 'healthy', health: 'healthy', workspace, lastError: null, attempts: 1, updatedAt: new Date('2026-09-01T11:59:45Z') },
        { systemId: failedApplication.id, desiredSha: failedApplication.defaultSha, currentSha: null, phase: 'failed', health: 'unhealthy', workspace: null, lastError: 'workspace failed', attempts: 5, updatedAt: new Date('2026-09-01T11:59:45Z') },
      ]),
    };
    const reconciler = new StagingReconciler(
      applications as never,
      { stagingWorkspaceById } as never,
      store as never,
      {} as never,
      'template',
      'workspaces',
    );

    const status = await reconciler.status(now);

    expect(status.status).toBe('degraded');
    expect(status.counts).toEqual({ total: 2, registered: 2, usable: 1, degraded: 1 });
    expect(status.registry).toEqual({ current: 1, stale: 1, missing: 0, loadErrors: 1 });
    expect(status.staging).toEqual({ healthy: 1, stale: 0, reconciling: 0, failed: 1, missing: 0 });
    expect(status.degradedSystems).toEqual([expect.objectContaining({
      systemId: failedApplication.id,
      registry: expect.objectContaining({ status: 'stale', error: 'Forgejo unavailable' }),
      staging: expect.objectContaining({ status: 'failed', error: 'workspace failed' }),
    })]);
    expect(applications.list).not.toHaveBeenCalled();
    expect(applications.get).not.toHaveBeenCalled();
    expect(stagingWorkspaceById).not.toHaveBeenCalled();
  });

  test('reports not-ready only when registered Systems exist and none are usable', async () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const store = { list: async () => [{
      systemId: application.id, desiredSha: application.defaultSha, currentSha: application.defaultSha,
      phase: 'healthy', health: 'healthy', workspace, lastError: null, attempts: 1,
      updatedAt: new Date('2026-09-01T11:55:00Z'),
    }] };
    const reconciler = new StagingReconciler({
      list: async () => [application], get: async () => application,
      persistedStatus: async () => [persistedSystem({ projectionUpdatedAt: new Date('2026-09-01T11:55:00Z') })],
    } as never, {} as never, store as never, {} as never, 'template', 'workspaces');

    const status = await reconciler.status(now);

    expect(status.status).toBe('not-ready');
    expect(status.counts).toEqual({ total: 1, registered: 1, usable: 0, degraded: 1 });
    expect(status.registry.stale).toBe(1);
    expect(status.staging.stale).toBe(1);
    await expect(reconciler.ready()).rejects.toThrow('No registered System is usable');
  });

  test('keeps a System ready while a healthy staging workspace rolls to a new SHA', async () => {
    const now = new Date();
    const nextSha = 'b'.repeat(40);
    const rollingApplication = { ...application, defaultSha: nextSha };
    const rollingWorkspace = { ...workspace, parameters: { ...workspace.parameters, repository_ref: application.defaultSha } };
    const reconciler = new StagingReconciler({
      list: async () => [rollingApplication], get: async () => rollingApplication,
      persistedStatus: async () => [persistedSystem({ projection: rollingApplication, targetSha: nextSha, projectionUpdatedAt: now, onboardingUpdatedAt: now })],
    } as never, {} as never, { list: async () => [{
      systemId: application.id, desiredSha: nextSha, currentSha: application.defaultSha,
      phase: 'provisioning', health: 'initializing', workspace: rollingWorkspace, lastError: null, attempts: 2,
      updatedAt: now,
    }] } as never, {} as never, 'template', 'workspaces');

    const status = await reconciler.status(now);

    expect(status.status).toBe('degraded');
    expect(status.counts).toEqual({ total: 1, registered: 1, usable: 1, degraded: 0 });
    expect(status.staging.stale).toBe(1);
    await expect(reconciler.ready()).resolves.toBeUndefined();
  });

  test('treats a registration with missing onboarding state as unusable', async () => {
    const reconciler = new StagingReconciler({
      list: async () => [], get: async () => null,
      persistedStatus: async () => [persistedSystem({ onboardingPhase: null, onboardingError: 'Onboarding state is missing' })],
    } as never, {} as never, { list: async () => [] } as never, {} as never, 'template', 'workspaces');

    const status = await reconciler.status(new Date('2026-09-01T12:00:00Z'));

    expect(status.status).toBe('not-ready');
    expect(status.onboarding.missing).toBe(1);
    expect(status.degradedSystems[0]).toMatchObject({
      systemId: application.id,
      onboarding: { phase: null, error: 'Onboarding state is missing' },
    });
  });

  test('fences concurrent provisioning before cleanup and leaves no untracked workspace', async () => {
    let release!: () => void;
    const provisioning = new Promise<typeof workspace>((resolve) => { release = () => resolve(workspace); });
    let createdWorkspace: typeof workspace | null = null;
    const ensureStagingWorkspace = mock(async () => {
      const created = await provisioning;
      createdWorkspace = created;
      return created;
    });
    const deleteStagingWorkspace = mock(async () => { createdWorkspace = null; });
    const { store, record } = fixture();
    const metrics = { measure: async (_input: unknown, action: () => Promise<unknown>) => action() };
    const reconciler = new StagingReconciler(
      { list: async () => [application], get: async () => application } as never,
      { ensureStagingWorkspace, stagingWorkspaceById: async () => workspace, deleteStagingWorkspace } as never,
      store as never, metrics as never, 'template', 'workspaces',
    );

    const reconcile = reconciler.reconcile(application);
    await Promise.resolve();
    const deletion = reconciler.delete(application.id, application.cloneUrl);
    await Bun.sleep(10);
    expect(deleteStagingWorkspace).not.toHaveBeenCalled();
    release();
    await reconcile;
    await deletion;

    expect(deleteStagingWorkspace).toHaveBeenCalledTimes(1);
    expect(createdWorkspace).toBeNull();
    expect(record()).toMatchObject({ phase: 'deleting', workspace: null, currentSha: null });
  });
});
