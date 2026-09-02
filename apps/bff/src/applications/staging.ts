/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { CoderClient, CoderWorkspace } from '../integrations/coder';
import type { ApplicationDefinition } from './catalog';
import type { ApplicationRegistry } from './registry';
import type { StagingStore } from './staging-store';
import type { WorkspaceStartupMetrics } from './startup-metrics';
import { UpstreamHttpError, UpstreamTimeoutError } from '../integrations/fetch';
import { startLeaseHeartbeat } from '../lease-heartbeat';

export interface StagingSnapshot {
  applicationId: string;
  repositoryRef: string;
  workspace: CoderWorkspace | null;
  reconciling: boolean;
  error: string | null;
  updatedAt: string;
  phase: import('./staging-store').StagingRecord['phase'];
  attempts: number;
}

export interface SystemStatusSummary {
  status: 'ready' | 'degraded' | 'not-ready';
  counts: { total: number; registered: number; usable: number; degraded: number };
  onboarding: { ready: number; reconciling: number; repair: number; failed: number; missing: number };
  registry: { current: number; stale: number; missing: number; loadErrors: number };
  staging: { healthy: number; stale: number; reconciling: number; failed: number; missing: number };
  degradedSystems: Array<{
    systemId: string;
    onboarding: { phase: import('./onboarding-store').OnboardingPhase | null; error: string | null; updatedAt: string };
    registry: { status: 'current' | 'stale' | 'missing'; updatedAt: string | null; error: string | null };
    staging: { status: 'healthy' | 'stale' | 'reconciling' | 'failed' | 'missing'; phase: import('./staging-store').StagingRecord['phase'] | null; updatedAt: string | null; error: string | null };
  }>;
}

export class StagingReconciler {
  private readonly instanceId = `staging_${crypto.randomUUID().replaceAll('-', '')}`;
  private readonly deletionWaitMs = 5_000;
  private readonly leaseMs = 15 * 60_000;
  private readonly heartbeatMs = 30_000;

  constructor(
    private readonly applications: Pick<ApplicationRegistry, 'list' | 'get' | 'persistedStatus'>,
    private readonly coder: CoderClient,
    private readonly store: StagingStore,
    private readonly metrics: WorkspaceStartupMetrics,
    private readonly templateName: string,
    private readonly workspaceNamespace: string,
  ) {}

  async snapshot(applicationId: string): Promise<StagingSnapshot | null> {
    const record = await this.store.get(applicationId);
    const application = record ? await this.applications.get(applicationId) : null;
    let workspace = record?.workspace ?? null;
    if (application && workspace && record?.currentSha === application.defaultSha) {
      try {
        workspace = await this.liveWorkspace(application, workspace.id);
      } catch (error) {
        if (!transientCoderRead(error)) workspace = null;
      }
    }
    return record ? {
      applicationId,
      repositoryRef: record.desiredSha,
      workspace,
      reconciling: record.phase === 'pending' || record.phase === 'provisioning',
      error: record.lastError,
      updatedAt: record.updatedAt.toISOString(),
      phase: record.phase,
      attempts: record.attempts,
    } : null;
  }

  async ready(): Promise<void> {
    const summary = await this.status();
    if (summary.status === 'not-ready') throw new Error('No registered System is usable');
  }

