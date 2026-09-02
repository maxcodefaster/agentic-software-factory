/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ForgejoClient, Repository } from '../forgejo/client';
import type {
  OnboardingAttempt,
  OnboardingRepository,
} from '@agentic-software-factory/api-contracts/applications';
import { startLeaseHeartbeat } from '../lease-heartbeat';
import type { ApplicationDefinition, SystemRegistration } from './catalog';
import type { OnboardingLifecycleStore } from './onboarding-store';
import type { ApplicationRegistry } from './registry';
import type { StagingReconciler } from './staging';
import { inspectSystemContract, systemContractReferences, type CompatibilityIssue, type SystemContract } from './system-contract';

export type { OnboardingAttempt, OnboardingRepository };

interface OnboardingConfig {
  owners: string[];
  implementationUser: string;
  reviewUser: string;
  cloneUser: string;
  teams: Array<{ slug: string; forgejoTeam: string }>;
}

export class ApplicationOnboarding {
  constructor(
    private readonly forgejo: ForgejoClient,
    private readonly registry: Pick<ApplicationRegistry, 'list' | 'get' | 'create' | 'delete' | 'invalidate' | 'loadErrors'>,
    private readonly lifecycle: OnboardingLifecycleStore,
    private readonly config: OnboardingConfig,
    private readonly staging: Pick<StagingReconciler, 'reconcileForOnboarding' | 'retryFailed'> | undefined,
    private readonly deleteStaging: (repository: { systemId: string; repositoryOwner: string; repositoryName: string }, signal?: AbortSignal) => Promise<void>,
    private readonly workerId = crypto.randomUUID(),
    private readonly heartbeatMs = 30_000,
  ) {}

  async availableRepositories(teams?: readonly string[], signal?: AbortSignal): Promise<OnboardingRepository[]> {
    const registered = new Set((await this.lifecycle.list()).filter((record) => record.phase !== 'removed').map((record) => record.systemId));
    const repositories = (await Promise.all(this.config.owners.map((owner) => this.forgejo.listOwnerRepositories(owner, signal)))).flat();
    const allowed = teams
      ? new Set((await Promise.all(teams.flatMap((team) => {
        const found = this.config.teams.find((candidate) => candidate.slug === team);
        return found ? this.config.owners.map((owner) => this.forgejo.listTeamRepositories(owner, found.forgejoTeam, signal)) : [];
      }))).flat().map((repository) => repository.full_name))
      : null;
    return repositories
      .filter((repository) => repository.private && !repository.template && !registered.has(repository.full_name) && (!allowed || allowed.has(repository.full_name)))
      .map(toCandidate);
  }

  async attempts(): Promise<OnboardingAttempt[]> {
    return (await this.lifecycle.list()).map((record) => ({
      ...record,
      nextAttemptAt: record.nextAttemptAt?.toISOString() ?? null,
      updatedAt: record.updatedAt.toISOString(),
    }));
  }

  loadErrors(): Array<{ systemId: string; error: string }> {
    return this.registry.loadErrors();
  }

  async teamFor(repositoryIdentity: string): Promise<string | null> {
    const { owner, repositoryName } = parseRepositoryIdentity(repositoryIdentity, this.config.owners);
    const record = await this.lifecycle.get(`${owner}/${repositoryName}`);
    return record && record.phase !== 'removed' ? record.team : null;
  }

  async canRegister(repositoryIdentity: string, teams: readonly string[], signal?: AbortSignal): Promise<boolean> {
    const { owner, repositoryName } = parseRepositoryIdentity(repositoryIdentity, this.config.owners);
    const systemId = `${owner}/${repositoryName}`;
    return (await this.availableRepositories(teams, signal)).some((repository) => repository.fullName === systemId);
  }

