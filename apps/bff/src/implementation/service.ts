/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { implementationRunSchema } from '@agentic-software-factory/api-contracts/implementation';
import { coderAppUrl, type ApplicationDefinition } from '../applications/catalog';
import type { ApplicationRegistry } from '../applications/registry';
import type { WorkspaceStartupMetrics } from '../applications/startup-metrics';
import { toCard, visibleIssueBody, type CommitStatus, type ForgejoClient, type PullRequest, type PullReview } from '../forgejo/client';
import type { CoderClient, CoderUserIdentity, CoderWorkspace } from '../integrations/coder';
import { UpstreamHttpError, isUpstreamStatus } from '../integrations/fetch';
import { startLeaseHeartbeat } from '../lease-heartbeat';
import type { Identity } from '../server/types';
import { ImplementationStore, type DeliveryRecord, type OperationRecord } from './store';
import {
  parseVerificationDescription,
  parsePullMarker,
  parseReviewMarker,
  verificationDescription,
  pullMarker,
  reviewMarker,
  type DeliveryPullMarker,
  type DeliveryVerificationMarker,
  type DeliveryReviewMarker,
} from './markers';

const REQUIRED_CHECKS = ['factory/specification', 'factory/verification'] as const;
const CHAT_OPERATION = 'coder-chat-create';

type ImplementationPhase = 'unplanned' | 'provisioning' | 'agent-running' | 'agent-failed' | 'implementing' | 'checks-failing' | 'awaiting-review' | 'changes-requested' | 'ready-to-merge' | 'merging' | 'done';
interface ImplementationCheck { context: string; state: 'pending' | 'success' | 'failure' | 'error' | 'warning'; description: string; targetUrl: string | null }
interface ImplementationReview { id: number; state: 'approved' | 'changes-requested' | 'commented'; body: string; reviewer: string; commitSha: string; submittedAt: string }
interface ImplementationApp { slug: string; displayName: string; url: string; health: 'healthy' | 'initializing' | 'unhealthy' | 'disabled' }

export interface ImplementationRun {
  id: string; requirementNumber: number; applicationId: string; applicationName: string; acceptedDigest: string;
  repository: string; repositoryUrl: string; branch: string; pullNumber: number; pullUrl: string; headSha: string;
  mergedSha: string | null; phase: ImplementationPhase; checks: ImplementationCheck[]; reviews: ImplementationReview[];
  agentStatus: 'not-started' | 'running' | 'completed' | 'failed'; agentError: string | null; agentStartedHeadSha: string | null;
  blockers: string[]; nextAction: string; workspaceUrl: string | null; agentUrl: string | null; ideUrl: string | null;
  workspaceId?: string | null; workspaceStatus?: string | null;
  developmentApps: ImplementationApp[]; verificationApps: ImplementationApp[];
  isContributor: boolean; canContinueBranch: boolean; createdAt: string; updatedAt: string; completedAt: string | null;
}

interface DeliveryContext {
  record: DeliveryRecord;
  application: ApplicationDefinition;
  branch: string;
  pull: PullRequest;
  marker: DeliveryPullMarker;
}

interface AgentProjection {
  status: ImplementationRun['agentStatus'];
  error: string | null;
  startedHeadSha: string | null;
  chatId: string | null;
  workspaceId: string | null;
  active: boolean;
}

export class ImplementationService {
  private readonly instanceId = `bff_${crypto.randomUUID().replaceAll('-', '')}`;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly reviewActor: string;
  private readonly coderPublicUrl: string;
  private readonly coderTemplate: string;
  private readonly workspaceNamespace: string;
  private readonly onMerged?: (applicationId: string) => Promise<void>;
  private readonly startupMetrics?: WorkspaceStartupMetrics;
  private readonly onOperationReserved?: () => void;

  constructor(
    private readonly store: ImplementationStore,
    private readonly forgejo: ForgejoClient,
    private readonly projectForgejo: ForgejoClient,
    private readonly coder: CoderClient,
    private readonly publicForgejoUrl: string,
    private readonly implementationUser: string,
    private readonly applications: Pick<ApplicationRegistry, 'list' | 'get'> & Partial<Pick<ApplicationRegistry, 'withLock'>>,
    options: {
      leaseMs?: number;
      heartbeatMs?: number;
      reviewActor?: string;
      coderPublicUrl?: string;
      coderTemplate?: string;
      workspaceNamespace?: string;
      onMerged?: (applicationId: string) => Promise<void>;
      startupMetrics?: WorkspaceStartupMetrics;
      onOperationReserved?: () => void;
    } = {},
  ) {
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    this.heartbeatMs = options.heartbeatMs ?? 60_000;
    this.reviewActor = options.reviewActor ?? '';
    this.coderPublicUrl = options.coderPublicUrl ?? '';
    this.coderTemplate = options.coderTemplate ?? 'agentic-software-factory';
    this.workspaceNamespace = options.workspaceNamespace ?? '';
    this.onMerged = options.onMerged;
    this.startupMetrics = options.startupMetrics;
    this.onOperationReserved = options.onOperationReserved;
  }

  async start(number: number, applicationId: string, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    const action = () => this.startLocked(number, applicationId, identity, signal);
    return this.applications.withLock ? this.applications.withLock(applicationId, action) : action();
  }

  private async startLocked(number: number, applicationId: string, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    const application = await this.applications.get(applicationId);
    if (!application) throw Object.assign(new Error('application not found'), { status: 404 });
    const requirements = this.forgejo.forRepository(application.repositoryOwner, application.repositoryName);
    const issue = await requirements.getIssue(number, signal);
    const card = toCard(issue);
    if (!card?.acceptance) throw conflict('accepted specification is required');
    const acceptance = await requirements.verifyAcceptance(issue, card.acceptance, signal);
    const id = await deliveryId(this.store.tenantId, application.id, number, acceptance.digest);
    const reservation = await this.store.reserveDelivery({
      id,
      requirementNumber: number,
      systemId: application.id,
      acceptedDigest: acceptance.digest,
      createdByUserId: identity.subject,
    });
    const wasContributor = await this.store.isContributor(id, identity.subject);
    let context = await this.ensureInitialDelivery(
      reservation.delivery, application, issue, acceptance.requirementId, acceptance.specification, signal,
    );
    if (!reservation.created && !wasContributor) {
      if (context.pull.merged || context.pull.state !== 'open') throw conflict('the implementation branch can no longer be continued');
      if (await this.deliveryHasActiveAgent(id, signal)) throw conflict('wait for the active implementation agent before continuing the branch');
    }
    await this.store.addContributor(id, identity.subject);
    if (!identity.username) throw new Error('Coder delegation requires email and username claims');
    await this.forgejo.ensureImplementationContributorAccess(
      context.application.repositoryOwner,
      context.application.repositoryName,
      context.branch,
      this.implementationUser,
      identity.username,
      signal,
    );
    const current = await this.store.activeOperation(id, CHAT_OPERATION);
    if (current?.state === 'succeeded' && current.externalId) {
      const agent = await this.agentForOperation(current, context.pull.head.sha, current.factoryUserId === identity.subject ? identity : undefined, signal);
      if (agent.active) return this.project(context, identity, signal);
      await this.store.retireOperation(current.idempotencyKey, agent.error ?? 'Explicit implementation restart.');
    } else if (current && ['pending', 'running', 'ambiguous'].includes(current.state)) {
      return this.project(await this.loadContext(reservation.delivery, signal), identity, signal);
    }
    if (!reservation.created) context = (await this.synchronize(context, signal)).context;
    const operation = await this.store.reserveOperation(id, identity.subject, CHAT_OPERATION);
    if (operation.factoryUserId !== identity.subject) return this.project(await this.loadContext(reservation.delivery, signal), identity, signal);
    await this.store.touchDelivery(id);
    this.onOperationReserved?.();
    return this.project(await this.loadContext(reservation.delivery, signal), identity, signal);
  }

