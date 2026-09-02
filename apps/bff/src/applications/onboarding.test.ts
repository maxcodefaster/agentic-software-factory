/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, mock, test } from 'bun:test';

import type { ApplicationDefinition, SystemRegistration } from './catalog';
import { UpstreamHttpError } from '../integrations/fetch';
import { ApplicationOnboarding } from './onboarding';
import type { OnboardingPhase, OnboardingRecord } from './onboarding-store';
import type { StagingRecord } from './staging-store';

const devcontainer = JSON.stringify({
  name: 'Customer portal',
  postStartCommand: './dev start',
  customizations: { coder: { apps: [{ slug: 'portal', displayName: 'Customer portal', url: 'http://localhost:4173', share: 'owner', healthCheck: { url: 'http://127.0.0.1:4173/health', interval: 5, threshold: 6 } }] } },
});
const verificationDevcontainer = JSON.stringify({
  name: 'Customer portal verification',
  postStartCommand: './dev start',
  workspaceMount: 'source=${localWorkspaceFolder},target=/workspaces/project,type=bind,readonly',
  workspaceFolder: '/workspaces/project',
  customizations: {
    coder: {
      apps: [{ slug: 'portal', displayName: 'Customer portal', url: 'http://localhost:4173', share: 'authenticated', healthCheck: { url: 'http://127.0.0.1:4173/health', interval: 5, threshold: 6 } }],
    },
  },
});
const exactSha = 'a'.repeat(40);
const systemManifest = `
version: 1
development: { devcontainer: .devcontainer/devcontainer.json }
verification: { devcontainer: .devcontainer/verification/devcontainer.json }
runtime:
  supervisor:
    kind: custom
    commands: { status: ./dev status, shutdown: ./dev stop }
  startupTimeoutSeconds: 60
applications:
  - slug: portal
    displayName: Customer portal
    url: http://localhost:4173
    verification: required
    health: { url: http://127.0.0.1:4173/health, intervalSeconds: 5, failureThreshold: 6 }
`;

function system(repository = 'registered', team = 'factory', owner = 'factory'): ApplicationDefinition {
  return {
    id: `${owner}/${repository}`,
    team,
    name: repository,
    description: '',
    repositoryOwner: owner,
    repositoryName: repository,
    repositoryUrl: `https://git.example/${owner}/${repository}`,
    cloneUrl: `https://forgejo.internal/${owner}/${repository}.git`,
    defaultBranch: 'main',
    defaultSha: 'a'.repeat(40),
    declaredApps: [],
  };
}

function ownedPolicy(team = 'factory-users-payments') {
  return {
    access: {
      managedTeam: team,
      teamGrantAdded: true,
      collaboratorGrantAdded: { 'factory-implementation': true, 'factory-review': true, 'factory-clone': true },
    },
    mainBranch: { branch: 'main', created: false, addedStatusChecks: ['factory/specification'] },
    implementationBranchProtectionCreated: true,
  };
}