  async status(now = new Date(), staleAfterMs = 2 * 60_000): Promise<SystemStatusSummary> {
    const [systems, stagingRecords] = await Promise.all([
      this.applications.persistedStatus(),
      this.store.list(),
    ]);
    const stagingBySystem = new Map(stagingRecords.map((record) => [record.systemId, record]));
    const staleBefore = now.getTime() - staleAfterMs;
    const onboarding = { ready: 0, reconciling: 0, repair: 0, failed: 0, missing: 0 };
    const registry = { current: 0, stale: 0, missing: 0, loadErrors: 0 };
    const staging = { healthy: 0, stale: 0, reconciling: 0, failed: 0, missing: 0 };
    let usable = 0;
    let registered = 0;
    const degradedSystems: SystemStatusSummary['degradedSystems'] = [];

    for (const system of systems) {
      if (system.onboardingPhase === null) onboarding.missing += 1;
      else if (system.onboardingPhase === 'ready') onboarding.ready += 1;
      else if (system.onboardingPhase === 'repair') onboarding.repair += 1;
      else if (system.onboardingPhase === 'failed') onboarding.failed += 1;
      else onboarding.reconciling += 1;
      if (system.registered) registered += 1;

      const projectionStale = Boolean(system.projection) && (
        system.projectionError !== null
        || !system.projectionUpdatedAt
        || system.projectionUpdatedAt.getTime() < staleBefore
      );
      const registryStatus = !system.projection ? 'missing' : projectionStale ? 'stale' : 'current';
      registry[registryStatus] += 1;
      if (system.projectionError) registry.loadErrors += 1;

      const record = stagingBySystem.get(system.systemId);
      const stagingStale = Boolean(record) && record!.updatedAt.getTime() < staleBefore;
      const servingHealthyWorkspace = Boolean(record?.workspace?.healthy)
        && record!.workspace!.apps.every((app) => app.health === 'healthy');
      let stagingStatus: SystemStatusSummary['degradedSystems'][number]['staging']['status'];
      if (!record) stagingStatus = 'missing';
      else if (record.phase === 'failed') stagingStatus = 'failed';
      else if (stagingStale || (system.projection && (record.desiredSha !== system.projection.defaultSha || record.currentSha !== system.projection.defaultSha))) stagingStatus = 'stale';
      else if (record.phase === 'healthy' && record.health === 'healthy' && record.workspace?.healthy
        && record.workspace.apps.every((app) => app.health === 'healthy')) stagingStatus = 'healthy';
      else stagingStatus = 'reconciling';
      staging[stagingStatus] += 1;

      const systemUsable = system.registered
        && system.onboardingPhase === 'ready'
        && registryStatus === 'current'
        && servingHealthyWorkspace;
      if (systemUsable) usable += 1;
      if (!systemUsable || stagingStatus !== 'healthy') degradedSystems.push({
        systemId: system.systemId,
        onboarding: { phase: system.onboardingPhase, error: system.onboardingError, updatedAt: system.onboardingUpdatedAt.toISOString() },
        registry: {
          status: registryStatus,
          updatedAt: system.projectionUpdatedAt?.toISOString() ?? null,
          error: system.projectionError,
        },
        staging: {
          status: stagingStatus,
          phase: record?.phase ?? null,
          updatedAt: record?.updatedAt.toISOString() ?? null,
          error: record?.lastError ?? null,
        },
      });
    }

    const total = systems.length;
    return {
      status: registered > 0 && usable === 0 ? 'not-ready' : degradedSystems.length > 0 ? 'degraded' : 'ready',
      counts: { total, registered, usable, degraded: total - usable },
      onboarding,
      registry,
      staging,
      degradedSystems,
    };
  }

  async reconcileAll(signal?: AbortSignal): Promise<void> {
    const applications = await this.applications.list();
    for (let offset = 0; offset < applications.length; offset += 2) {
      await Promise.all(applications.slice(offset, offset + 2).map((application) => this.reconcile(application, signal)));
    }
  }

  async reconcileById(applicationId: string, signal?: AbortSignal): Promise<void> {
    const application = await this.applications.get(applicationId);
    if (application) await this.reconcile(application, signal);
  }

  async reconcileForOnboarding(application: ApplicationDefinition, signal?: AbortSignal): Promise<import('./staging-store').StagingRecord> {
    await this.reconcile(application, signal);
    const record = await this.store.get(application.id);
    if (!record) throw new Error(`Staging state was not persisted for ${application.id}`);
    return record;
  }

  async retryFailed(applicationId: string): Promise<void> {
    if ((await this.store.get(applicationId))?.phase === 'failed') await this.store.retry(applicationId);
  }

  async ensureReady(application: ApplicationDefinition, signal?: AbortSignal): Promise<void> {
    const applicationId = application.id;
    const current = await this.store.get(applicationId);
    if (current && ['retry-wait', 'failed'].includes(current.phase)) await this.store.retry(applicationId);
    await this.reconcile(application, signal);
    const snapshot = await this.snapshot(applicationId);
    if (!snapshot || snapshot.repositoryRef !== application.defaultSha || snapshot.error || !snapshot.workspace?.healthy
      || snapshot.workspace.apps.some((app) => app.health !== 'healthy')) {
      throw new Error(snapshot?.error ?? `Staging is not ready for ${applicationId}`);
    }
  }

  async retry(applicationId: string, signal?: AbortSignal): Promise<void> {
    await this.store.retry(applicationId);
    await this.reconcileById(applicationId, signal);
  }