  async list(number: number, identity: Identity, signal?: AbortSignal, systemId?: string): Promise<ImplementationRun[]> {
    const records = await this.store.list(number, systemId);
    const result = await Promise.all(records.map(async (record) => {
      try {
        return await this.project(await this.loadContext(record, signal), identity, signal);
      } catch {
        return null;
      }
    }));
    return result.filter((item): item is ImplementationRun => item !== null);
  }

  async summaries(numbers: number[], identity: Identity, signal?: AbortSignal, systemId?: string): Promise<Map<number, ImplementationRun>> {
    const result = new Map<number, ImplementationRun>();
    await Promise.all(numbers.map(async (number) => {
      const records = await this.store.list(number, systemId);
      const current = records[0];
      if (!current) return;
      try {
        result.set(number, await this.project(await this.loadContext(current, signal), identity, signal));
      } catch {
        // A deleted external delivery must not hide other board cards.
      }
    }));
    return result;
  }

  async requirementScope(id: string): Promise<{ requirementNumber: number; systemId: string }> {
    const record = await this.store.get(id);
    return { requirementNumber: record.requirementNumber, systemId: record.systemId };
  }

  async retryVerification(id: string): Promise<void> {
    await this.store.resetVerification(id);
  }

  async retryCompletion(id: string): Promise<void> {
    await this.store.resetCompletion(id);
  }

  async stopWorkspace(id: string, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    return this.changeWorkspaceState(id, identity, false, signal);
  }

  async resumeWorkspace(id: string, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    return this.changeWorkspaceState(id, identity, true, signal);
  }

