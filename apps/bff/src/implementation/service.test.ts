/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, mock, test } from 'bun:test';

import type { ApplicationDefinition } from '../applications/catalog';
import { acceptedMarker } from '../forgejo/client';
import type { DeliveryRecord } from './store';
import { ImplementationService } from './service';
import { reviewMarker, verificationDescription } from './markers';

const application: ApplicationDefinition = {
  id: 'factory/payments',
  team: 'payments',
  name: 'Payments',
  description: '',
  repositoryOwner: 'factory',
  repositoryName: 'payments',
  repositoryUrl: 'https://forgejo.example/factory/payments',
  cloneUrl: 'https://forgejo.internal/factory/payments.git',
  defaultBranch: 'main',
  defaultSha: 'd'.repeat(40),
  declaredApps: [],
};

const record: DeliveryRecord = {
  id: 'delivery_0123456789abcdef0123456789abcdef',
  tenantId: 'tenant',
  systemId: application.id,
  requirementNumber: 7,
  acceptedDigest: 'sha256:accepted',
  createdByUserId: 'author',
  createdAt: new Date('2026-08-28T10:00:00Z'),
  updatedAt: new Date('2026-08-28T10:00:00Z'),
};

const identity = {
  issuer: 'https://factory.example', subject: 'author', email: 'author@example.test', emailVerified: true,
  username: 'author', name: 'Author', groups: [],
};
const businessIdentity = {
  issuer: 'https://factory.example', subject: 'business-1', email: 'business@example.test', emailVerified: true,
  username: 'business', name: 'Business', groups: [],
};
const accepted = {
  requirementId: 'req_0123456789abcdef0123456789abcdef', revision: '20260828T100000.000000000Z',
  digest: record.acceptedDigest, path: 'requirements/req_0123456789abcdef0123456789abcdef/revisions/20260828T100000.000000000Z-accepted.yaml',
  commitSha: 'a'.repeat(40), acceptedAt: '2026-08-28T10:00:00Z', acceptedBy: 'author',
  specification: { goal: 'Implement it', users: ['User'], userStories: [], acceptanceCriteria: ['It works'], nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [] },
};