  async reconcileDue(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const due = (await this.lifecycle.list()).filter((record) => (
      record.phase === 'retry-wait' && (!record.nextAttemptAt || record.nextAttemptAt.getTime() <= now)
    ) || ['validating', 'applying-access', 'applying-policy', 'creating-staging'].includes(record.phase)
      || (['reassigning', 'reassigning-access', 'unregistering'].includes(record.phase)
        && (!record.nextAttemptAt || record.nextAttemptAt.getTime() <= now)));
    for (const record of due) {
      if (signal?.aborted) return;
      if (record.phase === 'reassigning' || record.phase === 'reassigning-access') {
        await this.reassignClaimable(record, signal).catch((error) => console.error(JSON.stringify({
          timestamp: new Date().toISOString(), level: 'warn', event: 'system_reassign_reconcile_failed',
          systemId: record.systemId, error: error instanceof Error ? error.message : String(error),
        })));
        continue;
      }
      if (record.phase === 'unregistering') {
        await this.unregister(record.systemId, signal).catch((error) => console.error(JSON.stringify({
          timestamp: new Date().toISOString(), level: 'warn', event: 'system_unregister_reconcile_failed',
          systemId: record.systemId, error: error instanceof Error ? error.message : String(error),
        })));
        continue;
      }
      await this.register(record.systemId, record.team, signal).catch((error) => {
        if (typeof error === 'object' && error && 'status' in error && error.status === 409) return;
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(), level: 'warn', event: 'system_onboarding_reconcile_failed',
          systemId: record.systemId, error: error instanceof Error ? error.message : String(error),
        }));
      });
    }
  }

  async register(repositoryIdentity: string, team: string, signal?: AbortSignal): Promise<ApplicationDefinition> {
    const { owner, repositoryName } = parseRepositoryIdentity(repositoryIdentity, this.config.owners);
    validateRepositoryName(repositoryName);
    const factoryTeam = this.config.teams.find((candidate) => candidate.slug === team);
    if (!factoryTeam) throw Object.assign(new Error('team not found'), { status: 404 });
    const id = `${owner}/${repositoryName}`;
    const existing = await this.registry.get(id);
    if (existing && existing.team !== team) throw Object.assign(new Error('System is already registered to another team'), { status: 409 });
    let lifecycle = await this.lifecycle.reserve({ systemId: id, team, repositoryOwner: owner, repositoryName });
    if (['reassigning', 'reassigning-access', 'unregistering'].includes(lifecycle.phase)) {
      throw Object.assign(new Error('System has another lifecycle transition in progress'), { status: 409 });
    }
    if (existing && lifecycle.phase === 'ready') {
      const repository = await this.forgejo.getProjectRepository(owner, repositoryName, signal);
      const currentSha = await this.forgejo.getProjectBranchHead(owner, repositoryName, repository.default_branch, signal);
      if (currentSha === lifecycle.targetSha) return existing;
    }
    if (['repair', 'failed'].includes(lifecycle.phase)) {
      await this.lifecycle.retry(id);
      await this.staging?.retryFailed(id);
      lifecycle = (await this.lifecycle.get(id))!;
    }

    const leaseMs = 5 * 60_000;
    const generation = await this.lifecycle.claim(id, this.workerId, new Date(), leaseMs);
    if (generation === null) {
      throw Object.assign(new Error('System onboarding is already in progress'), { status: 409 });
    }
    const heartbeat = await startLeaseHeartbeat(
      () => this.lifecycle.renew(id, this.workerId, generation, new Date(), leaseMs),
      this.heartbeatMs,
      { lost: 'System onboarding lease was lost', failed: 'System onboarding lease heartbeat failed' },
    );
    const registrationSignal = signal ? AbortSignal.any([signal, heartbeat.signal]) : heartbeat.signal;
    try {
      const application = lifecycle.phase === 'creating-staging'
        ? await this.reconcileStagingClaimed(id, owner, repositoryName, factoryTeam.slug, generation, registrationSignal)
        : await this.registerClaimed(id, owner, repositoryName, factoryTeam, generation, registrationSignal);
      heartbeat.throwIfLost();
      return application;
    } catch (error) {
      heartbeat.throwIfLost();
      throw error;
    } finally {
      try {
        await heartbeat.stop();
        heartbeat.throwIfLost();
      } finally {
        await this.lifecycle.release(id, this.workerId, generation);
      }
    }
  }

  async reassign(systemId: string, team: string, signal?: AbortSignal): Promise<ApplicationDefinition> {
    if (!this.config.teams.some((candidate) => candidate.slug === team)) throw Object.assign(new Error('team not found'), { status: 404 });
    const record = await this.lifecycle.get(systemId);
    if (!record) throw Object.assign(new Error('System was not found'), { status: 404 });
    await this.lifecycle.reassign(systemId, team);
    this.registry.invalidate(systemId);
    await this.reassignClaimable((await this.lifecycle.get(systemId))!, signal);
    this.registry.invalidate(systemId);
    const application = await this.registry.get(systemId);
    if (!application) throw new Error('System reassignment did not publish the registration');
    return application;
  }

  async unregister(systemId: string, signal?: AbortSignal): Promise<void> {
    const record = await this.lifecycle.get(systemId);
    if (!record || record.phase === 'removed') return;
    const serviceUsers = [this.config.implementationUser, this.config.reviewUser, this.config.cloneUser];
    if (!record.policyPlan || !isAccessOwnership(record.policyPlan.access, serviceUsers) || !isMainBranchPolicyPlan(record.policyPlan.mainBranch)) {
      throw Object.assign(new Error('System access ownership is unknown; repair the registration before unregistering'), { status: 409 });
    }
    await this.lifecycle.unregister(systemId);
    this.registry.invalidate(systemId);
    const leaseMs = 15 * 60_000;
    const generation = await this.lifecycle.claim(systemId, this.workerId, new Date(), leaseMs);
    if (generation === null) throw Object.assign(new Error('System onboarding is already in progress'), { status: 409 });
    const heartbeat = await startLeaseHeartbeat(
      () => this.lifecycle.renew(systemId, this.workerId, generation, new Date(), leaseMs),
      this.heartbeatMs,
      { lost: 'System onboarding lease was lost', failed: 'System onboarding lease heartbeat failed' },
    );
    const transitionSignal = signal ? AbortSignal.any([signal, heartbeat.signal]) : heartbeat.signal;
    try {
      await this.deleteStaging(record, transitionSignal);
      await this.revokeFactoryAccess(record, transitionSignal);
      heartbeat.throwIfLost();
      await heartbeat.stop();
      heartbeat.throwIfLost();
      await this.lifecycle.remove(systemId, this.workerId, generation);
      this.registry.invalidate(systemId);
    } catch (error) {
      await heartbeat.stop();
      let failure = error;
      try {
        heartbeat.throwIfLost();
      } catch (leaseError) {
        failure = leaseError;
      }
      await this.lifecycle.fail(systemId, this.workerId, generation, 'unregistering', failure instanceof Error ? failure.message : String(failure), [], new Date(Date.now() + 30_000)).catch(() => undefined);
      throw failure;
    } finally {
      try {
        await heartbeat.stop();
      } finally {
        await this.lifecycle.release(systemId, this.workerId, generation);
      }
    }
  }

  async createRemediation(systemId: string, signal?: AbortSignal): Promise<{ pullNumber: number; pullUrl: string; branch: string }> {
    const record = await this.lifecycle.get(systemId);
    if (!record) throw Object.assign(new Error('System was not found'), { status: 404 });
    if (!['repair', 'failed'].includes(record.phase)) throw Object.assign(new Error('System does not require manual remediation'), { status: 409 });
    const repository = await this.forgejo.getProjectRepository(record.repositoryOwner, record.repositoryName, signal);
    const branch = `factory/remediate-contract-${Date.now().toString(36)}`;
    await this.forgejo.ensureBranch(record.repositoryOwner, record.repositoryName, branch, repository.default_branch, signal, true);
    const manifest = remediationManifest(record.compatibilityIssues);
    await this.forgejo.upsertProjectFile(
      record.repositoryOwner, record.repositoryName, branch, '.factory/system.yaml', manifest,
      'add Agentic Software Factory repository contract', signal,
    );
    const body = [
      'Agentic Software Factory generated a contract skeleton. Replace every `REPLACE_ME` value with repository-owned commands and paths.',
      '',
      ...record.compatibilityIssues.map((issue) => `- \`${issue.path}\` ${issue.message}`),
    ].join('\n');
    const pull = await this.forgejo.createPullRequest(
      record.repositoryOwner, record.repositoryName, 'Add Agentic Software Factory repository contract', body, branch, repository.default_branch, signal,
    );
    return { pullNumber: pull.number, pullUrl: pull.html_url, branch };
  }

  private async registerClaimed(id: string, owner: string, repositoryName: string, team: { slug: string; forgejoTeam: string }, generation: number, signal?: AbortSignal): Promise<ApplicationDefinition> {
    try {
      await this.lifecycle.advance(id, this.workerId, generation, 'validating');
      const repository = await this.forgejo.getProjectRepository(owner, repositoryName, signal);
      if (!repository.private) throw invalid('System repository must be private');
      if (!repository.default_branch.trim()) throw invalid('System repository must have a default branch');

      const repositorySha = await this.forgejo.getProjectBranchHead(owner, repositoryName, repository.default_branch, signal);
      const contract = await this.readContract(owner, repositoryName, repositorySha, signal);
      await this.lifecycle.advance(id, this.workerId, generation, 'applying-access', { targetSha: repositorySha }, {
        targetSha: repositorySha,
        contractVersion: contract.version,
      });
      const previousPolicy = (await this.lifecycle.get(id))?.policyPlan;
      const serviceUsers = [this.config.implementationUser, this.config.reviewUser, this.config.cloneUser];
      let accessOwnership = isAccessOwnership(previousPolicy?.access, serviceUsers) ? previousPolicy.access : null;
      if (!accessOwnership) {
        const directCollaborators = new Set((await this.forgejo.directCollaborators(owner, repositoryName, signal)).map((username) => username.toLowerCase()));
        const collaboratorGrantAdded: Record<string, boolean> = {};
        for (const [username, permission] of [[this.config.implementationUser, 'write'], [this.config.reviewUser, 'read'], [this.config.cloneUser, 'read']] as const) {
          const current = await this.forgejo.collaboratorPermission(owner, repositoryName, username, signal);
          if (directCollaborators.has(username.toLowerCase()) && !permissionIncludes(current, permission)) {
            throw invalid(`Existing collaborator ${username} does not have ${permission} access`);
          }
          collaboratorGrantAdded[username] = !directCollaborators.has(username.toLowerCase()) && !permissionIncludes(current, permission);
        }
        const teamRepositoryExisted = await this.forgejo.teamHasRepository(owner, team.forgejoTeam, repositoryName, signal);
        accessOwnership = {
          managedTeam: team.forgejoTeam,
          teamGrantAdded: !teamRepositoryExisted,
          collaboratorGrantAdded,
        };
      }
      await this.lifecycle.policyPlan(id, this.workerId, generation, { ...(previousPolicy ?? {}), access: accessOwnership });
      for (const [username, permission] of [[this.config.implementationUser, 'write'], [this.config.reviewUser, 'read'], [this.config.cloneUser, 'read']] as const) {
        if (!accessOwnership.collaboratorGrantAdded[username]) {
          const current = await this.forgejo.collaboratorPermission(owner, repositoryName, username, signal);
          if (!permissionIncludes(current, permission)) throw invalid(`Existing access for ${username} no longer grants ${permission}`);
        } else {
          await this.forgejo.ensureCollaborator(owner, repositoryName, username, permission, signal);
        }
      }
      await this.lifecycle.advance(id, this.workerId, generation, 'applying-policy');
      const currentPolicy = (await this.lifecycle.get(id))?.policyPlan;
      const recordedMainBranch = mainBranchPolicyPlan(currentPolicy?.mainBranch)?.branch;
      if (recordedMainBranch && recordedMainBranch !== repository.default_branch) {
        throw Object.assign(new Error('Default branch changed during onboarding; repair the registration before continuing'), { status: 409 });
      }
      const policyDiff = await this.forgejo.planMainBranchProtection(owner, repositoryName, repository.default_branch, signal);
      const implementationBranchProtectionCreated = await this.forgejo.branchProtectionNeedsAdding(owner, repositoryName, 'factory/requirement-*', signal);
      await this.lifecycle.policyPlan(id, this.workerId, generation, mergePolicyPlan(currentPolicy, policyDiff, implementationBranchProtectionCreated, repository.default_branch));
      await this.forgejo.ensureMainBranchProtection(owner, repositoryName, repository.default_branch, signal);
      await this.forgejo.ensureImplementationBranchProtection(owner, repositoryName, this.config.implementationUser, signal);
      await this.forgejo.ensureTeamRepository(owner, team.forgejoTeam, repositoryName, signal);
      const currentSha = await this.forgejo.getProjectBranchHead(owner, repositoryName, repository.default_branch, signal);
      if (currentSha !== repositorySha) throw Object.assign(new Error('Default branch changed during onboarding; validating the new commit'), { status: 409 });
      await this.lifecycle.advance(id, this.workerId, generation, 'creating-staging');
      const registration: SystemRegistration = {
        team: team.slug,
        repositoryOwner: owner,
        repositoryName,
      };
      this.registry.invalidate(id);
      const result = await this.registry.create(registration);
      return result.application;
    } catch (error) {
      const issues = compatibilityIssues(error);
      const repair = issues.length > 0 || isDefiniteClientError(error);
      await this.lifecycle.fail(
        id,
        this.workerId,
        generation,
        repair ? 'repair' : 'retry-wait',
        error instanceof Error ? error.message : String(error),
        issues,
        repair ? undefined : new Date(Date.now() + 30_000),
      ).catch((failure) => {
        if (failure instanceof Error && failure.message === 'System onboarding lease was lost') return;
        throw failure;
      });
      throw error;
    }
  }

  private async reconcileStagingClaimed(
    id: string,
    owner: string,
    repositoryName: string,
    team: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<ApplicationDefinition> {
    if (!this.staging) throw new Error('Staging reconciliation is not configured');
    this.registry.invalidate(id);
    const result = await this.registry.create({ team, repositoryOwner: owner, repositoryName });
    const staging = await this.staging.reconcileForOnboarding(result.application, signal);
    if (staging.phase === 'healthy' && staging.currentSha === result.application.defaultSha && staging.health === 'healthy') {
      await this.lifecycle.advance(id, this.workerId, generation, 'ready');
    } else if (staging.phase === 'failed') {
      await this.lifecycle.fail(id, this.workerId, generation, 'repair', staging.lastError ?? 'Staging reconciliation failed');
    }
    return result.application;
  }

  private async reassignClaimable(record: import('./onboarding-store').OnboardingRecord, signal?: AbortSignal): Promise<void> {
    if (!['reassigning', 'reassigning-access'].includes(record.phase) || !record.targetTeam) return;
    const target = this.config.teams.find((candidate) => candidate.slug === record.targetTeam);
    const source = this.config.teams.find((candidate) => candidate.slug === record.team);
    if (!target || !source) throw new Error('System reassignment references an unknown team');
    const leaseMs = 5 * 60_000;
    const generation = await this.lifecycle.claim(record.systemId, this.workerId, new Date(), leaseMs);
    if (generation === null) throw Object.assign(new Error('System onboarding is already in progress'), { status: 409 });
    const heartbeat = await startLeaseHeartbeat(
      () => this.lifecycle.renew(record.systemId, this.workerId, generation, new Date(), leaseMs),
      this.heartbeatMs,
      { lost: 'System onboarding lease was lost', failed: 'System onboarding lease heartbeat failed' },
    );
    const transitionSignal = signal ? AbortSignal.any([signal, heartbeat.signal]) : heartbeat.signal;
    let phase: 'reassigning' | 'reassigning-access' = record.phase as 'reassigning' | 'reassigning-access';
    try {
      const serviceUsers = [this.config.implementationUser, this.config.reviewUser, this.config.cloneUser];
      const initialAccess = isAccessOwnership(record.policyPlan?.access, serviceUsers) ? record.policyPlan.access : null;
      if (!initialAccess) throw Object.assign(new Error('System access ownership is unknown; repair the registration before reassignment'), { status: 409 });
      const targetTeamExists = await this.forgejo.scopedReadTeamExists(record.repositoryOwner, target.forgejoTeam, transitionSignal);
      const targetExisted = targetTeamExists
        && await this.forgejo.teamHasRepository(record.repositoryOwner, target.forgejoTeam, record.repositoryName, transitionSignal);
      if (phase === 'reassigning') {
        const sourceAssigned = await this.forgejo.teamHasRepository(record.repositoryOwner, source.forgejoTeam, record.repositoryName, transitionSignal);
        if (sourceAssigned && !(initialAccess.managedTeam === source.forgejoTeam && initialAccess.teamGrantAdded)) {
          throw Object.assign(new Error('Remove the pre-existing source team repository assignment before reassignment'), { status: 409 });
        }
        if (sourceAssigned) {
          await this.forgejo.assertScopedReadTeam(record.repositoryOwner, source.forgejoTeam, transitionSignal);
          await this.forgejo.removeTeamRepository(record.repositoryOwner, source.forgejoTeam, record.repositoryName, transitionSignal);
        }
        await this.lifecycle.advance(record.systemId, this.workerId, generation, 'reassigning-access', { action: 'old-access-revoked', team: record.team });
        phase = 'reassigning-access';
      }
      const currentPlan = (await this.lifecycle.get(record.systemId))?.policyPlan ?? record.policyPlan ?? {};
      const currentAccess = isAccessOwnership(currentPlan.access, [this.config.implementationUser, this.config.reviewUser, this.config.cloneUser])
        ? currentPlan.access
        : null;
      const targetAccess = {
        managedTeam: target.forgejoTeam,
        teamGrantAdded: currentAccess?.managedTeam === target.forgejoTeam ? currentAccess.teamGrantAdded : !targetExisted,
        collaboratorGrantAdded: currentAccess?.collaboratorGrantAdded ?? initialAccess.collaboratorGrantAdded,
      };
      await this.lifecycle.policyPlan(record.systemId, this.workerId, generation, { ...currentPlan, access: targetAccess });
      if (!targetExisted) await this.forgejo.ensureTeamRepository(record.repositoryOwner, target.forgejoTeam, record.repositoryName, transitionSignal);
      heartbeat.throwIfLost();
      await heartbeat.stop();
      heartbeat.throwIfLost();
      await this.lifecycle.finishReassignment(record.systemId, this.workerId, generation);
    } catch (error) {
      await heartbeat.stop();
      let failure = error;
      try {
        heartbeat.throwIfLost();
      } catch (leaseError) {
        failure = leaseError;
      }
      const ownershipConflict = typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 409;
      await this.lifecycle.fail(record.systemId, this.workerId, generation, ownershipConflict ? 'repair' : phase, failure instanceof Error ? failure.message : String(failure), [], ownershipConflict ? undefined : new Date(Date.now() + 30_000)).catch(() => undefined);
      throw failure;
    } finally {
      try {
        await heartbeat.stop();
      } finally {
        await this.lifecycle.release(record.systemId, this.workerId, generation);
      }
    }
  }

  private async revokeFactoryAccess(record: import('./onboarding-store').OnboardingRecord, signal?: AbortSignal): Promise<void> {
    const team = this.config.teams.find((candidate) => candidate.slug === record.team);
    const plan = record.policyPlan;
    if (!plan) return;
    await this.forgejo.removeFactoryImplementationBranchProtection(
      record.repositoryOwner,
      record.repositoryName,
      this.config.implementationUser,
      typeof plan.implementationBranchProtectionCreated === 'boolean' ? plan.implementationBranchProtectionCreated : undefined,
      signal,
    );
    if (isMainBranchPolicyPlan(plan.mainBranch)) {
      await this.forgejo.removeFactoryMainBranchProtection(record.repositoryOwner, record.repositoryName, plan.mainBranch.branch, plan.mainBranch, signal);
    }
    const serviceUsers = [this.config.implementationUser, this.config.reviewUser, this.config.cloneUser];
    const access = isAccessOwnership(plan.access, serviceUsers) ? plan.access : null;
    for (const username of [this.config.implementationUser, this.config.reviewUser, this.config.cloneUser]) {
      if (access?.collaboratorGrantAdded[username] === true) {
        await this.forgejo.removeCollaborator(record.repositoryOwner, record.repositoryName, username, signal);
      }
    }
    if (team && access?.managedTeam === team.forgejoTeam && access.teamGrantAdded) {
      await this.forgejo.removeTeamRepository(record.repositoryOwner, team.forgejoTeam, record.repositoryName, signal);
    }
  }

  private async readContract(owner: string, repository: string, repositorySha: string, signal?: AbortSignal): Promise<SystemContract> {
    const manifestPath = '.factory/system.yaml';
    const manifest = await this.readRequired(owner, repository, repositorySha, manifestPath, signal);
    const references = systemContractReferences(manifest);
    if (!references.valid) throw compatibilityError(references.issues);
    const sources = await Promise.all(references.paths.map(async (path) => [
      path,
      await this.readRequired(owner, repository, repositorySha, path, signal),
    ] as const));
    const result = inspectSystemContract(manifest, new Map(sources));
    if (!result.compatible) throw compatibilityError(result.issues);
    return result.contract;
  }

  private async readRequired(owner: string, repository: string, ref: string, path: string, signal?: AbortSignal): Promise<string> {
    try {
      return await this.forgejo.readProjectFile(owner, repository, ref, path, signal);
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        throw compatibilityError([{ path, code: 'missing-file', message: `${path} is required at commit ${ref}.` }]);
      }
      throw error;
    }
  }
}