  async prepareVerification(id: string, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    const record = await this.store.get(id);
    await this.store.desireVerification({
      deliveryId: id,
      requestedByUserId: identity.subject,
      desiredHeadSha: '',
      desiredDefaultSha: '',
    });
    const generation = await this.store.claimVerification(id, this.instanceId);
    if (generation === null) throw conflict('verification environment is already being prepared');
    let claimedHeadSha = '';
    try {
      let context = await this.loadContext(record, signal);
      if (context.pull.state !== 'open' || context.pull.merged) throw conflict('verification environment is unavailable');
      if (await this.deliveryHasActiveAgent(id, signal)) throw conflict('wait for the active implementation agent before preparing verification');
      const synchronized = await this.synchronize(context, signal);
      context = synchronized.context;
      const synchronizedHeadSha = context.pull.head.sha;
      if (!await this.store.retargetVerification(id, this.instanceId, generation, identity.subject, synchronizedHeadSha, synchronized.defaultSha)) {
        throw new Error('Delivery verification lease was lost');
      }
      claimedHeadSha = synchronizedHeadSha;
      await this.cleanupStaleVerificationWorkspaces(context, claimedHeadSha, signal);
      await this.ensureSpecificationCheck(context, claimedHeadSha, signal);
      const createVerificationWorkspace = () => this.coder.ensureVerificationWorkspaceFor(coderIdentity(identity), {
        repositoryUrl: context.application.cloneUrl,
        branch: context.branch,
        headSha: claimedHeadSha,
        pullNumber: context.pull.number,
        templateName: this.coderTemplate,
        workspaceNamespace: this.workspaceNamespace,
      }, signal);
      const workspace = this.startupMetrics
        ? await this.startupMetrics.measure({ systemId: context.application.id, kind: 'verification', sha: claimedHeadSha, contractVersion: 1, cacheKey: `v1:${claimedHeadSha}` }, createVerificationWorkspace)
        : await createVerificationWorkspace();
      const marker: DeliveryVerificationMarker = { version: 1, deliveryId: id, headSha: claimedHeadSha, defaultSha: synchronized.defaultSha, workspaceId: workspace.id };
      const healthy = workspace.healthy && workspace.apps.every((app) => app.health === 'healthy');
      await this.forgejo.createCommitStatus(
        context.application.repositoryOwner,
        context.application.repositoryName,
        claimedHeadSha,
        healthy ? 'success' : 'pending',
        'factory/verification',
        verificationDescription(marker, healthy ? 'Exact-SHA verification environment is healthy.' : 'Exact-SHA verification environment is starting.'),
        this.coderUrl(workspace.apps[0]?.url ?? workspace.url) ?? '',
        signal,
      );
      if (!await this.store.completeVerification(id, this.instanceId, generation, claimedHeadSha, workspace.id)) {
        throw new Error('Delivery verification lease was lost');
      }
      return this.project(context, identity, signal, undefined, workspace);
    } catch (error) {
      await this.store.retryVerification(id, this.instanceId, generation, claimedHeadSha, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async reconcileVerification(verification: import('./store').DeliveryVerificationRecord, identity: Identity, signal?: AbortSignal): Promise<void> {
    const observed = await this.loadContext(await this.store.get(verification.deliveryId), signal);
    if (observed.pull.merged || observed.pull.state !== 'open') return;
    if (verification.phase === 'healthy' && observed.pull.head.sha === verification.desiredHeadSha && !observed.pull.merged) return;
    const generation = await this.store.claimVerification(verification.deliveryId, this.instanceId);
    if (generation === null) return;
    let headSha = verification.desiredHeadSha;
    try {
      let context = observed;
      if (context.pull.state !== 'open' || context.pull.merged) {
        await this.store.retryVerification(verification.deliveryId, this.instanceId, generation, headSha, 'Verification environment is no longer active');
        return;
      }
      if (await this.deliveryHasActiveAgent(verification.deliveryId, signal)) {
        await this.store.retryVerification(verification.deliveryId, this.instanceId, generation, headSha, 'Waiting for the active implementation agent');
        return;
      }
      const synchronized = await this.synchronize(context, signal);
      context = synchronized.context;
      headSha = context.pull.head.sha;
      if (headSha !== verification.desiredHeadSha || synchronized.defaultSha !== verification.desiredDefaultSha) {
        if (!await this.store.retargetVerification(verification.deliveryId, this.instanceId, generation, verification.requestedByUserId, headSha, synchronized.defaultSha)) {
          throw new Error('Delivery verification lease was lost');
        }
      }
      await this.cleanupStaleVerificationWorkspaces(context, headSha, signal);
      await this.ensureSpecificationCheck(context, headSha, signal);
      const createVerificationWorkspace = () => this.coder.ensureVerificationWorkspaceFor(coderIdentity(identity), {
        repositoryUrl: context.application.cloneUrl, branch: context.branch, headSha, pullNumber: context.pull.number,
        templateName: this.coderTemplate, workspaceNamespace: this.workspaceNamespace,
      }, signal);
      const workspace = this.startupMetrics
        ? await this.startupMetrics.measure({ systemId: context.application.id, kind: 'verification', sha: headSha, contractVersion: 1, cacheKey: `v1:${headSha}` }, createVerificationWorkspace)
        : await createVerificationWorkspace();
      const marker: DeliveryVerificationMarker = { version: 1, deliveryId: verification.deliveryId, headSha, defaultSha: synchronized.defaultSha, workspaceId: workspace.id };
      const healthy = workspace.healthy && workspace.apps.every((app) => app.health === 'healthy');
      await this.forgejo.createCommitStatus(
        context.application.repositoryOwner, context.application.repositoryName, headSha, healthy ? 'success' : 'pending', 'factory/verification',
        verificationDescription(marker, healthy ? 'Exact-SHA verification environment is healthy.' : 'Exact-SHA verification environment is starting.'),
        this.coderUrl(workspace.apps[0]?.url ?? workspace.url) ?? '', signal,
      );
      if (healthy) await this.store.completeVerification(verification.deliveryId, this.instanceId, generation, headSha, workspace.id);
      else await this.store.retryVerification(verification.deliveryId, this.instanceId, generation, headSha, 'Verification environment is still starting');
    } catch (error) {
      await this.store.retryVerification(verification.deliveryId, this.instanceId, generation, headSha, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async review(id: string, identity: Identity, decision: 'approve' | 'request-changes', body: string, signal?: AbortSignal): Promise<ImplementationRun> {
    if (await this.store.isContributor(id, identity.subject)) {
      throw Object.assign(new Error('implementation contributors cannot review their delivery'), { status: 403 });
    }
    const context = await this.loadContext(await this.store.get(id), signal);
    if (await this.deliveryHasActiveAgent(id, signal)) throw conflict('wait for the active implementation agent before reviewing');
    const prepared = await this.verificationWorkspace(context, identity, true, signal);
    if (!prepared) throw conflict('prepare and inspect the SHA-pinned verification environment first');
    const text = body || (decision === 'approve' ? 'Approved in Agentic Software Factory.' : 'Changes requested in Agentic Software Factory.');
    const marker: DeliveryReviewMarker = {
      ...prepared.marker,
      version: 2,
      reviewerIssuer: identity.issuer,
      reviewerSubject: identity.subject,
    };
    const markedBody = `${text}\n\n${reviewMarker(marker)}\n\nReviewed in Agentic Software Factory by ${reviewerName(identity)} (${identity.issuer}#${identity.subject}).`;
    const reviews = await this.forgejo.listPullReviews(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal);
    const pending = reviews.findLast((item) => item.state === 'PENDING' && item.commit_id === context.pull.head.sha);
    if (pending) {
      await this.forgejo.submitPullReview(
        context.application.repositoryOwner, context.application.repositoryName, context.pull.number, pending.id,
        decision === 'approve' ? 'APPROVED' : 'REQUEST_CHANGES', markedBody, signal,
      );
    } else {
      await this.forgejo.createPullReview(
        context.application.repositoryOwner, context.application.repositoryName, context.pull.number, context.pull.head.sha,
        decision === 'approve' ? 'APPROVED' : 'REQUEST_CHANGES', markedBody, signal,
      );
    }
    return this.project(context, identity, signal, undefined, prepared.workspace);
  }

  async complete(id: string, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    const initial = await this.store.get(id);
    const action = () => this.completeLocked(initial, identity, signal);
    const application = await this.applicationFor(initial);
    return this.applications.withLock && application
      ? this.applications.withLock(application.id, action)
      : action();
  }

  private async completeLocked(record: DeliveryRecord, identity: Identity, signal?: AbortSignal): Promise<ImplementationRun> {
    if (await this.store.isContributor(record.id, identity.subject)) {
      throw Object.assign(new Error('implementation contributors cannot merge their delivery'), { status: 403 });
    }
    let context = await this.loadContext(record, signal);
    if (context.pull.merged) {
      const existing = await this.store.completion(record.id);
      if (!existing) await this.store.reserveCompletion({
        deliveryId: record.id,
        reviewedHeadSha: context.pull.head.sha,
        reviewedDefaultSha: context.pull.base.sha,
        verificationWorkspaceId: '',
      });
      return this.project(await this.loadContext(await this.store.get(record.id), signal), identity, signal);
    }
    const verification = await this.verificationWorkspace(context, identity, false, signal);
    const projection = await this.project(context, identity, signal, undefined, verification?.workspace);
    if (projection.phase !== 'ready-to-merge' || projection.blockers.length > 0 || !verification) {
      throw conflict(projection.blockers[0] ?? 'delivery is not ready to complete');
    }
    const approvals = await this.forgejo.listPullReviews(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal);
    const approval = currentReviewEvidence(approvals, context, verification.marker, this.reviewActor);
    if (!approval || await this.store.isContributor(record.id, approval.reviewerSubject)) {
      throw conflict('the current approval is not independent from implementation contributors');
    }
    const [pull, defaultSha] = await Promise.all([
      this.forgejo.getPullRequest(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal),
      this.projectForgejo.getProjectBranchHead(context.application.repositoryOwner, context.application.repositoryName, context.application.defaultBranch, signal),
    ]);
    if (pull.state !== 'open' || pull.merged || pull.head.sha !== context.pull.head.sha) throw conflict('pull request changed before merge');
    if (defaultSha !== verification.marker.defaultSha || pull.base.sha !== verification.marker.defaultSha) throw conflict('default branch advanced before merge');
    await this.store.reserveCompletion({
      deliveryId: record.id,
      reviewedHeadSha: pull.head.sha,
      reviewedDefaultSha: verification.marker.defaultSha,
      verificationWorkspaceId: verification.marker.workspaceId,
    });
    return this.project(await this.loadContext(await this.store.get(record.id), signal), identity, signal);
  }

  async reconcileCompletion(completion: import('./store').DeliveryCompletionRecord, signal?: AbortSignal): Promise<void> {
    if (completion.phase === 'complete') return;
    const generation = await this.store.claimCompletion(completion.deliveryId, this.instanceId);
    if (generation === null) return;
    const heartbeat = startLeaseHeartbeat(
      () => this.store.renewCompletion(completion.deliveryId, this.instanceId, generation),
      Math.min(this.heartbeatMs, 30_000),
      { lost: 'Delivery completion lease was lost', failed: 'Delivery completion lease heartbeat failed' },
    );
    const completionSignal = signal ? AbortSignal.any([signal, heartbeat.signal]) : heartbeat.signal;
    try {
      const record = await this.store.get(completion.deliveryId);
      const context = await this.loadContext(record, completionSignal);
      if (!context.pull.merged) {
        await heartbeat.renewNow();
        heartbeat.throwIfLost();
        await this.forgejo.mergePullRequest(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, completion.reviewedHeadSha, completionSignal);
      }
      heartbeat.throwIfLost();
      const merged = context.pull.merged ? context : await this.loadContext(record, completionSignal);
      if (!merged.pull.merged) throw new Error('Forgejo did not report the pull request as merged');
      if (!await this.store.advanceCompletion(record.id, this.instanceId, generation, 'cleanup-pending', { mergedSha: merged.pull.merged_commit_id ?? merged.pull.base.sha })) throw new Error('Delivery completion lease was lost');
      await this.onMerged?.(merged.application.id);
      await this.finish(merged, completionSignal, async () => {
        if (!await this.store.advanceCompletion(record.id, this.instanceId, generation, 'card-transition-pending')) throw new Error('Delivery completion lease was lost');
      });
      heartbeat.throwIfLost();
      if (!await this.store.advanceCompletion(record.id, this.instanceId, generation, 'complete')) throw new Error('Delivery completion lease was lost');
      await this.store.touchDelivery(record.id);
    } catch (error) {
      let failure = error;
      try {
        heartbeat.throwIfLost();
      } catch (leaseError) {
        failure = leaseError;
      }
      await this.store.retryCompletion(completion.deliveryId, this.instanceId, generation, failure instanceof Error ? failure.message : String(failure));
      throw failure;
    } finally {
      heartbeat.stop();
    }
  }

  async resumeOperation(operation: OperationRecord, identity: Identity, signal?: AbortSignal): Promise<void> {
    if (operation.state === 'succeeded') {
      if (!operation.externalId || operation.error === 'coder-chat-terminal') return;
      const status = await this.coder.implementationChatStatusForFactoryUser(operation.factoryUserId, operation.externalId, signal);
      if (['waiting', 'completed', 'error'].includes(status.status)) await this.store.markOperationChatTerminal(operation.idempotencyKey);
      return;
    }
    if (!['pending', 'running', 'ambiguous'].includes(operation.state)) return;
    signal?.throwIfAborted();
    const record = await this.store.get(operation.deliveryId);
    const application = await this.applicationFor(record);
    if (!application) throw new Error('application not found');
    const requirements = this.forgejo.forRepository(application.repositoryOwner, application.repositoryName);
    const issue = await requirements.getIssue(record.requirementNumber, signal);
    const card = toCard(issue);
    if (card?.acceptance?.digest !== record.acceptedDigest) throw new Error('delivery acceptance no longer matches');
    const acceptance = await requirements.verifyAcceptance(issue, card.acceptance, signal);
    const context = await this.ensureInitialDelivery(record, application, issue, acceptance.requirementId, acceptance.specification, signal);
    const handover = (await this.store.operations(record.id)).some((candidate) =>
      candidate.idempotencyKey !== operation.idempotencyKey && candidate.externalId !== null);
    await this.dispatch(context, identity, operation, acceptance.specification, issue.title, issue.body, handover, signal);
  }

  private async ensureInitialDelivery(
    record: DeliveryRecord,
    application: ApplicationDefinition,
    issue: { title: string; body: string; html_url: string },
    requirementId: string,
    specification: unknown,
    signal?: AbortSignal,
  ): Promise<DeliveryContext> {
    const branch = branchName(record);
    const existingPull = await this.projectForgejo.findPullRequestByBranch(application.repositoryOwner, application.repositoryName, branch, signal);
    if (existingPull) return this.context(record, application, branch, existingPull);
    await this.forgejo.ensureProjectRepository(application.repositoryOwner, application.repositoryName, signal);
    await this.forgejo.ensureMainBranchProtection(application.repositoryOwner, application.repositoryName, application.defaultBranch, signal);
    await this.forgejo.ensureCollaborator(application.repositoryOwner, application.repositoryName, this.implementationUser, 'write', signal);
    await this.forgejo.ensureImplementationBranchProtection(application.repositoryOwner, application.repositoryName, this.implementationUser, signal);
    await this.projectForgejo.ensureBranch(application.repositoryOwner, application.repositoryName, branch, application.defaultBranch, signal);
    const artifact = implementationArtifact(record.requirementNumber, issue.title, issue.body, specification, record.acceptedDigest);
    const artifactPath = `factory/requirements/${safePath(requirementId || String(record.requirementNumber))}-${record.id.slice(-12)}.md`;
    const artifactSha256 = await sha256(artifact);
    let headSha = await this.projectForgejo.getProjectBranchHead(application.repositoryOwner, application.repositoryName, branch, signal);
    const defaultSha = await this.projectForgejo.getProjectBranchHead(application.repositoryOwner, application.repositoryName, application.defaultBranch, signal);
    if (headSha === defaultSha) {
      try {
        headSha = await this.projectForgejo.writeProjectFile(
          application.repositoryOwner, application.repositoryName, branch, artifactPath, artifact,
          `start requirement #${record.requirementNumber}`, signal,
        );
      } catch (error) {
        const recovered = await this.projectForgejo.getProjectBranchHead(application.repositoryOwner, application.repositoryName, branch, signal);
        const bytes = await this.projectForgejo.readProjectFileBytes(application.repositoryOwner, application.repositoryName, recovered, artifactPath, signal).catch(() => null);
        if (!bytes || await sha256(bytes) !== artifactSha256) throw error;
        headSha = recovered;
      }
    } else {
      const bytes = await this.projectForgejo.readProjectFileBytes(application.repositoryOwner, application.repositoryName, headSha, artifactPath, signal).catch(() => null);
      if (!bytes || await sha256(bytes) !== artifactSha256) throw conflict('existing implementation branch has an unexpected origin');
    }
    const marker: DeliveryPullMarker = {
      version: 1,
      deliveryId: record.id,
      tenantId: record.tenantId,
      systemId: application.id,
      requirementNumber: record.requirementNumber,
      acceptedDigest: record.acceptedDigest,
      artifactPath,
      artifactSha256,
    };
    let pull: PullRequest;
    try {
      pull = await this.projectForgejo.createPullRequest(
        application.repositoryOwner,
        application.repositoryName,
        `Requirement #${record.requirementNumber}: ${issue.title}`,
        `Implements ${issue.html_url}\n\nAccepted requirement: \`${record.acceptedDigest}\`\n\n${pullMarker(marker)}`,
        branch,
        application.defaultBranch,
        signal,
      );
    } catch (error) {
      const recovered = await this.projectForgejo.findPullRequestByBranch(application.repositoryOwner, application.repositoryName, branch, signal);
      if (!recovered) throw error;
      pull = recovered;
    }
    if (pull.head.sha !== headSha) throw conflict('implementation branch moved while the pull request was being created');
    const context = this.context(record, application, branch, pull);
    await Promise.all([
      this.forgejo.createCommitStatus(application.repositoryOwner, application.repositoryName, headSha, 'success', 'factory/specification', 'Accepted requirement artifact matches this delivery.', issue.html_url, signal),
      this.forgejo.createCommitStatus(application.repositoryOwner, application.repositoryName, headSha, 'pending', 'factory/verification', 'Exact-SHA verification environment has not been prepared.', '', signal),
    ]);
    return context;
  }

  private async loadContext(record: DeliveryRecord, signal?: AbortSignal): Promise<DeliveryContext> {
    const application = await this.applicationFor(record);
    if (!application) throw Object.assign(new Error('application not found'), { status: 404 });
    const branch = branchName(record);
    const pull = await this.projectForgejo.findPullRequestByBranch(application.repositoryOwner, application.repositoryName, branch, signal);
    if (!pull) throw conflict('delivery pull request was not found');
    return this.context(record, application, branch, pull);
  }

  private context(record: DeliveryRecord, application: ApplicationDefinition, branch: string, pull: PullRequest): DeliveryContext {
    const marker = parsePullMarker(pull.body);
    if (!marker || marker.deliveryId !== record.id || marker.tenantId !== record.tenantId || marker.systemId !== application.id
      || marker.requirementNumber !== record.requirementNumber || marker.acceptedDigest !== record.acceptedDigest
      || pull.head.ref !== branch || pull.base.ref !== application.defaultBranch) {
      throw conflict('delivery pull request does not match its Factory identity');
    }
    return { record, application, branch, pull, marker };
  }

  private async synchronize(context: DeliveryContext, signal?: AbortSignal): Promise<{ context: DeliveryContext; defaultSha: string }> {
    const defaultSha = await this.projectForgejo.getProjectBranchHead(
      context.application.repositoryOwner, context.application.repositoryName, context.application.defaultBranch, signal,
    );
    const synchronized = await this.projectForgejo.synchronizeProjectBranch({
      owner: context.application.repositoryOwner,
      repository: context.application.repositoryName,
      branch: context.branch,
      defaultBranch: context.application.defaultBranch,
      headSha: context.pull.head.sha,
      defaultSha,
      cloneUrl: context.application.cloneUrl,
      signal,
    });
    const pull = await this.forgejo.getPullRequest(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal);
    if (pull.head.sha !== synchronized.preparedHeadSha) throw conflict('pull request head did not match the synchronized branch');
    if (pull.base.sha !== defaultSha) throw conflict('pull request default did not match the synchronized branch');
    return { context: this.context(context.record, context.application, context.branch, pull), defaultSha };
  }

  private async dispatch(
    context: DeliveryContext,
    identity: Identity,
    operation: OperationRecord,
    specification: unknown,
    title: string,
    body: string,
    handover: boolean,
    signal?: AbortSignal,
    suppliedWorkspace?: CoderWorkspace,
  ): Promise<void> {
    if (operation.state === 'succeeded') return;
    const previousState = operation.state;
    const owner = `${this.instanceId}:${crypto.randomUUID().replaceAll('-', '')}`;
    if (!await this.store.claimOperation(operation.idempotencyKey, owner, new Date(), this.leaseMs)) return;
    const abort = new AbortController();
    let leaseError: Error | null = null;
    const heartbeat = setInterval(() => {
      void this.store.renewOperation(operation.idempotencyKey, owner, new Date(), this.leaseMs).then((renewed) => {
        if (!renewed) {
          leaseError = new Error('implementation operation lease was lost');
          abort.abort(leaseError);
        }
      }).catch(() => {
        leaseError = new Error('implementation operation lease heartbeat failed');
        abort.abort(leaseError);
      });
    }, this.heartbeatMs);
    const operationSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    let postStarted = operation.error === 'coder-post-started' || previousState === 'ambiguous';
    let workspace = suppliedWorkspace;
    try {
      const binding = chatBinding(context, operation.idempotencyKey);
      if (postStarted) {
        const reconciled = await this.coder.reconcileImplementationChatFor(coderIdentity(identity), binding, operationSignal);
        if (reconciled.status === 'found') {
          if (!await this.store.markOperationSucceeded(operation.idempotencyKey, owner, reconciled.chatId)) throw new Error('implementation operation lease was lost before completion');
          return;
        }
        const message = reconciled.status === 'duplicate'
          ? `multiple Coder chats match implementation operation ${operation.idempotencyKey}: ${reconciled.chatIds.join(', ')}`
          : 'Coder chat creation outcome is unknown; reconciliation found no matching operation';
        await this.store.markOperationAmbiguous(operation.idempotencyKey, owner, message);
        return;
      }
      workspace ??= await this.ensureIterationWorkspace(context, identity, context.pull.head.sha, operationSignal);
      await this.coder.waitForHealthyWorkspaceFor(coderIdentity(identity), workspace.id, {
        repositoryUrl: context.application.cloneUrl, branch: context.branch, headSha: context.pull.head.sha,
        contributor: identity.subject, templateName: this.coderTemplate, workspaceNamespace: this.workspaceNamespace,
      }, operationSignal);
      const chat = await this.coder.startImplementationChatFor(coderIdentity(identity), {
        requirementNumber: context.record.requirementNumber,
        requirementTitle: title,
        requirementBody: visibleIssueBody(body),
        acceptedDigest: context.record.acceptedDigest,
        acceptedSpecification: specification,
        workspaceId: workspace.id,
        repository: context.application.id,
        branch: context.branch,
        pullUrl: this.forgejoDestination(`/${context.application.repositoryOwner}/${context.application.repositoryName}/pulls/${context.pull.number}`),
        tenantId: context.record.tenantId,
        systemId: context.application.id,
        deliveryId: context.record.id,
        operationId: operation.idempotencyKey,
        startedHeadSha: context.pull.head.sha,
        ...(handover ? { instruction: 'Continue the existing shared branch from its current head. Preserve valid work from every contributor and complete only the remaining work.' } : {}),
        onCreateStart: async () => {
          if (!await this.store.markOperationPostStarted(operation.idempotencyKey, owner)) {
            throw new Error('implementation operation lease was lost before Coder dispatch');
          }
          postStarted = true;
        },
      }, operationSignal);
      if (!await this.store.markOperationSucceeded(operation.idempotencyKey, owner, chat.chatId)) throw new Error('implementation operation lease was lost before completion');
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      let failure = error;
      if (!postStarted && workspace) {
        try {
          await this.coder.deleteIterationWorkspace({
            repositoryUrl: context.application.cloneUrl,
            branch: context.branch,
            headSha: context.pull.head.sha,
            factoryUserId: operation.factoryUserId,
          }, operationSignal);
        } catch (cleanupError) {
          failure = new AggregateError([error, cleanupError], 'implementation dispatch failed and workspace cleanup failed');
        }
      }
      const message = failure instanceof Error ? failure.message : String(failure);
      if (postStarted && isAmbiguousCreateError(error)) await this.store.markOperationAmbiguous(operation.idempotencyKey, owner, message);
      else await this.store.markOperationFailed(operation.idempotencyKey, owner, message);
      if (leaseError) throw leaseError;
      throw failure;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async project(
    context: DeliveryContext,
    identity: Identity,
    signal?: AbortSignal,
    suppliedWorkspace?: CoderWorkspace,
    suppliedVerificationWorkspace?: CoderWorkspace,
  ): Promise<ImplementationRun> {
    const [operations, statuses, rawReviews, contributor, defaultSha, completion, verificationState] = await Promise.all([
      this.store.operations(context.record.id),
      this.forgejo.listCommitStatuses(context.application.repositoryOwner, context.application.repositoryName, context.pull.head.sha, signal),
      this.forgejo.listPullReviews(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal),
      this.store.contributor(context.record.id, identity.subject),
      this.projectForgejo.getProjectBranchHead(context.application.repositoryOwner, context.application.repositoryName, context.application.defaultBranch, signal),
      this.store.completion(context.record.id),
      this.store.verification(context.record.id),
    ]);
    const selectedOperation = contributor
      ? operations.filter((item) => item.factoryUserId === identity.subject).at(-1)
      : operations.at(-1);
    const agent = selectedOperation
      ? await this.agentForOperation(selectedOperation, context.pull.head.sha, selectedOperation.factoryUserId === identity.subject ? identity : undefined, signal)
      : emptyAgent();
    let workspace = suppliedWorkspace;
    if (contributor && !context.pull.merged && !workspace) {
      const summary = await this.coder.summaryForIdentity(coderIdentity(identity), signal).catch(() => ({ workspaces: [] }));
      workspace = summary.workspaces.find((item) => item.parameters.repository_url === context.application.cloneUrl
        && item.parameters.repository_ref === context.pull.head.sha && item.parameters.workspace_kind === 'developer');
    }
    if (workspace && (workspace.parameters.repository_url !== context.application.cloneUrl
      || workspace.parameters.repository_ref !== context.pull.head.sha
      || workspace.parameters.workspace_kind !== 'developer')) workspace = undefined;
    if (contributor && agent.status === 'completed' && !workspace && !context.pull.merged) {
      workspace = await this.ensureIterationWorkspace(context, identity, context.pull.head.sha, signal).catch(() => undefined);
    }
    const verificationStatus = currentVerificationStatus(statuses, context.record.id, context.pull.head.sha);
    const verificationBinding = verificationStatus ? parseVerificationDescription(verificationStatus.description) : null;
    let verificationWorkspace = suppliedVerificationWorkspace;
    if (!verificationWorkspace && verificationBinding) verificationWorkspace = await this.coder.verificationWorkspaceById(verificationBinding.workspaceId, {
      repositoryUrl: context.application.cloneUrl,
      headSha: context.pull.head.sha,
      templateName: this.coderTemplate,
      workspaceNamespace: this.workspaceNamespace,
    }, signal).catch(() => undefined);
    if (verificationWorkspace?.parameters.repository_ref !== context.pull.head.sha || verificationWorkspace.parameters.workspace_kind !== 'verification') verificationWorkspace = undefined;
    const checks = checksFor(statuses, context, verificationBinding).map((check) => check.context === 'factory/verification' && check.targetUrl
      ? { ...check, targetUrl: this.coderUrl(check.targetUrl) }
      : check);
    const reviews = rawReviews.map(projectReview);
    const currentDecision = currentReviewDecision(rawReviews, context, verificationBinding, this.reviewActor);
    const completed = context.pull.merged && (!completion || completion.phase === 'complete');
    const active = await this.deliveryHasActiveAgent(context.record.id, signal, operations);
    const projectedAgent = active && !agent.active ? { ...agent, status: 'running' as const, error: null, active: true } : agent;
    const verificationTargetChanged = verificationState?.phase === 'healthy'
      && (verificationState.desiredHeadSha !== context.pull.head.sha || verificationState.desiredDefaultSha !== defaultSha);
    const verificationNeeded = verificationTargetChanged || (!verificationState && agent.status === 'completed');
    if (!active && verificationNeeded && context.pull.state === 'open' && !context.pull.merged) {
      await this.store.desireVerification({
        deliveryId: context.record.id,
        requestedByUserId: verificationState?.requestedByUserId ?? context.record.createdByUserId,
        desiredHeadSha: context.pull.head.sha,
        desiredDefaultSha: defaultSha,
      });
    }
    const blockers = blockersFor(context, projectedAgent, checks, currentDecision, verificationWorkspace, verificationBinding, defaultSha);
    if (completion?.phase === 'repair') blockers.push(`Completion requires manual retry: ${completion.lastError ?? 'unknown error'}`);
    if (!completed && verificationState?.phase === 'repair') blockers.push(`Verification environment requires manual retry: ${verificationState.lastError ?? 'unknown error'}`);
    const phase = completion && completion.phase !== 'complete'
      ? 'merging'
      : context.pull.merged && !completed
        ? 'merging'
        : phaseFor(context, projectedAgent, checks, currentDecision, verificationWorkspace);
    const developmentVisible = !completed && contributor !== null;
    const run: ImplementationRun = {
      id: context.record.id,
      requirementNumber: context.record.requirementNumber,
      applicationId: context.application.id,
      applicationName: context.application.name,
      acceptedDigest: context.record.acceptedDigest,
      repository: context.application.id,
      repositoryUrl: this.forgejoDestination(`/${context.application.repositoryOwner}/${context.application.repositoryName}`),
      branch: context.branch,
      pullNumber: context.pull.number,
      pullUrl: this.forgejoDestination(new URL(context.pull.html_url).pathname),
      headSha: context.pull.head.sha,
      mergedSha: context.pull.merged ? context.pull.merged_commit_id ?? context.pull.base.sha : null,
      phase,
      agentStatus: projectedAgent.status,
      agentError: projectedAgent.error,
      agentStartedHeadSha: projectedAgent.startedHeadSha,
      checks,
      reviews,
      blockers,
      nextAction: nextActionFor(phase),
      workspaceUrl: developmentVisible ? workspace?.url ?? null : null,
      workspaceId: developmentVisible ? workspace?.id ?? null : null,
      workspaceStatus: developmentVisible ? workspace?.status ?? null : null,
      agentUrl: developmentVisible ? this.coderUrl(projectedAgent.chatId ? this.coder.chatUrl(projectedAgent.chatId) : workspace?.chatUrl) : null,
      ideUrl: developmentVisible ? this.coderUrl(workspace?.ideUrl) : null,
      developmentApps: developmentVisible ? this.coderApps(workspace) : [],
      verificationApps: completed ? [] : this.coderApps(verificationWorkspace),
      isContributor: contributor !== null,
      canContinueBranch: contributor === null && !active && context.pull.state === 'open' && !context.pull.merged,
      createdAt: context.record.createdAt.toISOString(),
      updatedAt: context.record.updatedAt.toISOString(),
      completedAt: completion?.completedAt?.toISOString() ?? (completed ? context.record.updatedAt.toISOString() : null),
    };
    return process.env.NODE_ENV === 'production' ? run : implementationRunSchema.parse(run);
  }

  private async verificationWorkspace(context: DeliveryContext, identity: Identity, attest: boolean, signal?: AbortSignal): Promise<{ marker: DeliveryVerificationMarker; workspace: CoderWorkspace } | null> {
    const statuses = await this.forgejo.listCommitStatuses(context.application.repositoryOwner, context.application.repositoryName, context.pull.head.sha, signal);
    const status = currentVerificationStatus(statuses, context.record.id, context.pull.head.sha);
    const marker = status ? parseVerificationDescription(status.description) : null;
    if (!marker || status?.status !== 'success') return null;
    const defaultSha = await this.projectForgejo.getProjectBranchHead(context.application.repositoryOwner, context.application.repositoryName, context.application.defaultBranch, signal);
    if (marker.defaultSha !== defaultSha) throw conflict('default branch advanced since the verification environment was prepared');
    const input = {
      repositoryUrl: context.application.cloneUrl,
      branch: context.branch,
      headSha: context.pull.head.sha,
      templateName: this.coderTemplate,
      workspaceNamespace: this.workspaceNamespace,
    };
    const workspace = attest
      ? await this.coder.attestVerificationWorkspaceFor(coderIdentity(identity), marker.workspaceId, input, signal)
      : await this.coder.verificationWorkspaceById(marker.workspaceId, input, signal);
    if (workspace.parameters.repository_url !== context.application.cloneUrl
      || workspace.parameters.repository_ref !== context.pull.head.sha
      || workspace.parameters.workspace_kind !== 'verification') return null;
    if (!workspace.healthy || workspace.apps.some((app) => app.health !== 'healthy')) return null;
    return { marker, workspace };
  }

  private async cleanupStaleVerificationWorkspaces(context: DeliveryContext, currentHeadSha: string, signal?: AbortSignal): Promise<void> {
    const commitShas = await this.projectForgejo.listPullCommitShas(
      context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal,
    );
    const statuses = await Promise.all(commitShas.filter((sha) => sha !== currentHeadSha).map((sha) =>
      this.forgejo.listCommitStatuses(context.application.repositoryOwner, context.application.repositoryName, sha, signal),
    ));
    const markers = new Map<string, DeliveryVerificationMarker>();
    for (const status of statuses.flat()) {
      const marker = status.context === 'factory/verification' ? parseVerificationDescription(status.description) : null;
      if (marker?.deliveryId === context.record.id && marker.headSha !== currentHeadSha) markers.set(marker.workspaceId, marker);
    }
    for (const review of await this.forgejo.listPullReviews(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal)) {
      const marker = parseReviewMarker(review.body);
      if (marker?.deliveryId === context.record.id && marker.headSha !== currentHeadSha) {
        markers.set(marker.workspaceId, { ...marker, version: 1 });
      }
    }
    await Promise.all([...markers.values()].map((marker) => this.deleteBoundVerificationWorkspace(context, marker, signal)));
  }

  private async ensureSpecificationCheck(context: DeliveryContext, headSha: string, signal?: AbortSignal): Promise<void> {
    const bytes = await this.projectForgejo.readProjectFileBytes(
      context.application.repositoryOwner, context.application.repositoryName, headSha, context.marker.artifactPath, signal,
    ).catch((error) => {
      if (isUpstreamStatus(error, 'Forgejo', 404)) return null;
      throw error;
    });
    const valid = bytes !== null && await sha256(bytes) === context.marker.artifactSha256;
    const statuses = await this.forgejo.listCommitStatuses(context.application.repositoryOwner, context.application.repositoryName, headSha, signal);
    if (statuses.find((item) => item.context === 'factory/specification')?.status === (valid ? 'success' : 'failure')) return;
    await this.forgejo.createCommitStatus(
      context.application.repositoryOwner, context.application.repositoryName, headSha, valid ? 'success' : 'failure',
      'factory/specification', valid ? 'Accepted requirement artifact matches this delivery.' : 'Accepted requirement artifact is missing or changed.',
      this.forgejoDestination(`/${context.application.repositoryOwner}/${context.application.repositoryName}/issues/${context.record.requirementNumber}`), signal,
    );
  }

  private async agentForOperation(operation: OperationRecord, headSha: string, identity?: Identity, signal?: AbortSignal): Promise<AgentProjection> {
    if (operation.state === 'pending') return { ...emptyAgent(), active: true };
    if (operation.state === 'running') return { ...emptyAgent(), active: true };
    if (operation.state === 'ambiguous') return { ...emptyAgent(), status: 'running', active: true };
    if (operation.state === 'failed') return { ...emptyAgent(), status: 'failed', error: operation.error ?? 'Coder chat creation failed.' };
    if (!operation.externalId) return { ...emptyAgent(), status: 'running', active: true };
    try {
      const status = identity
        ? await this.coder.implementationChatStatusFor(coderIdentity(identity), operation.externalId, signal)
        : await this.coder.implementationChatStatusForFactoryUser(operation.factoryUserId, operation.externalId, signal);
      const startedHeadSha = status.startedHeadSha;
      if (status.status === 'error') return { status: 'failed', error: status.error, startedHeadSha, chatId: operation.externalId, workspaceId: status.workspaceId, active: false };
      if (status.status === 'waiting') {
        const changed = startedHeadSha !== null && startedHeadSha !== headSha;
        return {
          status: changed ? 'completed' : 'failed',
          error: changed ? null : 'The agent finished without pushing a new commit.',
          startedHeadSha,
          chatId: operation.externalId,
          workspaceId: status.workspaceId,
          active: false,
        };
      }
      return { status: 'running', error: null, startedHeadSha, chatId: operation.externalId, workspaceId: status.workspaceId, active: true };
    } catch {
      return { status: 'running', error: null, startedHeadSha: null, chatId: operation.externalId, workspaceId: null, active: true };
    }
  }

  private async deliveryHasActiveAgent(id: string, signal?: AbortSignal, supplied?: OperationRecord[]): Promise<boolean> {
    const operations = supplied ?? await this.store.operations(id);
    for (const operation of operations) {
      if (operation.state === 'pending' || operation.state === 'running' || operation.state === 'ambiguous') return true;
      if (operation.state !== 'succeeded') continue;
      if (!operation.externalId) return true;
      try {
        const status = await this.coder.implementationChatStatusForFactoryUser(operation.factoryUserId, operation.externalId, signal);
        if (status.status === 'running' || status.status === 'requires_action' || status.status === 'interrupting') return true;
      } catch { return true; }
    }
    return false;
  }

  private ensureIterationWorkspace(context: DeliveryContext, identity: Identity, headSha: string, signal?: AbortSignal): Promise<CoderWorkspace> {
    const create = () => this.coder.ensureIterationWorkspaceFor(coderIdentity(identity), {
      repositoryUrl: context.application.cloneUrl,
      branch: context.branch,
      headSha,
      contributor: identity.subject,
      templateName: this.coderTemplate,
      workspaceNamespace: this.workspaceNamespace,
    }, signal);
    return this.startupMetrics
      ? this.startupMetrics.measure({ systemId: context.application.id, kind: 'ticket', sha: headSha, contractVersion: 1, cacheKey: `v1:${headSha}` }, create)
      : create();
  }

  private async changeWorkspaceState(id: string, identity: Identity, start: boolean, signal?: AbortSignal): Promise<ImplementationRun> {
    const record = await this.store.get(id);
    if (!await this.store.isContributor(id, identity.subject)) throw Object.assign(new Error('only implementation contributors can manage the ticket workspace'), { status: 403 });
    const context = await this.loadContext(record, signal);
    if (context.pull.merged || context.pull.state !== 'open') throw conflict('ticket workspace is no longer active');
    if (!start && await this.deliveryHasActiveAgent(id, signal)) throw conflict('wait for the active implementation agent before stopping its workspace');
    const operation = (await this.store.operations(id)).filter((candidate) => candidate.factoryUserId === identity.subject && candidate.externalId).at(-1);
    if (!operation?.externalId) throw conflict('ticket workspace is not available');
    const chat = await this.coder.implementationChatStatusFor(coderIdentity(identity), operation.externalId, signal);
    if (!chat.workspaceId) throw conflict('ticket workspace is not available');
    const input = {
      repositoryUrl: context.application.cloneUrl, branch: context.branch, headSha: context.pull.head.sha,
      contributor: identity.subject, templateName: this.coderTemplate, workspaceNamespace: this.workspaceNamespace,
    };
    const changed = start
      ? await this.coder.resumeIterationWorkspaceFor(coderIdentity(identity), chat.workspaceId, input, signal)
      : await this.coder.stopIterationWorkspaceFor(coderIdentity(identity), chat.workspaceId, input, signal);
    return this.project(context, identity, signal, changed);
  }

  private async finish(context: DeliveryContext, signal?: AbortSignal, beforeCardTransition?: () => Promise<void>): Promise<void> {
    const [statuses, contributors, pullCommitShas] = await Promise.all([
      this.forgejo.listCommitStatuses(context.application.repositoryOwner, context.application.repositoryName, context.pull.head.sha, signal),
      this.store.contributorIdentities(context.record.id),
      this.projectForgejo.listPullCommitShas(context.application.repositoryOwner, context.application.repositoryName, context.pull.number, signal),
    ]);
    const binding = currentVerificationStatus(statuses, context.record.id, context.pull.head.sha);
    const verification = binding ? parseVerificationDescription(binding.description) : null;
    const headShas = [...new Set([...pullCommitShas, context.pull.head.sha])];
    await Promise.all(contributors.map(async (contributor) => {
      await this.forgejo.releaseImplementationContributorAccess(
        context.application.repositoryOwner, context.application.repositoryName, context.branch,
        this.implementationUser, contributor.username, signal,
      );
    }));
    await Promise.all([
      ...(verification ? [this.deleteBoundVerificationWorkspace(context, verification, signal)] : []),
      ...contributors.flatMap((contributor) => headShas.map((headSha) => this.coder.deleteIterationWorkspace({
        repositoryUrl: context.application.cloneUrl, branch: context.branch, headSha,
        factoryUserId: contributor.factoryUserId,
      }, signal))),
    ]);
    if (verification) {
      await this.forgejo.createCommitStatus(
        context.application.repositoryOwner, context.application.repositoryName, context.pull.head.sha, 'success', 'factory/verification',
        verificationDescription(verification, 'The exact-SHA environment was verified before merge and then removed.'),
        this.forgejoDestination(`/${context.application.repositoryOwner}/${context.application.repositoryName}/pulls/${context.pull.number}`), signal,
      );
    }
    await beforeCardTransition?.();
    await this.forgejo.forRepository(context.application.repositoryOwner, context.application.repositoryName)
      .transition(context.record.requirementNumber, 'done', null, signal);
  }

  private async deleteBoundVerificationWorkspace(context: DeliveryContext, marker: DeliveryVerificationMarker, signal?: AbortSignal): Promise<void> {
    await this.coder.deleteVerificationWorkspace(marker.workspaceId, {
      repositoryUrl: context.application.cloneUrl,
      headSha: marker.headSha,
    }, signal);
  }

  private async applicationFor(record: DeliveryRecord): Promise<ApplicationDefinition | null> {
    return this.applications.get(record.systemId);
  }

  private forgejoDestination(path: string): string {
    const login = new URL('/user/oauth2/Factory', this.publicForgejoUrl);
    login.searchParams.set('redirect_to', path);
    return login.toString();
  }

  private coderUrl(value: string | undefined): string | null {
    if (!value) return null;
    if (this.coderPublicUrl) {
      const target = new URL(value);
      if (target.origin === new URL(this.coderPublicUrl).origin && target.pathname === '/api/v2/users/oidc/callback') return value;
    }
    return this.coderPublicUrl ? coderAppUrl(this.coderPublicUrl, value) : value;
  }

  private coderApps(workspace: CoderWorkspace | undefined): ImplementationApp[] {
    return workspace?.apps.map((app) => ({ ...app, url: this.coderUrl(app.url)! })) ?? [];
  }
}

function branchName(record: DeliveryRecord): string {
  return `factory/requirement-${record.requirementNumber}-${record.id.slice(-12)}`;
}

async function deliveryId(tenantId: string, systemId: string, requirementNumber: number, acceptedDigest: string): Promise<string> {
  return `delivery_${(await sha256(`${tenantId}\n${systemId}\n${requirementNumber}\n${acceptedDigest}`)).slice(0, 32)}`;
}

function chatBinding(context: DeliveryContext, operationId: string) {
  return {
    tenantId: context.record.tenantId,
    systemId: context.application.id,
    requirementNumber: context.record.requirementNumber,
    deliveryId: context.record.id,
    operationId,
    branch: context.branch,
  };
}

function checksFor(statuses: CommitStatus[], context: DeliveryContext, verification: DeliveryVerificationMarker | null): ImplementationCheck[] {
  return REQUIRED_CHECKS.map((name) => {
    const found = statuses.find((item) => item.context === name);
    const current = name === 'factory/verification' && (!verification || verification.deliveryId !== context.record.id || verification.headSha !== context.pull.head.sha) ? undefined : found;
    return {
      context: name,
      state: current?.status ?? 'pending',
      description: current?.description ?? 'Required check has not reported for the current SHA.',
      targetUrl: context.pull.merged || name === 'factory/specification' ? null : current?.target_url || null,
    };
  });
}

function currentVerificationStatus(statuses: CommitStatus[], deliveryId: string, headSha: string): CommitStatus | null {
  return statuses.find((status) => {
    if (status.context !== 'factory/verification') return false;
    const marker = parseVerificationDescription(status.description);
    return marker?.deliveryId === deliveryId && marker.headSha === headSha;
  }) ?? null;
}

function currentReviewEvidence(raw: PullReview[], context: DeliveryContext, verification: DeliveryVerificationMarker | null, expectedActor: string): DeliveryReviewMarker | undefined {
  if (!verification) return undefined;
  const reviews = raw.flatMap((review) => {
    const marker = parseReviewMarker(review.body);
    return review.state === 'APPROVED' && review.user.login === expectedActor && review.commit_id === context.pull.head.sha
      && marker?.deliveryId === context.record.id && marker.headSha === context.pull.head.sha
      && marker.defaultSha === verification.defaultSha && marker.workspaceId === verification.workspaceId ? [marker] : [];
  });
  return reviews.at(-1);
}

function currentReviewDecision(raw: PullReview[], context: DeliveryContext, verification: DeliveryVerificationMarker | null, expectedActor: string): ImplementationReview | undefined {
  if (!verification) return undefined;
  const reviews = raw.filter((review) => {
    const marker = parseReviewMarker(review.body);
    return review.user.login === expectedActor && review.commit_id === context.pull.head.sha
      && marker?.deliveryId === context.record.id && marker.headSha === context.pull.head.sha
      && marker.defaultSha === verification.defaultSha && marker.workspaceId === verification.workspaceId;
  }).map(projectReview).filter((review) => review.state !== 'commented');
  return reviews.at(-1);
}

function projectReview(review: PullReview): ImplementationReview {
  return {
    id: review.id,
    state: review.state === 'APPROVED' ? 'approved' : review.state === 'REQUEST_CHANGES' ? 'changes-requested' : 'commented',
    body: review.body,
    reviewer: review.body.match(/Reviewed in (?:Agentic Software Factory|Agentic Software Factory) by (.+?) \([^\n]+\)\.?$/m)?.[1]?.trim() || review.user.login,
    commitSha: review.commit_id,
    submittedAt: review.submitted_at,
  };
}

function blockersFor(
  context: DeliveryContext,
  agent: AgentProjection,
  checks: ImplementationCheck[],
  decision: ImplementationReview | undefined,
  verificationWorkspace: CoderWorkspace | undefined,
  verification: DeliveryVerificationMarker | null,
  defaultSha: string,
): string[] {
  if (context.pull.merged) return [];
  if (agent.status === 'failed') return [agent.error ?? 'The coding agent failed.'];
  if (agent.status === 'running' || agent.status === 'not-started') return [];
  const blockers: string[] = [];
  if (context.pull.state !== 'open') blockers.push('The pull request is closed.');
  if (!verificationWorkspace?.healthy || verificationWorkspace.apps.some((app) => app.health !== 'healthy')) blockers.push('A healthy SHA-pinned verification environment is required.');
  if (!verification || verification.headSha !== context.pull.head.sha) blockers.push('A SHA-pinned verification environment is required.');
  if (verification && verification.defaultSha !== defaultSha) blockers.push('The default branch advanced after verification preparation.');
  for (const check of checks) if (check.state !== 'success') blockers.push(`${check.context}: ${check.description}`);
  if (decision?.state === 'changes-requested') blockers.push('Changes were requested for the current SHA.');
  if (decision?.state !== 'approved') blockers.push('The current SHA needs approval.');
  if (!context.pull.mergeable) blockers.push('The pull request is not mergeable.');
  return blockers;
}

function phaseFor(
  context: DeliveryContext,
  agent: AgentProjection,
  checks: ImplementationCheck[],
  decision: ImplementationReview | undefined,
  verificationWorkspace: CoderWorkspace | undefined,
): ImplementationPhase {
  if (context.pull.merged) return 'done';
  if (agent.status === 'failed') return 'agent-failed';
  if (agent.status === 'not-started') return 'provisioning';
  if (agent.status === 'running') return 'agent-running';
  if (context.pull.state !== 'open') return 'unplanned';
  if (checks.some((check) => check.state === 'failure' || check.state === 'error')) return 'checks-failing';
  if (checks.some((check) => check.state !== 'success')) return 'implementing';
  if (decision?.state === 'changes-requested') return 'changes-requested';
  if (decision?.state === 'approved' && verificationWorkspace?.healthy) return 'ready-to-merge';
  return 'awaiting-review';
}

function nextActionFor(phase: ImplementationPhase): string {
  return {
    unplanned: 'Umsetzung starten',
    provisioning: 'Arbeitsumgebung und Agent vorbereiten',
    'agent-running': 'Agent arbeitet am Ticket',
    'agent-failed': 'Agent erneut starten oder Branch fortsetzen',
    implementing: 'In der IDE fortsetzen und Vorschau prüfen',
    'checks-failing': 'Fehlgeschlagene Prüfungen beheben',
    'awaiting-review': 'Vorschau und Pull Request prüfen',
    'changes-requested': 'Angeforderte Änderungen umsetzen',
    'ready-to-merge': 'Umsetzung abschließen',
    merging: 'Merge abwarten',
    done: 'Abschluss prüfen',
  }[phase];
}

function emptyAgent(): AgentProjection {
  return { status: 'not-started', error: null, startedHeadSha: null, chatId: null, workspaceId: null, active: false };
}

function implementationArtifact(number: number, title: string, body: string, specification: unknown, digest: string): string {
  return `# Requirement #${number}: ${title}\n\nAccepted digest: \`${digest}\`\n\n## Original idea\n\n${body}\n\n## Accepted specification\n\n\`\`\`json\n${JSON.stringify(specification, null, 2)}\n\`\`\`\n`;
}

function coderIdentity(identity: Identity): CoderUserIdentity {
  if (!identity.email || !identity.username) throw new Error('Coder delegation requires email and username claims');
  return {
    issuer: identity.issuer,
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified ?? false,
    name: identity.name ?? identity.username,
    username: identity.username,
  };
}

function reviewerName(identity: Identity): string {
  return identity.name || identity.username || identity.email || identity.subject;
}

function safePath(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'requirement';
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { status: 409 });
}

function isAmbiguousCreateError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof DOMException
    || (error instanceof UpstreamHttpError && error.status >= 500)
    || (error instanceof Error && error.message.includes('timeout'));
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