describe('ImplementationService', () => {
  test('resolves a delivery by its immutable System identity after registrations move teams', async () => {
    const other = { ...application, id: 'factory/ledger', repositoryName: 'ledger', name: 'Ledger', team: 'platform' };
    const moved = { ...application, team: 'platform' };
    const service = createService({}, {}, [other, moved]);

    await expect((service as unknown as { applicationFor(value: DeliveryRecord): Promise<ApplicationDefinition | null> }).applicationFor(record))
      .resolves.toBe(moved);
  });

  test('derives the same delivery ID from tenant, system, requirement, and accepted digest', async () => {
    const ids: string[] = [];
    const reserveDelivery = mock(async (input: { id: string }) => {
      ids.push(input.id);
      throw new Error('stop after reservation');
    });
    const service = createService({ reserveDelivery });

    await expect(service.start(7, application.id, identity)).rejects.toThrow('stop after reservation');
    await expect(service.start(7, application.id, identity)).rejects.toThrow('stop after reservation');

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^delivery_[0-9a-f]{32}$/);
  });

  test('does not start implementation from a forged acceptance marker', async () => {
    const reserveDelivery = mock(async () => ({ delivery: record, created: true }));
    const verifyAcceptance = mock(async () => {
      throw Object.assign(new Error('accepted specification artifact digest does not match'), { status: 409 });
    });
    const service = createService({ reserveDelivery }, { verifyAcceptance });

    await expect(service.start(7, application.id, identity)).rejects.toMatchObject({
      status: 409,
      message: 'accepted specification artifact digest does not match',
    });
    expect(verifyAcceptance).toHaveBeenCalledTimes(1);
    expect(reserveDelivery).not.toHaveBeenCalled();
  });

  test('derives different delivery IDs for two Systems on the same team', async () => {
    const second = {
      ...application,
      id: 'factory/payments-admin',
      repositoryName: 'payments-admin',
      name: 'Payments admin',
    };
    const ids: string[] = [];
    const reserveDelivery = mock(async (input: { id: string }) => {
      ids.push(input.id);
      throw new Error('stop after reservation');
    });
    const service = createService({ reserveDelivery }, {}, [application, second]);

    await expect(service.start(7, application.id, identity)).rejects.toThrow('stop after reservation');
    await expect(service.start(7, second.id, identity)).rejects.toThrow('stop after reservation');

    expect(new Set(ids).size).toBe(2);
  });

  test('does not let a contributor submit any review decision', async () => {
    const service = createService({ isContributor: mock(async () => true) });
    for (const decision of ['approve', 'request-changes'] as const) {
      await expect(service.review(record.id, identity, decision, '')).rejects.toMatchObject({
        status: 403,
        message: 'implementation contributors cannot review their delivery',
      });
    }
  });

  test('writes new review attribution text', async () => {
    const reviewBodies: string[] = [];
    const createPullReview = mock(async (_owner: string, _repository: string, _number: number, _sha: string, _decision: string, body: string) => {
      reviewBodies.push(body);
    });
    const service = createService({ get: mock(async () => record), isContributor: mock(async () => false) }, {
      listPullReviews: mock(async () => []), createPullReview,
    });
    const headSha = 'a'.repeat(40);
    const context = {
      record, application, branch: 'branch', marker: {},
      pull: { number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false, merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) } },
    };
    const internals = service as unknown as Record<string, ReturnType<typeof mock>>;
    internals.loadContext = mock(async () => context);
    internals.deliveryHasActiveAgent = mock(async () => false);
    internals.verificationWorkspace = mock(async () => ({
      marker: { version: 1, deliveryId: record.id, headSha, defaultSha: 'd'.repeat(40), workspaceId: 'verification-1' },
      workspace: { id: 'verification-1', healthy: true, apps: [] },
    }));
    internals.project = mock(async () => ({ id: record.id }));

    await service.review(record.id, businessIdentity, 'approve', '');

    expect(reviewBodies[0]).toContain('Approved in Agentic Software Factory.');
    expect(reviewBodies[0]).toContain('Reviewed in Agentic Software Factory by Business');
  });

  test('does not let an implementation contributor merge', async () => {
    const service = createService({ get: mock(async () => record), isContributor: mock(async () => true) });
    await expect(service.complete(record.id, identity)).rejects.toMatchObject({
      status: 403,
      message: 'implementation contributors cannot merge their delivery',
    });
  });

  test('synchronizes the current default into the ticket head before preparing verification', async () => {
    const previousHead = 'a'.repeat(40);
    const preparedHead = 'b'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: previousHead }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const prepared = { record, application, branch: 'branch', pull: { ...pull, head: { ...pull.head, sha: preparedHead } }, marker: {} };
    const createCommitStatus = mock(async (..._args: unknown[]) => undefined);
    const ensureVerificationWorkspaceFor = mock(async (_identity: unknown, input: { headSha: string }) => ({
      id: 'verification-new', healthy: true, apps: [{ slug: 'app', displayName: 'App', url: 'https://verification.example/app', health: 'healthy' }], url: 'https://verification.example', parameters: { repository_ref: input.headSha, workspace_kind: 'verification' },
    }));
    const service = createService(
      { get: mock(async () => record) },
      { createCommitStatus },
    );
    Object.assign(service as unknown as { coderPublicUrl: string }, { coderPublicUrl: 'https://coder.example' });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.loadContext = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.deliveryHasActiveAgent = mock(async () => false);
    internals.synchronize = mock(async () => ({ context: prepared, defaultSha }));
    internals.cleanupStaleVerificationWorkspaces = mock(async () => undefined);
    internals.ensureSpecificationCheck = mock(async () => undefined);
    Object.assign((service as unknown as { coder: object }).coder, { ensureVerificationWorkspaceFor });
    internals.project = mock(async () => ({ id: record.id }));

    await service.prepareVerification(record.id, identity);

    expect(ensureVerificationWorkspaceFor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ headSha: preparedHead }), undefined);
    expect(createCommitStatus).toHaveBeenCalledWith(
      'factory', 'payments', preparedHead, 'success', 'factory/verification',
      verificationDescription({ version: 1, deliveryId: record.id, headSha: preparedHead, defaultSha, workspaceId: 'verification-new' }, ''),
      expect.stringContaining('https://coder.example/api/v2/users/oidc/callback?redirect='), undefined,
    );
    expect(createCommitStatus.mock.calls[0]?.[6]).not.toBe('https://verification.example/app');
  });

  test('claims verification before external side effects and rejects a concurrent prepare', async () => {
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    let claimed = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const sideEffectStarted = new Promise<void>((resolve) => { entered = resolve; });
    const claimVerification = mock(async () => claimed ? null : (claimed = true, 1));
    const loadContext = mock(async () => {
      expect(claimed).toBe(true);
      return { record, application, branch: 'branch', pull, marker: {} };
    });
    const synchronize = mock(async (context: unknown) => {
      expect(claimed).toBe(true);
      entered();
      await gate;
      return { context, defaultSha: pull.base.sha };
    });
    const service = createService({ get: mock(async () => record), claimVerification }, { createCommitStatus: mock(async () => undefined) });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.loadContext = loadContext;
    internals.deliveryHasActiveAgent = mock(async () => false);
    internals.synchronize = synchronize;
    internals.cleanupStaleVerificationWorkspaces = mock(async () => undefined);
    internals.ensureSpecificationCheck = mock(async () => undefined);
    internals.project = mock(async () => ({ id: record.id }));
    Object.assign((service as unknown as { coder: object }).coder, { ensureVerificationWorkspaceFor: mock(async () => ({ id: 'verification', healthy: true, apps: [] })) });

    const first = service.prepareVerification(record.id, businessIdentity);
    await sideEffectStarted;
    expect(loadContext).toHaveBeenCalledTimes(1);
    await expect(service.prepareVerification(record.id, businessIdentity)).rejects.toMatchObject({ status: 409 });
    expect(synchronize).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  test('deletes stale verification workspaces for this delivery after the head advances', async () => {
    const oldHead = 'a'.repeat(40);
    const currentHead = 'b'.repeat(40);
    const otherHead = 'c'.repeat(40);
    const stale = { version: 1 as const, deliveryId: record.id, headSha: oldHead, defaultSha: 'd'.repeat(40), workspaceId: 'verification-stale' };
    const unrelated = { version: 1 as const, deliveryId: 'delivery-other', headSha: otherHead, defaultSha: 'd'.repeat(40), workspaceId: 'verification-other' };
    const deleteVerificationWorkspace = mock(async () => undefined);
    const service = new ImplementationService(
      { tenantId: 'tenant' } as never,
      {
        listCommitStatuses: mock(async (_owner: string, _repository: string, sha: string) => sha === oldHead
          ? [{ context: 'factory/verification', description: verificationDescription(stale, ''), status: 'success' }]
          : [{ context: 'factory/verification', description: verificationDescription(unrelated, ''), status: 'success' }]),
        listPullReviews: mock(async () => []),
      } as never,
      { listPullCommitShas: mock(async () => [oldHead, currentHead, otherHead]) } as never,
      { deleteVerificationWorkspace } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
      { coderTemplate: 'factory-template', workspaceNamespace: 'tenant-workspaces' },
    );
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: currentHead }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };

    await (service as unknown as { cleanupStaleVerificationWorkspaces(context: unknown, head: string): Promise<void> })
      .cleanupStaleVerificationWorkspaces({ record, application, branch: 'branch', pull, marker: {} }, currentHead);

    expect(deleteVerificationWorkspace).toHaveBeenCalledTimes(1);
    expect(deleteVerificationWorkspace).toHaveBeenCalledWith('verification-stale', { repositoryUrl: application.cloneUrl, headSha: oldHead }, undefined);
  });

  test('does not retry verification after its pull request merged', async () => {
    const claimVerification = mock(async () => 1);
    const retryVerification = mock(async () => undefined);
    const service = createService({ get: mock(async () => record), claimVerification, retryVerification });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.loadContext = mock(async () => ({
      record, application, branch: 'branch', marker: {},
      pull: { number: 11, state: 'closed', merged: true, head: { sha: 'a'.repeat(40) } },
    }));

    await service.reconcileVerification({ deliveryId: record.id, requestedByUserId: 'reviewer', desiredHeadSha: 'a'.repeat(40), desiredDefaultSha: 'd'.repeat(40), phase: 'healthy' } as never, businessIdentity);

    expect(claimVerification).not.toHaveBeenCalled();
    expect(retryVerification).not.toHaveBeenCalled();
  });

  test('merges only the freshly read current head SHA', async () => {
    const currentHead = 'a'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/factory/payments/pulls/11',
      draft: false, merged: false, mergeable: true,
      head: { label: '', ref: 'factory/requirement-7-fixed', sha: currentHead },
      base: { label: '', ref: 'main', sha: defaultSha },
    };
    const context = { record, application, branch: pull.head.ref, pull, marker: {} };
    const mergePullRequest = mock(async () => undefined);
    const verification = { version: 1 as const, deliveryId: record.id, headSha: currentHead, defaultSha, workspaceId: 'verification-1' };
    const reserveCompletion = mock(async (input) => ({ ...input, phase: 'merge-requested' }));
    const store = {
      get: mock(async () => record), isContributor: mock(async () => false), completion: mock(async () => null), reserveCompletion,
    };
    const service = createService(store, { getPullRequest: mock(async () => pull), mergePullRequest, listPullReviews: mock(async () => [approvedReview(verification)]) });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.applicationFor = mock(async () => application);
    internals.loadContext = mock(async () => context);
    internals.verificationWorkspace = mock(async () => ({ marker: verification, workspace: {} }));
    internals.project = mock(async () => ({
      id: record.id, phase: reserveCompletion.mock.calls.length ? 'merging' : 'ready-to-merge', blockers: [],
    }));
    internals.finish = mock(async () => undefined);

    await expect(service.complete(record.id, businessIdentity)).resolves.toMatchObject({ phase: 'merging' });
    expect(reserveCompletion).toHaveBeenCalledWith({
      deliveryId: record.id, reviewedHeadSha: currentHead, reviewedDefaultSha: defaultSha, verificationWorkspaceId: verification.workspaceId,
    });
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  test('resumes cleanup after a crash that occurred after Forgejo merged', async () => {
    const pull = {
      number: 11, state: 'closed', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: true, mergeable: true, merged_commit_id: 'm'.repeat(40),
      head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    const completion = { deliveryId: record.id, phase: 'merged', reviewedHeadSha: pull.head.sha, reviewedDefaultSha: pull.base.sha, verificationWorkspaceId: 'verification-1' };
    const phases: string[] = [];
    const advanceCompletion = mock(async (...args: unknown[]) => { phases.push(String(args[3])); return true; });
    const mergePullRequest = mock(async () => undefined);
    const service = createService({
      get: mock(async () => record), claimCompletion: mock(async () => 3), advanceCompletion,
      retryCompletion: mock(async () => undefined), renewCompletion: mock(async () => true), touchDelivery: mock(async () => undefined),
    }, { mergePullRequest });
    const internals = service as unknown as { loadContext(): Promise<unknown>; finish(context: unknown, signal: unknown, before: () => Promise<void>): Promise<void> };
    internals.loadContext = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.finish = mock(async (_context, _signal, before) => { await before(); });

    await service.reconcileCompletion(completion as never);
    expect(mergePullRequest).not.toHaveBeenCalled();
    expect(phases).toEqual(['cleanup-pending', 'card-transition-pending', 'complete']);
  });

  test('aborts completion when heartbeat renewal throws', async () => {
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/factory/payments/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    const completion = { deliveryId: record.id, phase: 'merge-requested', reviewedHeadSha: pull.head.sha, reviewedDefaultSha: pull.base.sha, verificationWorkspaceId: 'verification-1' };
    let renewals = 0;
    let mergeSignal: AbortSignal | undefined;
    const advanceCompletion = mock(async () => true);
    const retryCompletion = mock(async () => undefined);
    const mergePullRequest = mock(async (_owner: string, _repository: string, _number: number, _head: string, signal?: AbortSignal) => {
      mergeSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const service = createService({
      get: mock(async () => record), claimCompletion: mock(async () => 3), advanceCompletion, retryCompletion,
      renewCompletion: mock(async () => {
        renewals += 1;
        if (renewals > 1) throw new Error('database unavailable');
        return true;
      }),
    }, { mergePullRequest });
    Object.assign(service as unknown as { heartbeatMs: number }, { heartbeatMs: 1 });
    const internals = service as unknown as { loadContext(): Promise<unknown> };
    internals.loadContext = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));

    await expect(service.reconcileCompletion(completion as never)).rejects.toThrow('Delivery completion lease heartbeat failed');

    expect(mergeSignal?.aborted).toBe(true);
    expect(advanceCompletion).not.toHaveBeenCalled();
    expect(retryCompletion).toHaveBeenCalledWith(record.id, expect.any(String), 3, 'Delivery completion lease heartbeat failed');
  });

  test('reconciles a verification workspace after status publication was lost', async () => {
    const headSha = 'a'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const verification = { deliveryId: record.id, requestedByUserId: businessIdentity.subject, desiredHeadSha: headSha, desiredDefaultSha: defaultSha, phase: 'provisioning' };
    const createCommitStatus = mock(async (..._args: unknown[]) => undefined);
    const ensureVerificationWorkspaceFor = mock(async () => ({ id: 'verification-1', healthy: true, apps: [], url: 'https://verification.example' }));
    const completeVerification = mock(async () => true);
    const service = createService({
      get: mock(async () => record), claimVerification: mock(async () => 2), completeVerification, retryVerification: mock(async () => undefined),
      operations: mock(async () => []),
    }, { createCommitStatus });
    Object.assign(service as unknown as { coderPublicUrl: string }, { coderPublicUrl: 'https://coder.example' });
    const internals = service as unknown as {
      loadContext(): Promise<unknown>; synchronize(context: unknown): Promise<{ context: unknown; defaultSha: string }>;
      cleanupStaleVerificationWorkspaces(): Promise<void>; ensureSpecificationCheck(): Promise<void>;
    };
    internals.loadContext = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.synchronize = mock(async (context) => ({ context, defaultSha }));
    internals.cleanupStaleVerificationWorkspaces = mock(async () => undefined);
    internals.ensureSpecificationCheck = mock(async () => undefined);
    Object.assign(service as unknown as { coder: object }, { coder: { ensureVerificationWorkspaceFor } });

    await service.reconcileVerification(verification as never, businessIdentity);
    expect(ensureVerificationWorkspaceFor).toHaveBeenCalledTimes(1);
    expect(createCommitStatus).toHaveBeenCalledWith(
      'factory', 'payments', headSha, 'success', 'factory/verification', expect.any(String),
      expect.stringContaining('https://coder.example/api/v2/users/oidc/callback?redirect='), undefined,
    );
    expect(createCommitStatus.mock.calls[0]?.[6]).not.toBe('https://verification.example');
    expect(completeVerification).toHaveBeenCalledWith(record.id, expect.any(String), 2, headSha, 'verification-1');
  });

  test('retargets an advanced verification under its existing lease', async () => {
    const oldHead = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const oldDefault = 'c'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const verification = { deliveryId: record.id, requestedByUserId: businessIdentity.subject, desiredHeadSha: oldHead, desiredDefaultSha: oldDefault, phase: 'provisioning' };
    const retargetVerification = mock(async () => true);
    const desireVerification = mock(async () => { throw new Error('must not release the claimed lease'); });
    const completeVerification = mock(async () => true);
    const service = createService({
      get: mock(async () => record), claimVerification: mock(async () => 4), retargetVerification, desireVerification,
      completeVerification, retryVerification: mock(async () => undefined), operations: mock(async () => []),
    }, { createCommitStatus: mock(async () => undefined) });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.loadContext = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.synchronize = mock(async (context) => ({ context, defaultSha }));
    internals.cleanupStaleVerificationWorkspaces = mock(async () => undefined);
    internals.ensureSpecificationCheck = mock(async () => undefined);
    Object.assign((service as unknown as { coder: object }).coder, {
      ensureVerificationWorkspaceFor: mock(async () => ({ id: 'verification-advanced', healthy: true, apps: [], url: 'https://verification.example' })),
    });

    await service.reconcileVerification(verification as never, businessIdentity);

    expect(retargetVerification).toHaveBeenCalledWith(record.id, expect.any(String), 4, businessIdentity.subject, headSha, defaultSha);
    expect(desireVerification).not.toHaveBeenCalled();
    expect(completeVerification).toHaveBeenCalledWith(record.id, expect.any(String), 4, headSha, 'verification-advanced');
  });

  test('projects Forgejo post-merge base SHA when merged_commit_id is absent', async () => {
    const mergeSha = 'e'.repeat(40);
    const service = createService({
      operations: mock(async () => []), contributor: mock(async () => null),
    }, {
      listCommitStatuses: mock(async () => []), listPullReviews: mock(async () => []),
    });
    Object.assign((service as unknown as { projectForgejo: object }).projectForgejo, {
      getProjectBranchHead: mock(async () => mergeSha),
    });
    const context = {
      record,
      application,
      branch: 'branch',
      marker: {},
      pull: {
        number: 11, state: 'closed', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
        merged: true, merged_commit_id: null, mergeable: true,
        head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: mergeSha },
      },
    };

    const projected = await (service as unknown as { project(context: unknown, identity: unknown): Promise<{ mergedSha: string }> }).project(context, identity);

    expect(projected.mergedSha).toBe(mergeSha);
  });

  test('rejects merge when the pull head changes after projection', async () => {
    const projectedHead = 'a'.repeat(40);
    const movedHead = 'b'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: projectedHead }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const mergePullRequest = mock(async () => undefined);
    const service = createService(
      { get: mock(async () => record), isContributor: mock(async () => false) },
      { getPullRequest: mock(async () => ({ ...pull, head: { ...pull.head, sha: movedHead } })), mergePullRequest, listPullReviews: mock(async () => [approvedReview({ deliveryId: record.id, headSha: projectedHead, defaultSha, workspaceId: 'verification-1' })]) },
    );
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.applicationFor = mock(async () => application);
    internals.loadContext = mock(async () => ({ record, application, branch: pull.head.ref, pull, marker: {} }));
    internals.verificationWorkspace = mock(async () => ({ marker: { deliveryId: record.id, headSha: projectedHead, defaultSha, workspaceId: 'verification-1' }, workspace: {} }));
    internals.project = mock(async () => ({ phase: 'ready-to-merge', blockers: [] }));

    await expect(service.complete(record.id, businessIdentity)).rejects.toThrow('pull request changed before merge');
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  test('rejects merge when default advances after the reviewed head', async () => {
    const headSha = 'a'.repeat(40);
    const reviewedDefault = 'd'.repeat(40);
    const currentDefault = 'e'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: currentDefault },
    };
    const mergePullRequest = mock(async () => undefined);
    const service = createService(
      { get: mock(async () => record), isContributor: mock(async () => false) },
      { getPullRequest: mock(async () => pull), mergePullRequest, listPullReviews: mock(async () => [approvedReview({ deliveryId: record.id, headSha, defaultSha: reviewedDefault, workspaceId: 'verification-1' })]) },
    );
    Object.assign((service as unknown as { projectForgejo: object }).projectForgejo, { getProjectBranchHead: mock(async () => currentDefault) });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    internals.applicationFor = mock(async () => application);
    internals.loadContext = mock(async () => ({ record, application, branch: pull.head.ref, pull, marker: {} }));
    internals.verificationWorkspace = mock(async () => ({ marker: { deliveryId: record.id, headSha, defaultSha: reviewedDefault, workspaceId: 'verification-1' }, workspace: {} }));
    internals.project = mock(async () => ({ phase: 'ready-to-merge', blockers: [] }));

    await expect(service.complete(record.id, businessIdentity)).rejects.toThrow('default branch advanced before merge');
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  test('deletes only iteration workspaces bound to this delivery', async () => {
    const deleteIterationWorkspace = mock(async (_input: { repositoryUrl: string; branch: string; headSha: string; factoryUserId: string }) => undefined);
    const firstSha = 'a'.repeat(40);
    const secondSha = 'b'.repeat(40);
    const service = new ImplementationService(
      { tenantId: 'tenant', contributorIdentities: mock(async () => [
        { deliveryId: record.id, factoryUserId: identity.subject, username: 'author' },
        { deliveryId: record.id, factoryUserId: 'second', username: 'second' },
      ]) } as never,
      { listCommitStatuses: mock(async () => []), transition: mock(async () => undefined), releaseImplementationContributorAccess: mock(async () => undefined), forRepository() { return this; } } as never,
      { listPullCommitShas: mock(async () => [firstSha, secondSha, secondSha]) } as never,
      { deleteIterationWorkspace } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );
    const pull = {
      number: 11, state: 'closed', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: true, mergeable: true, head: { label: '', ref: 'branch', sha: secondSha }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };

    await (service as unknown as { finish(context: unknown): Promise<void> }).finish({ record, application, branch: 'branch', pull, marker: {} });

    expect(deleteIterationWorkspace).toHaveBeenCalledTimes(4);
    expect(deleteIterationWorkspace.mock.calls.map(([input]) => input)).toEqual(expect.arrayContaining([
      { repositoryUrl: application.cloneUrl, branch: 'branch', headSha: firstSha, factoryUserId: identity.subject },
      { repositoryUrl: application.cloneUrl, branch: 'branch', headSha: secondSha, factoryUserId: identity.subject },
      { repositoryUrl: application.cloneUrl, branch: 'branch', headSha: firstSha, factoryUserId: 'second' },
      { repositoryUrl: application.cloneUrl, branch: 'branch', headSha: secondSha, factoryUserId: 'second' },
    ]));
  });

  test('deletes an exact workspace when dispatch fails before Chat creation starts', async () => {
    const deleteIterationWorkspace = mock(async () => undefined);
    const markOperationFailed = mock(async () => true);
    const service = new ImplementationService(
      { tenantId: 'tenant', claimOperation: mock(async () => true), renewOperation: mock(async () => true), markOperationFailed } as never,
      {} as never,
      {} as never,
      { waitForHealthyWorkspaceFor: mock(async () => { throw new Error('workspace unhealthy'); }), deleteIterationWorkspace } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'pending', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };

    await expect((service as unknown as { dispatch(...args: unknown[]): Promise<void> }).dispatch(
      { record, application, branch: 'branch', pull, marker: {} }, identity, operation, {}, 'Title', 'Body', false, undefined, { id: 'ticket-1' },
    )).rejects.toThrow('workspace unhealthy');

    expect(deleteIterationWorkspace).toHaveBeenCalledWith({
      repositoryUrl: application.cloneUrl,
      branch: pull.head.ref,
      headSha: pull.head.sha,
      factoryUserId: identity.subject,
    }, expect.any(AbortSignal));
    expect(markOperationFailed).toHaveBeenCalled();
  });

  test('never posts again for an ambiguous Chat create', async () => {
    const startImplementationChatFor = mock(async () => { throw new Error('must not POST'); });
    const markOperationAmbiguous = mock(async () => true);
    const service = new ImplementationService(
      { tenantId: 'tenant', claimOperation: mock(async () => true), markOperationAmbiguous } as never,
      {} as never,
      {} as never,
      { reconcileImplementationChatFor: mock(async () => ({ status: 'missing' })), startImplementationChatFor } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'ambiguous', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: 'response lost',
      createdAt: new Date(), updatedAt: new Date(),
    };
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };

    await (service as unknown as { dispatch(...args: unknown[]): Promise<void> }).dispatch(
      { record, application, branch: 'branch', pull, marker: {} }, identity, operation, {}, 'Title', 'Body', true,
    );

    expect(startImplementationChatFor).not.toHaveBeenCalled();
    expect(markOperationAmbiguous).toHaveBeenCalledWith('operation-1', expect.any(String), expect.stringContaining('no matching'));
  });

  test('does not dispatch an operation attributed to another contributor', async () => {
    const otherOperation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: 'other', kind: 'coder-chat-create',
      state: 'pending', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const service = createService({
      reserveDelivery: mock(async () => ({ delivery: record, created: false })),
      isContributor: mock(async () => true),
      addContributor: mock(async () => undefined),
      activeOperation: mock(async () => otherOperation),
      operations: mock(async () => [otherOperation]),
      contributor: mock(async () => ({ deliveryId: record.id, factoryUserId: identity.subject })),
    });
    const internals = service as unknown as Record<string, (...args: unknown[]) => unknown>;
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    internals.ensureInitialDelivery = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.dispatch = mock(async () => { throw new Error('must not dispatch'); });
    internals.loadContext = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.project = mock(async () => ({ id: record.id }));

    expect((await service.start(7, application.id, identity)).id).toBe(record.id);
    expect(internals.dispatch).not.toHaveBeenCalled();
  });

  test('grants the authenticated contributor access to only the delivery branch', async () => {
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'pending', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const ensureImplementationContributorAccess = mock(async () => undefined);
    const service = createService({
      reserveDelivery: mock(async () => ({ delivery: record, created: true })),
      isContributor: mock(async () => false),
      addContributor: mock(async () => undefined),
      activeOperation: mock(async () => null),
      reserveOperation: mock(async () => operation),
      touchDelivery: mock(async () => undefined),
      operations: mock(async () => [operation]),
    }, { ensureImplementationContributorAccess });
    const internals = service as unknown as Record<string, ReturnType<typeof mock>>;
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'factory/requirement-7-fixed', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    internals.ensureInitialDelivery = mock(async () => ({ record, application, branch: pull.head.ref, pull, marker: {} }));
    internals.loadContext = mock(async () => ({ record, application, branch: pull.head.ref, pull, marker: {} }));
    internals.project = mock(async () => ({ id: record.id }));

    await service.start(7, application.id, identity);

    expect(ensureImplementationContributorAccess).toHaveBeenCalledWith(
      'factory', 'payments', pull.head.ref, 'factory-implementation', identity.username, undefined,
    );
  });

  test('reserves a handover operation without blocking the start request on dispatch', async () => {
    const terminal = {
      idempotencyKey: 'operation-old', deliveryId: record.id, factoryUserId: 'other', kind: 'coder-chat-create',
      state: 'succeeded', leaseOwner: null, leaseExpiresAt: null, externalId: 'chat-old', error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const next = { ...terminal, idempotencyKey: 'operation-new', factoryUserId: identity.subject, state: 'pending', externalId: null };
    const service = createService({
      reserveDelivery: mock(async () => ({ delivery: record, created: false })), isContributor: mock(async () => true),
      addContributor: mock(async () => undefined), activeOperation: mock(async () => terminal), retireOperation: mock(async () => undefined),
      reserveOperation: mock(async () => next), touchDelivery: mock(async () => undefined), operations: mock(async () => [terminal]),
    });
    const internals = service as unknown as Record<string, ReturnType<typeof mock>>;
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    const context = { record, application, branch: 'branch', pull, marker: {} };
    internals.ensureInitialDelivery = mock(async () => context);
    internals.agentForOperation = mock(async () => ({ status: 'completed', active: false }));
    internals.synchronize = mock(async () => ({ context, defaultSha: pull.base.sha }));
    internals.dispatch = mock(async () => undefined);
    internals.loadContext = mock(async () => context);
    internals.project = mock(async () => ({ id: record.id }));

    await service.start(7, application.id, identity);

    expect(internals.dispatch).not.toHaveBeenCalled();
    expect(internals.project).toHaveBeenCalled();
  });

  test('adds handover only when the reconciler resumes after a prior Chat', async () => {
    const current = {
      idempotencyKey: 'operation-new', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'pending', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const previous = { ...current, idempotencyKey: 'operation-old', state: 'failed', externalId: 'chat-old' };
    const service = createService({
      get: mock(async () => record),
      operations: mock(async () => [previous, current]),
    });
    const internals = service as unknown as Record<string, ReturnType<typeof mock>>;
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    internals.applicationFor = mock(async () => application);
    internals.ensureInitialDelivery = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.dispatch = mock(async () => undefined);

    await service.resumeOperation(current as never, identity);

    expect(internals.dispatch.mock.calls[0]?.[6]).toBe(true);
  });

  test('does not mark the first reconciled operation as a handover', async () => {
    const current = {
      idempotencyKey: 'operation-new', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'pending', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const service = createService({
      get: mock(async () => record),
      operations: mock(async () => [current]),
    });
    const internals = service as unknown as Record<string, ReturnType<typeof mock>>;
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    internals.applicationFor = mock(async () => application);
    internals.ensureInitialDelivery = mock(async () => ({ record, application, branch: 'branch', pull, marker: {} }));
    internals.dispatch = mock(async () => undefined);

    await service.resumeOperation(current as never, identity);

    expect(internals.dispatch.mock.calls[0]?.[6]).toBe(false);
  });

  test('propagates shutdown through operation recovery and dispatch', async () => {
    const current = {
      idempotencyKey: 'operation-new', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'pending', leaseOwner: null, leaseExpiresAt: null, externalId: null, error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const controller = new AbortController();
    const service = createService({ get: mock(async () => record), operations: mock(async () => [current]) });
    const internals = service as unknown as Record<string, ReturnType<typeof mock>>;
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: 'a'.repeat(40) }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    internals.applicationFor = mock(async () => application);
    internals.ensureInitialDelivery = mock(async (...args: unknown[]) => {
      expect(args.at(-1)).toBe(controller.signal);
      return { record, application, branch: 'branch', pull, marker: {} };
    });
    internals.dispatch = mock(async (...args: unknown[]) => {
      const signal = args[7] as AbortSignal;
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });

    const active = service.resumeOperation(current as never, identity, controller.signal);
    await Bun.sleep(0);
    controller.abort(new Error('worker host stopped'));

    await expect(active).rejects.toThrow('worker host stopped');
    expect(internals.dispatch.mock.calls[0]?.[7]).toBe(controller.signal);
  });

  test('background operation reconciliation records the first terminal Chat observation', async () => {
    const current = {
      idempotencyKey: 'operation-terminal', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'succeeded', leaseOwner: null, leaseExpiresAt: null, externalId: 'chat-1', error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const markOperationChatTerminal = mock(async () => undefined);
    const status = mock(async () => ({ status: 'completed', error: null, startedHeadSha: 'b'.repeat(40), workspaceId: null }));
    const service = new ImplementationService(
      { tenantId: 'tenant', markOperationChatTerminal } as never,
      {} as never,
      {} as never,
      { implementationChatStatusForFactoryUser: status } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );

    await service.resumeOperation(current as never, identity);

    expect(status).toHaveBeenCalledWith(identity.subject, 'chat-1', undefined);
    expect(markOperationChatTerminal).toHaveBeenCalledWith('operation-terminal');
  });

  test('treats an unreadable succeeded Chat as active', async () => {
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create',
      state: 'succeeded', leaseOwner: null, leaseExpiresAt: null, externalId: 'chat-1', error: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const service = new ImplementationService(
      { tenantId: 'tenant', operations: mock(async () => [operation]) } as never,
      {} as never,
      {} as never,
      { implementationChatStatus: mock(async () => { throw new TypeError('transient read failure'); }) } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );

    await expect((service as unknown as { deliveryHasActiveAgent(id: string): Promise<boolean> }).deliveryHasActiveAgent(record.id)).resolves.toBe(true);
    await expect((service as unknown as { agentForOperation(operation: unknown, sha: string): Promise<{ status: string; active: boolean }> })
      .agentForOperation(operation, 'a'.repeat(40))).resolves.toMatchObject({ status: 'running', active: true });

    const missingId = { ...operation, externalId: null };
    await expect((service as unknown as { deliveryHasActiveAgent(id: string, signal?: AbortSignal, supplied?: unknown[]): Promise<boolean> })
      .deliveryHasActiveAgent(record.id, undefined, [missingId])).resolves.toBe(true);
    await expect((service as unknown as { agentForOperation(operation: unknown, sha: string): Promise<{ status: string; active: boolean }> })
      .agentForOperation(missingId, 'a'.repeat(40))).resolves.toMatchObject({ status: 'running', active: true });
  });

  test('automatically desires exact-SHA verification after the implementation agent pushes', async () => {
    const headSha = 'a'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const desireVerification = mock(async (input) => ({ ...input, phase: 'desired' }));
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: record.createdByUserId, kind: 'coder-chat-create', state: 'succeeded',
      leaseOwner: null, leaseExpiresAt: null, externalId: 'chat-1', error: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const service = new ImplementationService(
      {
        tenantId: 'tenant', operations: mock(async () => [operation]), contributor: mock(async () => null), completion: mock(async () => null),
        verification: mock(async () => null), desireVerification,
      } as never,
      { listCommitStatuses: mock(async () => []), listPullReviews: mock(async () => []) } as never,
      { getProjectBranchHead: mock(async () => defaultSha) } as never,
      {
        implementationChatStatus: mock(async () => ({ status: 'waiting', error: null, startedHeadSha: 'b'.repeat(40), workspaceId: null })),
        implementationChatStatusForFactoryUser: mock(async () => ({ status: 'waiting', error: null, startedHeadSha: 'b'.repeat(40), workspaceId: null })),
        chatUrl: (id: string) => `https://coder.example/agents/${id}`,
      } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );

    await (service as unknown as { project(...args: unknown[]): Promise<unknown> }).project({ record, application, branch: 'branch', pull, marker: {} }, businessIdentity);

    expect(desireVerification).toHaveBeenCalledWith({
      deliveryId: record.id, requestedByUserId: record.createdByUserId, desiredHeadSha: headSha, desiredDefaultSha: defaultSha,
    });
  });

  test('re-arms healthy verification only after its observed head or default advances', async () => {
    const originalHead = 'a'.repeat(40);
    const originalDefault = 'd'.repeat(40);
    const desireVerification = mock(async (input) => ({ ...input, phase: 'desired' }));
    const verification = {
      deliveryId: record.id, requestedByUserId: businessIdentity.subject, desiredHeadSha: originalHead,
      desiredDefaultSha: originalDefault, currentHeadSha: originalHead, phase: 'healthy',
    };
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: originalHead }, base: { label: '', ref: 'main', sha: originalDefault },
    };
    let defaultSha = originalDefault;
    const service = new ImplementationService(
      {
        tenantId: 'tenant', operations: mock(async () => []), contributor: mock(async () => null), completion: mock(async () => null),
        verification: mock(async () => verification), desireVerification,
      } as never,
      { listCommitStatuses: mock(async () => []), listPullReviews: mock(async () => []) } as never,
      { getProjectBranchHead: mock(async () => defaultSha) } as never,
      {} as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );
    const context = { record, application, branch: 'branch', pull, marker: {} };
    const project = (service as unknown as { project(...args: unknown[]): Promise<unknown> }).project.bind(service);

    await project(context, businessIdentity);
    expect(desireVerification).not.toHaveBeenCalled();

    defaultSha = 'e'.repeat(40);
    await project(context, businessIdentity);

    expect(desireVerification).toHaveBeenCalledTimes(1);
    expect(desireVerification).toHaveBeenCalledWith({
      deliveryId: record.id, requestedByUserId: businessIdentity.subject, desiredHeadSha: pull.head.sha, desiredDefaultSha: defaultSha,
    });

    desireVerification.mockClear();
    defaultSha = originalDefault;
    pull.head.sha = 'c'.repeat(40);
    await project(context, businessIdentity);

    expect(desireVerification).toHaveBeenCalledTimes(1);
    expect(desireVerification).toHaveBeenCalledWith({
      deliveryId: record.id, requestedByUserId: businessIdentity.subject, desiredHeadSha: pull.head.sha, desiredDefaultSha: defaultSha,
    });
  });

  test('projects development tools only to a delivery contributor', async () => {
    const headSha = 'a'.repeat(40);
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: identity.subject, kind: 'coder-chat-create', state: 'succeeded',
      leaseOwner: null, leaseExpiresAt: null, externalId: 'chat-1', error: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: 'd'.repeat(40) },
    };
    const workspace = {
      id: 'ticket-1', url: 'https://coder.example/workspace', chatUrl: 'https://coder.example/agents/chat-1',
      ideUrl: 'https://ide.example', healthy: true,
      apps: [{ slug: 'app', displayName: 'App', url: 'https://app.example', health: 'healthy' }],
      parameters: { repository_url: application.cloneUrl, repository_ref: headSha, workspace_kind: 'developer' },
    };
    const service = new ImplementationService(
      {
        tenantId: 'tenant', operations: mock(async () => [operation]),
        contributor: mock(async (_deliveryId: string, subject: string) => subject === identity.subject ? { deliveryId: record.id, factoryUserId: subject } : null),
        completion: mock(async () => null), verification: mock(async () => ({ phase: 'healthy' })),
      } as never,
      { listCommitStatuses: mock(async () => []), listPullReviews: mock(async () => []) } as never,
      { getProjectBranchHead: mock(async () => 'd'.repeat(40)) } as never,
      {
        implementationChatStatus: mock(async () => ({ status: 'running', error: null, startedHeadSha: headSha, workspaceId: workspace.id })),
        implementationChatStatusForFactoryUser: mock(async () => ({ status: 'running', error: null, startedHeadSha: headSha, workspaceId: workspace.id })),
        implementationChatStatusFor: mock(async () => ({ status: 'running', error: null, startedHeadSha: headSha, workspaceId: workspace.id })),
        chatUrl: (id: string) => `https://coder.example/agents/${id}`,
      } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
      { coderPublicUrl: 'https://coder.example' },
    );
    const project = (service as unknown as { project(...args: unknown[]): Promise<{ workspaceUrl: string | null; agentUrl: string | null; ideUrl: string | null; developmentApps: unknown[] }> }).project.bind(service);
    const context = { record, application, branch: 'branch', pull, marker: {} };

    const contributor = await project(context, identity, undefined, workspace);
    expect(contributor.workspaceUrl).toBe(workspace.url);
    expect(contributor.agentUrl).not.toBeNull();
    expect(contributor.ideUrl).not.toBeNull();
    expect(contributor.developmentApps).toHaveLength(1);

    const reviewer = await project(context, businessIdentity, undefined, workspace);
    expect(reviewer).toMatchObject({ workspaceUrl: null, agentUrl: null, ideUrl: null, developmentApps: [] });
  });

  test('accepts approval only from the configured Forgejo review actor', async () => {
    const headSha = 'a'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const binding = { version: 1 as const, deliveryId: record.id, headSha, defaultSha, workspaceId: 'verification-1' };
    const approval = { ...binding, version: 2 as const, reviewerIssuer: identity.issuer, reviewerSubject: identity.subject };
    const operation = {
      idempotencyKey: 'operation-1', deliveryId: record.id, factoryUserId: 'author', kind: 'coder-chat-create', state: 'succeeded',
      leaseOwner: null, leaseExpiresAt: null, externalId: 'chat-1', error: null, createdAt: new Date(), updatedAt: new Date(),
    };
    let actor = 'attacker';
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const workspace = { id: 'verification-1', healthy: true, apps: [], parameters: { repository_url: application.cloneUrl, repository_ref: headSha, workspace_kind: 'verification' } };
    const service = new ImplementationService(
      {
        tenantId: 'tenant', operations: mock(async () => [operation]), contributor: mock(async () => null), completion: mock(async () => null),
        verification: mock(async () => null), desireVerification: mock(async () => undefined),
      } as never,
      {
        listCommitStatuses: mock(async () => [
          { context: 'factory/specification', status: 'success', description: '', target_url: '' },
          { context: 'factory/verification', status: 'success', description: verificationDescription(binding, 'healthy'), target_url: 'https://verification.example/application' },
        ]),
        listPullReviews: mock(async () => [{
          id: 1, state: 'APPROVED', body: reviewMarker(approval), user: { login: actor }, commit_id: headSha, submitted_at: '2026-08-28T10:00:00Z',
        }]),
      } as never,
      { getProjectBranchHead: mock(async () => defaultSha) } as never,
      {
        implementationChatStatus: mock(async () => ({ status: 'waiting', error: null, startedHeadSha: 'b'.repeat(40), workspaceId: null })),
        implementationChatStatusForFactoryUser: mock(async () => ({ status: 'waiting', error: null, startedHeadSha: 'b'.repeat(40), workspaceId: null })),
        implementationChatStatusFor: mock(async () => ({ status: 'waiting', error: null, startedHeadSha: 'b'.repeat(40), workspaceId: null })),
        verificationWorkspaceById: mock(async () => workspace),
        chatUrl: (id: string) => `https://coder.example/agents/${id}`,
      } as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
      { reviewActor: 'factory-review', coderPublicUrl: 'https://coder.example' },
    );
    const context = { record, application, branch: 'branch', pull, marker: {} };
    const project = (service as unknown as { project(...args: unknown[]): Promise<{ phase: string }> }).project.bind(service);

    const projected = await project(context, identity) as unknown as { phase: string; checks: Array<{ context: string; targetUrl: string | null }> };
    expect(projected.phase).toBe('awaiting-review');
    expect(projected.checks.find((check) => check.context === 'factory/verification')?.targetUrl).toContain('https://coder.example/api/v2/users/oidc/callback?redirect=');
    expect(projected.checks.find((check) => check.context === 'factory/verification')?.targetUrl).not.toBe('https://verification.example/application');
    actor = 'factory-review';
    expect((await project(context, identity)).phase).toBe('ready-to-merge');
  });

  test('reads reviewer names from new and legacy review attribution', async () => {
    const headSha = 'a'.repeat(40);
    const defaultSha = 'd'.repeat(40);
    const pull = {
      number: 11, state: 'open', title: '', body: '', html_url: 'https://forgejo.example/pulls/11', draft: false,
      merged: false, mergeable: true, head: { label: '', ref: 'branch', sha: headSha }, base: { label: '', ref: 'main', sha: defaultSha },
    };
    const service = new ImplementationService(
      { tenantId: 'tenant', operations: mock(async () => []), contributor: mock(async () => null), completion: mock(async () => null), verification: mock(async () => null) } as never,
      {
        listCommitStatuses: mock(async () => []),
        listPullReviews: mock(async () => [
          { id: 1, state: 'COMMENT', body: 'Reviewed in Agentic Software Factory by Legacy Reviewer (issuer#legacy).', user: { login: 'legacy-login' }, commit_id: headSha, submitted_at: '2026-08-28T10:00:00Z' },
          { id: 2, state: 'COMMENT', body: 'Reviewed in Agentic Software Factory by Current Reviewer (issuer#current).', user: { login: 'current-login' }, commit_id: headSha, submitted_at: '2026-08-28T10:01:00Z' },
        ]),
      } as never,
      { getProjectBranchHead: mock(async () => defaultSha) } as never,
      {} as never,
      'https://forgejo.example', 'factory-implementation', { list: mock(async () => [application]), get: mock(async () => application) },
    );

    const projected = await (service as unknown as { project(...args: unknown[]): Promise<{ reviews: Array<{ reviewer: string }> }> })
      .project({ record, application, branch: 'branch', pull, marker: {} }, identity);

    expect(projected.reviews.map((review) => review.reviewer)).toEqual(['Legacy Reviewer', 'Current Reviewer']);
  });
});