function compatibilityError(issues: CompatibilityIssue[]): Error {
  return Object.assign(new Error('System repository is incompatible'), { status: 422, issues });
}

function toCandidate(repository: Repository): OnboardingRepository {
  return {
    name: repository.name,
    fullName: repository.full_name,
    description: repository.description || '',
    defaultBranch: repository.default_branch,
    repositoryUrl: repository.html_url,
  };
}

function validateRepositoryName(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) throw invalid('invalid repository name');
}

function parseRepositoryIdentity(value: string, owners: string[]): { owner: string; repositoryName: string } {
  const parts = value.split('/');
  const owner = parts.length === 2 ? parts[0]! : owners.length === 1 ? owners[0]! : '';
  const repositoryName = parts.length === 2 ? parts[1]! : value;
  if (!owner || !owners.includes(owner)) throw Object.assign(new Error('repository owner is not authorized'), { status: 403 });
  return { owner, repositoryName };
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

function compatibilityIssues(error: unknown): CompatibilityIssue[] {
  if (!error || typeof error !== 'object' || !('issues' in error) || !Array.isArray(error.issues)) return [];
  return error.issues as CompatibilityIssue[];
}

function isDefiniteClientError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409 && error.status !== 429;
}

function isMainBranchPolicyPlan(value: unknown): value is { branch: string; created: boolean; addedStatusChecks: string[] } {
  const plan = mainBranchPolicyPlan(value);
  return Boolean(plan?.branch);
}