function fixture(initial: ApplicationDefinition[] = [system()], owners = ['factory']) {
  let records = [...initial];
  const onboardingRecords = new Map<string, OnboardingRecord & { leaseOwner: string | null; leaseExpiresAt: Date | null; leaseGeneration: number }>();
  const onboardingEvents: Array<{ systemId: string; phase: OnboardingPhase; detail: Record<string, unknown>; createdAt: Date }> = [];
  for (const application of initial) {
    onboardingRecords.set(application.id, {
      systemId: application.id,
      team: application.team,
      targetTeam: null,
      repositoryOwner: application.repositoryOwner,
      repositoryName: application.repositoryName,
      phase: 'ready',
      targetSha: application.defaultSha,
      contractVersion: 1,
      compatibilityIssues: [],
      policyPlan: null,
      lastError: null,
      attempts: 1,
      nextAttemptAt: null,
      updatedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseGeneration: 0,
    });
  }
  const forgejo = {
    listOwnerRepositories: mock(async (_owner?: string) => [
      { name: 'app', full_name: 'factory/app', description: 'App', private: true, template: false, default_branch: 'main', html_url: 'https://git/factory/app' },
      { name: 'public', full_name: 'factory/public', description: '', private: false, template: false, default_branch: 'main', html_url: 'https://git/factory/public' },
      { name: 'inventory', full_name: 'factory/inventory', description: 'Second System', private: true, template: false, default_branch: 'main', html_url: 'https://git/factory/inventory' },
      { name: 'registered', full_name: 'factory/registered', description: '', private: true, template: false, default_branch: 'main', html_url: 'https://git/factory/registered' },
    ]),
    listTeamRepositories: mock(async (_owner: string, team: string) => team === 'factory-users-payments' ? [
      { name: 'app', full_name: 'factory/app', description: 'App', private: true, template: false, default_branch: 'main', html_url: 'https://git/factory/app' },
    ] : []),
    getProjectRepository: mock(async (_owner: string, repository: string) => ({ name: repository, full_name: `factory/${repository}`, description: 'Repository description', private: true, template: false, default_branch: 'main', html_url: `https://git/factory/${repository}` })),
    getProjectBranchHead: mock(async () => exactSha),
    readProjectFile: mock(async (_owner: string, _repository: string, _branch: string, path: string) => (
      path === '.factory/system.yaml' ? systemManifest
        : path === '.devcontainer/verification/devcontainer.json' ? verificationDevcontainer : devcontainer
    )),
    ensureCollaborator: mock(async () => undefined),
    collaboratorPermission: mock(async (_owner: string, _repository: string, _username: string): Promise<string | null> => null),
    directCollaborators: mock(async (): Promise<string[]> => []),
    removeCollaborator: mock(async (_owner: string, _repository: string, _username: string, _signal?: AbortSignal) => undefined),
    ensureTeamRepository: mock(async () => undefined),
    teamHasRepository: mock(async () => false),
    scopedReadTeamExists: mock(async () => true),
    assertScopedReadTeam: mock(async () => undefined),
    removeTeamRepository: mock(async () => undefined),
    ensureMainBranchProtection: mock(async () => undefined),
    planMainBranchProtection: mock(async (): Promise<{ created: boolean; addedStatusChecks: string[]; preservedStatusChecks: string[] }> => ({
      created: true, addedStatusChecks: ['factory/specification', 'factory/verification'], preservedStatusChecks: [],
    })),
    removeFactoryMainBranchProtection: mock(async () => undefined),
    ensureImplementationBranchProtection: mock(async () => undefined),
    branchProtectionNeedsAdding: mock(async () => true),
    removeFactoryImplementationBranchProtection: mock(async () => undefined),
    removeBranchProtection: mock(async () => undefined),
    ensureBranch: mock(async () => undefined),
    upsertProjectFile: mock(async () => exactSha),
    createPullRequest: mock(async () => ({ number: 7, html_url: 'https://git/pulls/7' })),
  };
  const registry = {
    list: mock(async () => records.filter((item) => onboardingRecords.get(item.id)?.phase === 'ready')),
    get: mock(async (id: string) => onboardingRecords.get(id)?.phase === 'ready' ? records.find((item) => item.id === id) ?? null : null),
    create: mock(async (registration: SystemRegistration) => {
      const existing = records.find((item) => item.id === `${registration.repositoryOwner}/${registration.repositoryName}`);
      if (existing) {
        if (existing.team !== registration.team) throw Object.assign(new Error('System is already registered to another team'), { status: 409 });
        return { application: { ...existing, defaultSha: await forgejo.getProjectBranchHead() }, created: false };
      }
      const created = system(registration.repositoryName, registration.team, registration.repositoryOwner);
      records = [...records, created];
      return { application: created, created: true };
    }),
    delete: mock(async (id: string) => { records = records.filter((item) => item.id !== id); }),
    reassign: mock(async (id: string, team: string) => {
      records = records.map((item) => item.id === id ? { ...item, team } : item);
      return records.find((item) => item.id === id)!;
    }),
    invalidate: mock(() => undefined),
    loadErrors: mock(() => []),
  };
  const lifecycle = {
    reserve: mock(async (input: { systemId: string; team: string; repositoryOwner: string; repositoryName: string }) => {
      const existing = onboardingRecords.get(input.systemId);
      if (existing) {
        if (existing.phase === 'removed') {
          Object.assign(existing, input, {
            phase: 'validating', targetSha: null, contractVersion: null, compatibilityIssues: [], policyPlan: null,
            lastError: null, attempts: 0, nextAttemptAt: null, updatedAt: new Date(),
          });
          return existing;
        }
        if (existing.team !== input.team) throw Object.assign(new Error('System is already assigned to another team'), { status: 409 });
        return existing;
      }
      const created = { ...input, targetTeam: null, phase: 'validating' as const, targetSha: null, contractVersion: null, compatibilityIssues: [], policyPlan: null, lastError: null, attempts: 0, nextAttemptAt: null, updatedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, leaseGeneration: 0 };
      onboardingRecords.set(input.systemId, created);
      return created;
    }),
    get: mock(async (id: string) => onboardingRecords.get(id) ?? null),
    list: mock(async () => [...onboardingRecords.values()]),
    claim: mock(async (id: string, owner: string, now: Date, leaseMs: number) => {
      const record = onboardingRecords.get(id)!;
      if (record.leaseOwner && record.leaseExpiresAt! > now) return null;
      Object.assign(record, { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + leaseMs), attempts: record.attempts + 1, leaseGeneration: record.leaseGeneration + 1 });
      return record.leaseGeneration;
    }),
    renew: mock(async (id: string, owner: string, generation: number, now: Date, leaseMs: number) => {
      const record = onboardingRecords.get(id)!;
      if (record.leaseOwner !== owner || record.leaseGeneration !== generation || record.leaseExpiresAt! <= now) return false;
      Object.assign(record, { leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now });
      return true;
    }),
    advance: mock(async (id: string, owner: string, generation: number, phase: OnboardingPhase, detail: Record<string, unknown> = {}, fields: Partial<OnboardingRecord> = {}) => {
      const record = onboardingRecords.get(id)!;
      if (record.leaseOwner !== owner || record.leaseGeneration !== generation) throw new Error('System onboarding lease was lost');
      Object.assign(record, fields, { phase, lastError: null, compatibilityIssues: fields.compatibilityIssues ?? [], updatedAt: new Date() });
      onboardingEvents.push({ systemId: id, phase, detail, createdAt: new Date() });
    }),
    fail: mock(async (id: string, owner: string, generation: number, phase: 'retry-wait' | 'repair' | 'failed' | 'reassigning' | 'reassigning-access' | 'unregistering', error: string, issues = [], nextAttemptAt?: Date) => {
      const record = onboardingRecords.get(id)!;
      if (record.leaseOwner !== owner || record.leaseGeneration !== generation) throw new Error('System onboarding lease was lost');
      const finalPhase = phase === 'retry-wait' && record.attempts >= 5 ? 'repair' : phase;
      Object.assign(record, { phase: finalPhase, lastError: error, compatibilityIssues: issues, nextAttemptAt: ['retry-wait', 'reassigning', 'reassigning-access', 'unregistering'].includes(finalPhase) ? nextAttemptAt ?? null : null, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() });
      onboardingEvents.push({ systemId: id, phase: finalPhase, detail: { error, issues }, createdAt: new Date() });
    }),
    release: mock(async (id: string, owner: string, generation: number) => {
      const record = onboardingRecords.get(id)!;
      if (record.leaseOwner === owner && record.leaseGeneration === generation) Object.assign(record, { leaseOwner: null, leaseExpiresAt: null });
    }),
    events: mock(async (id: string) => onboardingEvents.filter((event) => event.systemId === id)),
    policyPlan: mock(async (id: string, _owner: string, _generation: number, plan: Record<string, unknown>) => { onboardingRecords.get(id)!.policyPlan = plan; }),
    reassign: mock(async (id: string, team: string) => {
      Object.assign(onboardingRecords.get(id)!, { phase: 'reassigning', targetTeam: team, lastError: null });
    }),
    finishReassignment: mock(async (id: string) => {
      const record = onboardingRecords.get(id)!;
      record.team = record.targetTeam!;
      record.targetTeam = null;
      record.phase = 'ready';
      records = records.map((item) => item.id === id ? { ...item, team: record.team } : item);
    }),
    unregister: mock(async (id: string) => { Object.assign(onboardingRecords.get(id)!, { phase: 'unregistering', targetTeam: null }); }),
    remove: mock(async (id: string) => {
      Object.assign(onboardingRecords.get(id)!, { phase: 'removed', targetTeam: null });
    }),
    retry: mock(async (id: string) => { Object.assign(onboardingRecords.get(id)!, { phase: 'validating', attempts: 0, lastError: null, nextAttemptAt: null, compatibilityIssues: [] }); }),
  };
  const stagingState: StagingRecord = {
    systemId: 'factory/app', desiredSha: exactSha, currentSha: exactSha, phase: 'healthy', health: 'healthy',
    workspace: null, lastError: null, attempts: 1, updatedAt: new Date(),
  };
  const staging = {
    reconcileForOnboarding: mock(async (application: ApplicationDefinition) => ({
      ...stagingState,
      systemId: application.id,
      desiredSha: application.defaultSha,
      currentSha: stagingState.phase === 'healthy' ? application.defaultSha : stagingState.currentSha,
    })),
    retryFailed: mock(async () => undefined),
  };
  const deleteStaging = mock(async () => undefined);
  const onboarding = new ApplicationOnboarding(forgejo as never, registry as never, lifecycle, {
    owners,
    reviewUser: 'factory-review',
    implementationUser: 'factory-implementation',
    cloneUser: 'factory-clone',
    teams: [
      { slug: 'factory', forgejoTeam: 'factory-users' },
      { slug: 'payments', forgejoTeam: 'factory-users-payments' },
      { slug: 'platform', forgejoTeam: 'factory-users-platform' },
    ],
  }, staging, deleteStaging);
  return { onboarding, forgejo, registry, lifecycle, staging, stagingState, deleteStaging };
}