function createService(
  store: Record<string, unknown> = {},
  forgejo: Record<string, unknown> = {},
  applications: ApplicationDefinition[] = [application],
): ImplementationService {
  return new ImplementationService(
    {
      tenantId: 'tenant',
      isContributor: mock(async () => false),
      completion: mock(async () => null),
      verification: mock(async () => null),
      reserveCompletion: mock(async (input) => ({ ...input, phase: 'merge-requested' })),
      claimCompletion: mock(async () => 1),
      advanceCompletion: mock(async () => true),
      renewCompletion: mock(async () => true),
      desireVerification: mock(async (input) => ({ ...input, phase: 'desired' })),
      claimVerification: mock(async () => 1),
      retargetVerification: mock(async () => true),
      completeVerification: mock(async () => true),
      retryVerification: mock(async () => undefined),
      retryCompletion: mock(async () => undefined),
      ...store,
    } as never,
    {
      getIssue: mock(async () => ({
        id: 7, number: 7, title: 'Requirement', body: `Body${acceptedMarker(accepted)}`, html_url: 'https://forgejo.example/factory/payments/issues/7',
        state: 'open', labels: [{ id: 1, name: 'status/implementation', color: '', description: '' }], assignee: null,
        user: { login: 'author', full_name: 'Author', avatar_url: '' }, created_at: '2026-08-28T10:00:00Z', updated_at: '2026-08-28T10:00:00Z',
      })),
      forRepository() { return this; },
      verifyAcceptance: mock(async (_issue, acceptance) => acceptance),
      ensureImplementationContributorAccess: mock(async () => undefined),
      ...forgejo,
    } as never,
    { getProjectBranchHead: mock(async () => 'd'.repeat(40)) } as never,
    {} as never,
    'https://forgejo.example',
    'factory-implementation',
    { list: mock(async () => applications), get: mock(async (id: string) => applications.find((item) => item.id === id) ?? null) },
    { reviewActor: 'factory-review', coderTemplate: 'factory-template', workspaceNamespace: 'tenant-workspaces' },
  );
}

function approvedReview(verification: { deliveryId: string; headSha: string; defaultSha: string; workspaceId: string }) {
  return {
    id: 1,
    state: 'APPROVED' as const,
    body: reviewMarker({ ...verification, version: 2, reviewerIssuer: businessIdentity.issuer, reviewerSubject: businessIdentity.subject }),
    user: { login: 'factory-review' },
    commit_id: verification.headSha,
    submitted_at: '2026-08-28T10:00:00Z',
  };
}