function mainBranchPolicyPlan(value: unknown): { branch?: string; created: boolean; addedStatusChecks: string[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.created !== 'boolean' || !Array.isArray(candidate.addedStatusChecks)
    || !candidate.addedStatusChecks.every((check) => typeof check === 'string')) return null;
  return {
    created: candidate.created,
    addedStatusChecks: candidate.addedStatusChecks as string[],
    ...(typeof candidate.branch === 'string' && candidate.branch ? { branch: candidate.branch } : {}),
  };
}

function isAccessOwnership(value: unknown, usernames: string[]): value is { managedTeam: string; teamGrantAdded: boolean; collaboratorGrantAdded: Record<string, boolean> } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.managedTeam !== 'string' || !candidate.managedTeam || typeof candidate.teamGrantAdded !== 'boolean') return false;
  if (typeof candidate.collaboratorGrantAdded !== 'object' || candidate.collaboratorGrantAdded === null) return false;
  const grants = candidate.collaboratorGrantAdded as Record<string, unknown>;
  return usernames.every((username) => typeof grants[username] === 'boolean');
}

function permissionIncludes(actual: string | null, required: 'read' | 'write'): boolean {
  const rank: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3, owner: 4 };
  return (rank[actual ?? 'none'] ?? 0) >= rank[required]!;
}