describe('application onboarding', () => {
  test('lists private, non-template repositories that are not registered', async () => {
    expect(await fixture().onboarding.availableRepositories()).toEqual([
      { name: 'app', fullName: 'factory/app', description: 'App', defaultBranch: 'main', repositoryUrl: 'https://git/factory/app' },
      { name: 'inventory', fullName: 'factory/inventory', description: 'Second System', defaultBranch: 'main', repositoryUrl: 'https://git/factory/inventory' },
    ]);
  });

  test('lists unregistered private Systems only when assigned to a visible Forgejo team', async () => {
    const found = fixture([], ['factory']);

    expect(await found.onboarding.availableRepositories(['payments'])).toEqual([
      { name: 'app', fullName: 'factory/app', description: 'App', defaultBranch: 'main', repositoryUrl: 'https://git/factory/app' },
    ]);
    expect(await found.onboarding.availableRepositories(['platform'])).toEqual([]);
  });

  test('discovers and registers repositories only across authorized owners', async () => {
    const found = fixture([], ['factory', 'payments']);
    found.forgejo.listOwnerRepositories.mockImplementation(async (owner = 'factory') => [{
      name: 'app', full_name: `${owner}/app`, description: owner, private: true, template: false,
      default_branch: 'main', html_url: `https://git/${owner}/app`,
    }]);
    found.forgejo.getProjectRepository.mockImplementation(async (owner: string, repository: string) => ({
      name: repository, full_name: `${owner}/${repository}`, description: '', private: true, template: false,
      default_branch: 'main', html_url: `https://git/${owner}/${repository}`,
    }));

    expect((await found.onboarding.availableRepositories()).map((repository) => repository.fullName)).toEqual(['factory/app', 'payments/app']);
    expect(await found.onboarding.register('payments/app', 'payments')).toMatchObject({ id: 'payments/app' });
    expect(found.forgejo.ensureCollaborator).toHaveBeenCalledWith('payments', 'app', 'factory-implementation', 'write', expect.any(AbortSignal));
    await expect(found.onboarding.register('unknown/app', 'payments')).rejects.toMatchObject({ status: 403 });
  });

  test('validates the exact-SHA System contract before persisting only registration identity', async () => {
    const { onboarding, forgejo, registry, lifecycle, staging } = fixture([]);

    expect(await onboarding.register('app', 'payments')).toMatchObject({ id: 'factory/app', team: 'payments' });
    expect(forgejo.getProjectBranchHead).toHaveBeenCalledWith('factory', 'app', 'main', expect.any(AbortSignal));
    expect(forgejo.readProjectFile).toHaveBeenCalledWith('factory', 'app', exactSha, '.factory/system.yaml', expect.any(AbortSignal));
    expect(forgejo.readProjectFile).toHaveBeenCalledWith('factory', 'app', exactSha, '.devcontainer/devcontainer.json', expect.any(AbortSignal));
    expect(forgejo.readProjectFile).toHaveBeenCalledWith('factory', 'app', exactSha, '.devcontainer/verification/devcontainer.json', expect.any(AbortSignal));
    expect(registry.create).toHaveBeenCalledWith({
      team: 'payments', repositoryOwner: 'factory', repositoryName: 'app',
    });
    expect(forgejo.ensureMainBranchProtection).toHaveBeenCalledWith('factory', 'app', 'main', expect.any(AbortSignal));
    expect(lifecycle.policyPlan.mock.invocationCallOrder[0]).toBeLessThan(forgejo.ensureMainBranchProtection.mock.invocationCallOrder[0]!);
    expect(forgejo.ensureTeamRepository).toHaveBeenCalledWith('factory', 'factory-users-payments', 'app', expect.any(AbortSignal));
    expect(staging.reconcileForOnboarding).not.toHaveBeenCalled();
    expect(await lifecycle.get('factory/app')).toMatchObject({ phase: 'creating-staging' });
  });

  test('moves onboarding to ready when persisted staging is healthy', async () => {
    const found = fixture([]);

    await found.onboarding.register('app', 'payments');
    await found.onboarding.reconcileDue();

    expect(found.staging.reconcileForOnboarding).toHaveBeenCalledWith(expect.objectContaining({ id: 'factory/app', defaultSha: exactSha }), expect.any(AbortSignal));
    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'ready' });
  });

  test('keeps onboarding in creating-staging while persisted staging is pending', async () => {
    const found = fixture([]);
    Object.assign(found.stagingState, { phase: 'provisioning', health: 'initializing', currentSha: null, lastError: null });

    await found.onboarding.register('app', 'payments');
    await found.onboarding.reconcileDue();

    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'creating-staging', lastError: null });
  });

  test('moves failed staging to repair and resets it on an explicit onboarding retry', async () => {
    const found = fixture([]);
    Object.assign(found.stagingState, { phase: 'failed', health: 'unhealthy', currentSha: null, lastError: 'Coder provisioning failed' });

    await found.onboarding.register('app', 'payments');
    await found.onboarding.reconcileDue();

    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'repair', lastError: 'Coder provisioning failed' });

    Object.assign(found.stagingState, { phase: 'healthy', health: 'healthy', currentSha: exactSha, lastError: null });
    await found.onboarding.register('app', 'payments');
    expect(found.staging.retryFailed).toHaveBeenCalledWith('factory/app');
    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'creating-staging' });
    await found.onboarding.reconcileDue();
    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'ready' });
  });

  test('allows only one worker to mutate policy under concurrent onboarding', async () => {
    const { onboarding, forgejo, registry, lifecycle } = fixture([]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const policyStarted = new Promise<void>((resolve) => { entered = resolve; });
    forgejo.ensureCollaborator.mockImplementationOnce(async () => {
      expect(registry.create).not.toHaveBeenCalled();
      entered();
      await gate;
    });

    const first = onboarding.register('app', 'payments');
    await policyStarted;
    const second = onboarding.register('app', 'payments');

    await expect(second).rejects.toMatchObject({ status: 409 });
    expect(lifecycle.claim).toHaveBeenCalledTimes(2);
    expect(registry.create).not.toHaveBeenCalled();
    expect(forgejo.ensureCollaborator).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ id: 'factory/app' });
    expect(registry.create).toHaveBeenCalledTimes(1);
    expect(forgejo.ensureCollaborator).toHaveBeenCalledTimes(3);
  });

  test('aborts onboarding when heartbeat renewal throws', async () => {
    const found = fixture([]);
    Object.assign(found.onboarding as unknown as { heartbeatMs: number }, { heartbeatMs: 1 });
    found.lifecycle.renew.mockRejectedValue(new Error('database unavailable'));
    let collaboratorSignal: AbortSignal | undefined;
    (found.forgejo.ensureCollaborator as unknown as { mockImplementationOnce(implementation: (...args: unknown[]) => Promise<void>): void }).mockImplementationOnce(async (...args: unknown[]) => {
      const signal = args[4] as AbortSignal | undefined;
      collaboratorSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    await expect(found.onboarding.register('app', 'payments')).rejects.toThrow('System onboarding lease heartbeat failed');

    expect(collaboratorSignal?.aborted).toBe(true);
    expect(found.forgejo.ensureCollaborator).toHaveBeenCalledTimes(1);
    expect(found.registry.create).not.toHaveBeenCalled();
  });

  test('keeps an existing repository registration idempotent for its team', async () => {
    const existing = system('app', 'payments');
    const { onboarding, registry, forgejo } = fixture([existing]);

    expect(await onboarding.register('app', 'payments')).toBe(existing);
    expect(registry.create).not.toHaveBeenCalled();
    expect(forgejo.getProjectBranchHead).toHaveBeenCalledTimes(1);
  });

  test('reconciles an existing ready System when its default branch advances', async () => {
    const existing = system('app', 'payments');
    const found = fixture([existing]);
    found.forgejo.getProjectBranchHead.mockResolvedValue('b'.repeat(40));

    expect(await found.onboarding.register('app', 'payments')).toMatchObject({ id: 'factory/app' });
    expect(found.registry.create).toHaveBeenCalledTimes(1);
    await found.onboarding.reconcileDue();
    expect(found.staging.reconcileForOnboarding).toHaveBeenCalledWith(expect.objectContaining({ defaultSha: 'b'.repeat(40) }), expect.any(AbortSignal));
  });

  test('does not silently remap an existing System to another team', async () => {
    const { onboarding, registry } = fixture([system('app', 'payments')]);
    await expect(onboarding.register('app', 'factory')).rejects.toMatchObject({ status: 409 });
    expect(registry.create).not.toHaveBeenCalled();
  });

  test('hides a System, revokes its old team, then publishes its new team', async () => {
    const { onboarding, forgejo, registry, lifecycle } = fixture([system('app', 'payments')]);
    Object.assign((await lifecycle.get('factory/app'))!, { policyPlan: {
      access: { managedTeam: 'factory-users-payments', teamGrantAdded: true, collaboratorGrantAdded: { 'factory-implementation': true, 'factory-review': true, 'factory-clone': true } },
    } });
    (forgejo.teamHasRepository as unknown as { mockImplementation(fn: (_owner: string, team: string) => Promise<boolean>): void })
      .mockImplementation(async (_owner, team) => team === 'factory-users-payments');
    forgejo.removeTeamRepository.mockImplementationOnce(async () => {
      expect(await registry.get('factory/app')).toBeNull();
      expect(await lifecycle.get('factory/app')).toMatchObject({ team: 'payments', targetTeam: 'platform', phase: 'reassigning' });
    });
    forgejo.ensureTeamRepository.mockImplementationOnce(async () => {
      expect(forgejo.removeTeamRepository).toHaveBeenCalledWith('factory', 'factory-users-payments', 'app', expect.any(AbortSignal));
      expect(await registry.get('factory/app')).toBeNull();
    });
    expect(await onboarding.reassign('factory/app', 'platform')).toMatchObject({ id: 'factory/app', team: 'platform' });
    expect(await registry.get('factory/app')).toMatchObject({ team: 'platform' });
    expect(await lifecycle.get('factory/app')).toMatchObject({ team: 'platform', targetTeam: null, phase: 'ready' });
    expect(forgejo.removeTeamRepository.mock.invocationCallOrder[0]).toBeLessThan(forgejo.ensureTeamRepository.mock.invocationCallOrder[0]!);
    expect(forgejo.ensureTeamRepository).toHaveBeenCalledTimes(1);
  });

  test('retries new team access and verifies old access is revoked before publication', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { policyPlan: {
      access: { managedTeam: 'factory-users-payments', teamGrantAdded: true, collaboratorGrantAdded: { 'factory-implementation': true, 'factory-review': true, 'factory-clone': true } },
    } });
    (found.forgejo.teamHasRepository as unknown as { mockImplementation(fn: (_owner: string, team: string) => Promise<boolean>): void })
      .mockImplementation(async (_owner, team) => team === 'factory-users-payments');
    found.forgejo.ensureTeamRepository.mockRejectedValueOnce(new UpstreamHttpError('Forgejo', 503));

    await expect(found.onboarding.reassign('factory/app', 'platform')).rejects.toThrow('Forgejo returned 503');

    expect(await found.registry.get('factory/app')).toBeNull();
    expect(await found.lifecycle.get('factory/app')).toMatchObject({ team: 'payments', targetTeam: 'platform', phase: 'reassigning-access', lastError: 'Forgejo returned 503' });
    Object.assign((await found.lifecycle.get('factory/app'))!, { nextAttemptAt: new Date(0) });
    await found.onboarding.reconcileDue();
    expect(found.forgejo.removeTeamRepository).toHaveBeenCalledTimes(1);
    expect(found.forgejo.ensureTeamRepository).toHaveBeenCalledTimes(2);
    expect(await found.registry.get('factory/app')).toMatchObject({ team: 'platform' });
  });

  test('blocks registration while reassignment is in progress', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { phase: 'reassigning', targetTeam: 'platform' });

    await expect(found.onboarding.register('factory/app', 'payments')).rejects.toMatchObject({ status: 409 });

    expect(found.lifecycle.claim).not.toHaveBeenCalled();
    expect(found.forgejo.ensureCollaborator).not.toHaveBeenCalled();
  });

  test('preserves policy ownership evidence across onboarding retries', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, {
      phase: 'applying-policy',
      policyPlan: {
        mainBranch: { branch: 'main', created: true, addedStatusChecks: ['factory/specification'] },
        implementationBranchProtectionCreated: true,
      },
    });
    found.forgejo.planMainBranchProtection.mockResolvedValue({
      created: false, addedStatusChecks: ['factory/verification'], preservedStatusChecks: ['factory/specification'],
    });
    found.forgejo.branchProtectionNeedsAdding.mockResolvedValue(false);

    await found.onboarding.register('factory/app', 'payments');

    expect(await found.lifecycle.get('factory/app')).toMatchObject({ policyPlan: {
      mainBranch: { created: true, addedStatusChecks: ['factory/specification', 'factory/verification'] },
      implementationBranchProtectionCreated: true,
    } });
  });

  test('unregisters the visible System but retains removed lifecycle evidence', async () => {
    const { onboarding, forgejo, registry, lifecycle, deleteStaging } = fixture([system('app', 'payments')]);
    Object.assign((await lifecycle.get('factory/app'))!, { policyPlan: {
      implementationBranchProtectionCreated: true,
      mainBranch: { branch: 'main', created: false, addedStatusChecks: ['factory/specification'] },
      access: { managedTeam: 'factory-users-payments', teamGrantAdded: true, collaboratorGrantAdded: { 'factory-implementation': true, 'factory-review': true, 'factory-clone': true } },
    } });
    await onboarding.unregister('factory/app');
    expect(deleteStaging).toHaveBeenCalledWith(expect.objectContaining({ systemId: 'factory/app', repositoryOwner: 'factory', repositoryName: 'app' }), expect.any(AbortSignal));
    expect(registry.delete).not.toHaveBeenCalled();
    expect(await registry.get('factory/app')).toBeNull();
    expect(await lifecycle.get('factory/app')).toMatchObject({ phase: 'removed' });
    expect(forgejo.removeTeamRepository).toHaveBeenCalledWith('factory', 'factory-users-payments', 'app', expect.any(AbortSignal));
    expect(forgejo.removeCollaborator.mock.calls.map((call) => call[2])).toEqual(['factory-implementation', 'factory-review', 'factory-clone']);
    expect(forgejo.removeFactoryImplementationBranchProtection).toHaveBeenCalledWith(
      'factory', 'app', 'factory-implementation', true, expect.any(AbortSignal),
    );
    expect(forgejo.removeFactoryMainBranchProtection).toHaveBeenCalledWith(
      'factory', 'app', 'main', { branch: 'main', created: false, addedStatusChecks: ['factory/specification'] }, expect.any(AbortSignal),
    );
  });

  test('unregister preserves repository access that existed before onboarding', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { policyPlan: {
      mainBranch: { branch: 'main', created: false, addedStatusChecks: ['factory/specification'] },
      access: {
        managedTeam: 'factory-users-payments',
        teamGrantAdded: false,
        collaboratorGrantAdded: { 'factory-implementation': false, 'factory-review': false, 'factory-clone': true },
      },
    } });

    await found.onboarding.unregister('factory/app');

    expect(found.forgejo.removeTeamRepository).not.toHaveBeenCalled();
    expect(found.forgejo.removeCollaborator.mock.calls.map((call) => call[2])).toEqual(['factory-clone']);
    expect(found.forgejo.ensureCollaborator).not.toHaveBeenCalled();
  });

  test('does not elevate a pre-existing direct collaborator during onboarding', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { phase: 'validating', targetSha: null });
    found.forgejo.directCollaborators.mockResolvedValue(['factory-implementation']);
    found.forgejo.collaboratorPermission.mockImplementation(async (_owner: string, _repository: string, username: string) => username === 'factory-implementation' ? 'read' : null);

    await expect(found.onboarding.register('factory/app', 'payments')).rejects.toMatchObject({ status: 400 });

    expect(found.forgejo.ensureCollaborator).not.toHaveBeenCalledWith('factory', 'app', 'factory-implementation', 'write', expect.anything());
  });

  test('refuses unregister when legacy ownership evidence is incomplete', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { policyPlan: {
      mainBranch: { created: false, addedStatusChecks: ['factory/specification'] },
    } });

    await expect(found.onboarding.unregister('factory/app')).rejects.toMatchObject({ status: 409 });
    expect(found.forgejo.removeFactoryImplementationBranchProtection).not.toHaveBeenCalled();
    expect(found.deleteStaging).not.toHaveBeenCalled();
  });

  test('passes WorkerHost cancellation into unregister retry work', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { phase: 'unregistering', nextAttemptAt: new Date(0), policyPlan: ownedPolicy() });
    const controller = new AbortController();
    const reason = new Error('worker host stopped');
    let observedReason: unknown;
    (found.deleteStaging as unknown as { mockImplementationOnce(implementation: (_record: OnboardingRecord, signal?: AbortSignal) => Promise<void>): void })
      .mockImplementationOnce(async (_record, signal) => {
      controller.abort(reason);
      await Promise.resolve();
      observedReason = signal?.reason;
      });

    await found.onboarding.reconcileDue(controller.signal);

    expect(observedReason).toBe(reason);
  });

  test('refuses unregister when staging cleanup fails and retains recovery state', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { policyPlan: ownedPolicy() });
    found.deleteStaging.mockRejectedValue(new Error('Coder cleanup failed'));

    await expect(found.onboarding.unregister('factory/app')).rejects.toThrow('Coder cleanup failed');

    expect(found.registry.delete).not.toHaveBeenCalled();
    expect(await found.registry.get('factory/app')).toBeNull();
    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'unregistering', lastError: 'Coder cleanup failed', nextAttemptAt: expect.any(Date) });
  });

  test('does not authorize a removed System through its historical team', async () => {
    const found = fixture([system('app', 'payments')]);
    Object.assign((await found.lifecycle.get('factory/app'))!, { policyPlan: ownedPolicy() });
    await found.onboarding.unregister('factory/app');

    expect(await found.onboarding.teamFor('factory/app')).toBeNull();
    expect(await found.onboarding.availableRepositories(['payments'])).toEqual([
      { name: 'app', fullName: 'factory/app', description: 'App', defaultBranch: 'main', repositoryUrl: 'https://git/factory/app' },
    ]);
    found.forgejo.listTeamRepositories.mockResolvedValue([]);
    expect(await found.onboarding.canRegister('factory/app', ['payments'])).toBe(false);
  });

  test('creates a manifest-only remediation PR from structured compatibility issues', async () => {
    const found = fixture([]);
    found.forgejo.readProjectFile.mockImplementation(async (_owner: string, _repository: string, _ref: string, path: string) => {
      if (path === '.factory/system.yaml') return 'version: 2';
      return devcontainer;
    });
    await expect(found.onboarding.register('app', 'payments')).rejects.toMatchObject({ status: 422 });

    expect(await found.onboarding.createRemediation('factory/app')).toMatchObject({ pullNumber: 7, pullUrl: 'https://git/pulls/7' });
    expect(found.forgejo.ensureBranch).toHaveBeenCalledWith('factory', 'app', expect.stringMatching(/^factory\/remediate-contract-/), 'main', undefined, true);
    expect(found.forgejo.upsertProjectFile).toHaveBeenCalledWith(
      'factory', 'app', expect.any(String), '.factory/system.yaml', expect.stringContaining('REPLACE_ME'),
      'add Agentic Software Factory repository contract', undefined,
    );
    expect(found.forgejo.createPullRequest).toHaveBeenCalledWith(
      'factory', 'app', 'Add Agentic Software Factory repository contract', expect.stringContaining('Agentic Software Factory generated a contract skeleton'),
      expect.any(String), 'main', undefined,
    );
  });

  test('refuses remediation when the repository does not have a repair state', async () => {
    const found = fixture([system('app', 'payments')]);
    await expect(found.onboarding.createRemediation('factory/app')).rejects.toMatchObject({ status: 409 });
  });

  test('persists a definite policy failure without publishing a registration', async () => {
    const { onboarding, forgejo, registry, lifecycle } = fixture([]);
    forgejo.ensureMainBranchProtection.mockRejectedValue(new UpstreamHttpError('Forgejo', 403));

    await expect(onboarding.register('app', 'payments')).rejects.toThrow('Forgejo returned 403');
    expect(registry.delete).not.toHaveBeenCalled();
    expect(await registry.get('factory/app')).toBeNull();
    expect(await lifecycle.get('factory/app')).toMatchObject({ phase: 'repair', lastError: 'Forgejo returned 403' });
  });

  test('keeps a new reservation when policy outcome is uncertain', async () => {
    const { onboarding, forgejo, registry, lifecycle } = fixture([]);
    forgejo.ensureMainBranchProtection.mockRejectedValue(new UpstreamHttpError('Forgejo', 503));

    await expect(onboarding.register('app', 'payments')).rejects.toThrow('Forgejo returned 503');
    expect(registry.delete).not.toHaveBeenCalled();
    expect(await registry.get('factory/app')).toBeNull();
    expect(await lifecycle.get('factory/app')).toMatchObject({ phase: 'retry-wait', lastError: 'Forgejo returned 503', nextAttemptAt: expect.any(Date) });
  });

  test('stops automatic onboarding retries after five attempts', async () => {
    const found = fixture([]);
    found.forgejo.ensureMainBranchProtection.mockRejectedValue(new UpstreamHttpError('Forgejo', 503));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(found.onboarding.register('app', 'payments')).rejects.toThrow('Forgejo returned 503');
    }
    expect(await found.lifecycle.get('factory/app')).toMatchObject({ phase: 'repair', attempts: 5 });
  });

  test('resumes staging after a crash left registration persisted before ready', async () => {
    const { onboarding, forgejo, registry, lifecycle } = fixture([system('app', 'payments')]);
    Object.assign((await lifecycle.get('factory/app'))!, { phase: 'creating-staging' });

    await onboarding.reconcileDue();

    expect(forgejo.ensureMainBranchProtection).not.toHaveBeenCalled();
    expect(registry.create).toHaveBeenCalledTimes(1);
    expect(await lifecycle.get('factory/app')).toMatchObject({ phase: 'ready' });
  });

  test('rejects invalid repository and Dev Container contracts before changing policy', async () => {
    const publicRepository = fixture([]);
    publicRepository.forgejo.getProjectRepository.mockResolvedValue({ name: 'app', full_name: 'factory/app', description: '', private: false, template: false, default_branch: 'main', html_url: 'https://git/factory/app' });
    await expect(publicRepository.onboarding.register('app', 'factory')).rejects.toThrow('private');

    const branchless = fixture([]);
    branchless.forgejo.getProjectRepository.mockResolvedValue({ name: 'app', full_name: 'factory/app', description: '', private: true, template: false, default_branch: '', html_url: 'https://git/factory/app' });
    await expect(branchless.onboarding.register('app', 'factory')).rejects.toThrow('default branch');

    const invalidConfig = fixture([]);
    invalidConfig.forgejo.readProjectFile.mockImplementation(async (_owner: string, _repository: string, _ref: string, path: string) => (
      path === '.factory/system.yaml' ? 'version: 2' : devcontainer
    ));
    await expect(invalidConfig.onboarding.register('app', 'factory')).rejects.toMatchObject({ status: 422 });
    expect(invalidConfig.forgejo.ensureCollaborator).not.toHaveBeenCalled();

    const unsafeReview = fixture([]);
    unsafeReview.forgejo.readProjectFile.mockImplementation(async (_owner: string, _repository: string, _branch: string, path: string) => (
      path === '.factory/system.yaml' ? systemManifest
        : path === '.devcontainer/verification/devcontainer.json'
        ? JSON.stringify({
          workspaceMount: 'source=${localWorkspaceFolder},target=/workspaces/project,type=bind',
          workspaceFolder: '/workspaces/project',
        })
        : devcontainer
    ));
    await expect(unsafeReview.onboarding.register('app', 'factory')).rejects.toMatchObject({ status: 422 });
    expect(unsafeReview.registry.create).not.toHaveBeenCalled();

    const missingConfig = fixture([]);
    missingConfig.forgejo.readProjectFile.mockImplementation(async (_owner: string, _repository: string, _branch: string, path: string) => {
      if (path === '.devcontainer/verification/devcontainer.json') throw new Error('Forgejo returned 404');
      return path === '.factory/system.yaml' ? systemManifest : devcontainer;
    });
    await expect(missingConfig.onboarding.register('app', 'factory')).rejects.toMatchObject({ status: 422, issues: [{ path: '.devcontainer/verification/devcontainer.json', code: 'missing-file' }] });
    expect(missingConfig.registry.create).not.toHaveBeenCalled();
  });

  test('rejects unknown teams before reading Forgejo', async () => {
    const { onboarding, forgejo } = fixture([]);
    await expect(onboarding.register('app', 'unknown')).rejects.toThrow('team not found');
    expect(forgejo.getProjectRepository).not.toHaveBeenCalled();
  });
});