  async delete(systemId: string, repositoryUrl: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.deletionWaitMs;
    let claim = await this.store.claimDeletion(systemId, this.instanceId, new Date(), this.leaseMs);
    while (claim.status === 'busy' && Date.now() < deadline) {
      await wait(50, signal);
      claim = await this.store.claimDeletion(systemId, this.instanceId, new Date(), this.leaseMs);
    }
    if (claim.status === 'busy') throw Object.assign(new Error('Staging reconciliation is still active'), { status: 409 });
    const heartbeat = claim.status === 'claimed' ? await startLeaseHeartbeat(
      () => this.store.renewDeletion(systemId, this.instanceId, claim.generation, new Date(), this.leaseMs),
      this.heartbeatMs,
      { lost: 'Staging deletion lease was lost', failed: 'Staging deletion lease heartbeat failed' },
    ) : null;
    const deletionSignal = heartbeat ? (signal ? AbortSignal.any([signal, heartbeat.signal]) : heartbeat.signal) : signal;
    try {
      await this.coder.deleteStagingWorkspace({
        repositoryUrl,
        templateName: this.templateName,
        workspaceNamespace: this.workspaceNamespace,
      }, deletionSignal);
      heartbeat?.throwIfLost();
      await heartbeat?.stop();
      heartbeat?.throwIfLost();
      if (claim.status === 'claimed' && !await this.store.finishDeletion(systemId, this.instanceId, claim.generation)) {
        throw new Error('Staging deletion lease was lost');
      }
    } catch (error) {
      await heartbeat?.stop();
      let failure = error;
      try {
        heartbeat?.throwIfLost();
      } catch (leaseError) {
        failure = leaseError;
      }
      if (claim.status === 'claimed') {
        await this.store.failDeletion(systemId, this.instanceId, claim.generation, failure instanceof Error ? failure.message : String(failure));
      }
      throw failure;
    } finally {
      await heartbeat?.stop();
    }
  }

  async reconcile(application: ApplicationDefinition, signal?: AbortSignal): Promise<void> {
    const desired = await this.store.desire(application.id, application.defaultSha);
    if (desired.phase === 'deleting') return;
    if (desired.currentSha === application.defaultSha && desired.workspace) {
      try {
        const observed = await this.liveWorkspace(application, desired.workspace.id, signal);
        if (observed.healthy && observed.apps.every((app) => app.health === 'healthy')) {
          if (desired.phase === 'healthy') {
            await this.store.observeHealthy(application.id, application.defaultSha, observed);
            return;
          }
          const generation = await this.store.claim(application.id, this.instanceId, new Date(), this.leaseMs);
          if (generation !== null) await this.store.succeed(application.id, this.instanceId, generation, application.defaultSha, observed);
          return;
        }
      } catch (error) {
        if (transientCoderRead(error)) return;
      }
      if (desired.phase === 'healthy') await this.store.retry(application.id);
    }
    const generation = await this.store.claim(application.id, this.instanceId, new Date(), this.leaseMs);
    if (generation === null) return;
    const heartbeat = await startLeaseHeartbeat(
      () => this.store.renew(application.id, this.instanceId, generation, application.defaultSha, new Date(), this.leaseMs),
      this.heartbeatMs,
      { lost: 'Staging reconciliation lease was lost', failed: 'Staging reconciliation lease heartbeat failed' },
    );
    const reconcileSignal = signal ? AbortSignal.any([signal, heartbeat.signal]) : heartbeat.signal;
    try {
      const workspace = await this.metrics.measure({
        systemId: application.id, kind: 'staging', sha: application.defaultSha, contractVersion: 1,
        cacheKey: `v1:${application.defaultSha}`,
      }, () => this.coder.ensureStagingWorkspace({
        repositoryUrl: application.cloneUrl,
        repositoryRef: application.defaultSha,
        templateName: this.templateName,
        workspaceNamespace: this.workspaceNamespace,
      }, reconcileSignal));
      heartbeat.throwIfLost();
      await heartbeat.stop();
      heartbeat.throwIfLost();
      if (!await this.store.succeed(application.id, this.instanceId, generation, application.defaultSha, workspace)) {
        throw new Error('Staging reconciliation lease was lost');
      }
    } catch (error) {
      await heartbeat.stop();
      let failure = error;
      try {
        heartbeat.throwIfLost();
      } catch (leaseError) {
        failure = leaseError;
      }
      await this.store.fail(application.id, this.instanceId, generation, application.defaultSha, failure instanceof Error ? failure.message : 'Staging reconciliation failed');
      if (heartbeat.signal.aborted || (failure instanceof Error && failure.message === 'Staging reconciliation lease was lost')) throw failure;
    } finally {
      await heartbeat.stop();
    }
  }

  private liveWorkspace(application: ApplicationDefinition, workspaceId: string, signal?: AbortSignal): Promise<CoderWorkspace> {
    return this.coder.stagingWorkspaceById(workspaceId, {
      repositoryUrl: application.cloneUrl,
      repositoryRef: application.defaultSha,
      templateName: this.templateName,
      workspaceNamespace: this.workspaceNamespace,
    }, signal);
  }
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
    }, { once: true });
  });
}

function transientCoderRead(error: unknown): boolean {
  return error instanceof UpstreamTimeoutError
    || error instanceof TypeError
    || (error instanceof UpstreamHttpError && error.service === 'Coder' && error.status >= 500);
}