function mergePolicyPlan(
  previous: Record<string, unknown> | null | undefined,
  current: { created: boolean; addedStatusChecks: string[]; preservedStatusChecks: string[] },
  implementationBranchProtectionCreated: boolean,
  branch: string,
): Record<string, unknown> {
  const mainBranch = mainBranchPolicyPlan(previous?.mainBranch);
  return {
    ...(previous?.access ? { access: previous.access } : {}),
    mainBranch: {
      ...current,
      branch: mainBranch?.branch ?? branch,
      created: current.created || mainBranch?.created === true,
      addedStatusChecks: [...new Set([...(mainBranch?.addedStatusChecks ?? []), ...current.addedStatusChecks])],
    },
    implementationBranchProtectionCreated: implementationBranchProtectionCreated
      || previous?.implementationBranchProtectionCreated === true,
  };
}

function remediationManifest(issues: CompatibilityIssue[]): string {
  const header = issues.length > 0 ? `# Reported compatibility issues: ${issues.length}\n` : '';
  return `${header}version: 1\ndevelopment:\n  devcontainer: REPLACE_ME/developer.json\nverification:\n  devcontainer: REPLACE_ME/verification.json\nruntime:\n  supervisor:\n    kind: custom\n    commands:\n      status: REPLACE_ME status\n      shutdown: REPLACE_ME stop\n  startupTimeoutSeconds: 120\napplications: []\n`;
}
