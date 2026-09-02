/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../db';
import { delivery, deliveryCompletion, deliveryContributor, deliveryLifecycleEvent, deliveryVerification, operation, user } from '../db/schema';

export type DeliveryRecord = typeof delivery.$inferSelect;
export type DeliveryContributorRecord = typeof deliveryContributor.$inferSelect;
export type OperationRecord = typeof operation.$inferSelect;
export type DeliveryCompletionRecord = typeof deliveryCompletion.$inferSelect;
export type DeliveryVerificationRecord = typeof deliveryVerification.$inferSelect;

const ACTIVE_OPERATION_STATES = ['pending', 'running', 'ambiguous', 'succeeded'] as const;

export function deliveryBranchName(record: Pick<DeliveryRecord, 'id' | 'requirementNumber'>): string {
  return `factory/requirement-${record.requirementNumber}-${record.id.slice(-12)}`;
}

export class ImplementationStore {
  constructor(private readonly db: Database, readonly tenantId: string) {}

  async reserveDelivery(input: Omit<typeof delivery.$inferInsert, 'tenantId'>): Promise<{ delivery: DeliveryRecord; created: boolean }> {
    const [created] = await this.db.insert(delivery).values({ ...input, tenantId: this.tenantId }).onConflictDoNothing().returning();
    if (created) return { delivery: created, created: true };
    const [existing] = await this.db.select().from(delivery).where(and(
      eq(delivery.tenantId, this.tenantId),
      eq(delivery.systemId, input.systemId),
      eq(delivery.requirementNumber, input.requirementNumber),
      eq(delivery.acceptedDigest, input.acceptedDigest),
    )).limit(1);
    if (!existing) throw new Error('delivery reservation conflicted with another identity');
    if (existing.id !== input.id) throw new Error('delivery identity is not deterministic');
    return { delivery: existing, created: false };
  }

  async get(id: string): Promise<DeliveryRecord> {
    const [record] = await this.db.select().from(delivery).where(and(
      eq(delivery.id, id),
      eq(delivery.tenantId, this.tenantId),
    )).limit(1);
    if (!record) throw Object.assign(new Error('implementation run not found'), { status: 404 });
    return record;
  }

  list(requirementNumber: number, systemId?: string): Promise<DeliveryRecord[]> {
    return this.db.select().from(delivery).where(and(
      eq(delivery.tenantId, this.tenantId),
      eq(delivery.requirementNumber, requirementNumber),
      ...(systemId ? [eq(delivery.systemId, systemId)] : []),
    )).orderBy(desc(delivery.createdAt), desc(delivery.id));
  }

  async addContributor(deliveryId: string, factoryUserId: string): Promise<DeliveryContributorRecord> {
    const [created] = await this.db.insert(deliveryContributor).values({ deliveryId, factoryUserId }).onConflictDoNothing().returning();
    if (created) return created;
    const existing = await this.contributor(deliveryId, factoryUserId);
    if (!existing) throw new Error('delivery contributor was not recorded');
    return existing;
  }

  async withActiveContributorGrant<T>(factoryUserId: string, grant: () => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx.select({ id: user.id }).from(user).where(and(
        eq(user.id, factoryUserId),
        isNull(user.deprovisionedAt),
      )).limit(1).for('key share');
      if (!record) throw Object.assign(new Error('Factory user is deprovisioned'), { status: 403 });
      return grant();
    });
  }

  async contributor(deliveryId: string, factoryUserId: string): Promise<DeliveryContributorRecord | null> {
    const [record] = await this.db.select().from(deliveryContributor).innerJoin(delivery, eq(delivery.id, deliveryContributor.deliveryId)).where(and(
      eq(deliveryContributor.deliveryId, deliveryId),
      eq(deliveryContributor.factoryUserId, factoryUserId),
      eq(delivery.tenantId, this.tenantId),
    )).limit(1);
    return record?.delivery_contributor ?? null;
  }

  async contributors(deliveryId: string): Promise<DeliveryContributorRecord[]> {
    const rows = await this.db.select().from(deliveryContributor).innerJoin(delivery, eq(delivery.id, deliveryContributor.deliveryId)).where(and(
      eq(deliveryContributor.deliveryId, deliveryId),
      eq(delivery.tenantId, this.tenantId),
    )).orderBy(asc(deliveryContributor.createdAt), asc(deliveryContributor.factoryUserId));
    return rows.map((row) => row.delivery_contributor);
  }

  async contributorIdentities(deliveryId: string): Promise<Array<DeliveryContributorRecord & { username: string }>> {
    const rows = await this.db.select({ contributor: deliveryContributor, username: user.preferredUsername })
      .from(deliveryContributor)
      .innerJoin(delivery, eq(delivery.id, deliveryContributor.deliveryId))
      .innerJoin(user, eq(user.id, deliveryContributor.factoryUserId))
      .where(and(eq(deliveryContributor.deliveryId, deliveryId), eq(delivery.tenantId, this.tenantId)))
      .orderBy(asc(deliveryContributor.createdAt), asc(deliveryContributor.factoryUserId));
    return rows.map((row) => ({ ...row.contributor, username: row.username }));
  }

  async isContributor(deliveryId: string, factoryUserId: string): Promise<boolean> {
    return (await this.contributor(deliveryId, factoryUserId)) !== null;
  }

  async reserveOperation(deliveryId: string, factoryUserId: string, kind: string): Promise<OperationRecord> {
    return this.db.transaction(async (tx) => {
      const lockKey = `${deliveryId}\n${kind}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const [active] = await tx.select().from(operation).where(and(
        eq(operation.deliveryId, deliveryId),
        eq(operation.kind, kind),
        inArray(operation.state, ACTIVE_OPERATION_STATES),
      )).orderBy(desc(operation.createdAt), desc(operation.idempotencyKey)).limit(1);
      if (active) return active;
      const idempotencyKey = `operation_${crypto.randomUUID().replaceAll('-', '')}`;
      const [created] = await tx.insert(operation).values({ idempotencyKey, deliveryId, factoryUserId, kind }).returning();
      if (!created) throw new Error('operation was not reserved');
      return created;
    });
  }

  async operation(idempotencyKey: string): Promise<OperationRecord> {
    const [record] = await this.db.select().from(operation).innerJoin(delivery, eq(delivery.id, operation.deliveryId)).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      eq(delivery.tenantId, this.tenantId),
    )).limit(1);
    if (!record) throw Object.assign(new Error('implementation operation not found'), { status: 404 });
    return record.operation;
  }

  async activeOperation(deliveryId: string, kind: string): Promise<OperationRecord | null> {
    const [record] = await this.db.select().from(operation).innerJoin(delivery, eq(delivery.id, operation.deliveryId)).where(and(
      eq(operation.deliveryId, deliveryId),
      eq(operation.kind, kind),
      eq(delivery.tenantId, this.tenantId),
      inArray(operation.state, ACTIVE_OPERATION_STATES),
    )).orderBy(desc(operation.createdAt), desc(operation.idempotencyKey)).limit(1);
    return record?.operation ?? null;
  }

  async operations(deliveryId: string): Promise<OperationRecord[]> {
    const rows = await this.db.select().from(operation).innerJoin(delivery, eq(delivery.id, operation.deliveryId)).where(and(
      eq(operation.deliveryId, deliveryId),
      eq(delivery.tenantId, this.tenantId),
      eq(operation.kind, 'coder-chat-create'),
    )).orderBy(asc(operation.createdAt), asc(operation.idempotencyKey));
    return rows.map((row) => row.operation);
  }

  async reconcilableOperations(): Promise<OperationRecord[]> {
    const rows = await this.db.select().from(operation).innerJoin(delivery, eq(delivery.id, operation.deliveryId)).where(and(
      eq(delivery.tenantId, this.tenantId),
      eq(operation.kind, 'coder-chat-create'),
      or(
        inArray(operation.state, ['pending', 'running', 'ambiguous']),
        and(eq(operation.state, 'succeeded'), isNull(operation.error), sql`${operation.externalId} is not null`),
      ),
    )).orderBy(asc(operation.createdAt), asc(operation.idempotencyKey));
    return rows.map((row) => row.operation);
  }

  async claimOperation(idempotencyKey: string, owner: string, now = new Date(), leaseMs = 5 * 60_000): Promise<boolean> {
    const [claimed] = await this.db.update(operation).set({
      state: 'running',
      leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      sql`exists (select 1 from ${delivery} d where d.id = ${operation.deliveryId} and d.tenant_id = ${this.tenantId})`,
      or(
        eq(operation.state, 'pending'),
        and(inArray(operation.state, ['running', 'ambiguous']), or(isNull(operation.leaseExpiresAt), lte(operation.leaseExpiresAt, now))),
      ),
    )).returning({ id: operation.idempotencyKey });
    return claimed !== undefined;
  }

  async renewOperation(idempotencyKey: string, owner: string, now = new Date(), leaseMs = 5 * 60_000): Promise<boolean> {
    const [renewed] = await this.db.update(operation).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      sql`exists (select 1 from ${delivery} d where d.id = ${operation.deliveryId} and d.tenant_id = ${this.tenantId})`,
      eq(operation.state, 'running'),
      eq(operation.leaseOwner, owner),
      sql`${operation.leaseExpiresAt} > ${now.toISOString()}::timestamptz`,
    )).returning({ id: operation.idempotencyKey });
    return renewed !== undefined;
  }

  markOperationAmbiguous(idempotencyKey: string, owner: string, error: string): Promise<boolean> {
    return this.finishOperation(idempotencyKey, owner, { state: 'ambiguous', externalId: null, error });
  }

  markOperationFailed(idempotencyKey: string, owner: string, error: string): Promise<boolean> {
    return this.finishOperation(idempotencyKey, owner, { state: 'failed', externalId: null, error });
  }

  markOperationSucceeded(idempotencyKey: string, owner: string, externalId: string): Promise<boolean> {
    return this.finishOperation(idempotencyKey, owner, { state: 'succeeded', externalId, error: null });
  }

  async markOperationPostStarted(idempotencyKey: string, owner: string): Promise<boolean> {
    const [updated] = await this.db.update(operation).set({ error: 'coder-post-started', updatedAt: new Date() }).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      sql`exists (select 1 from ${delivery} d where d.id = ${operation.deliveryId} and d.tenant_id = ${this.tenantId})`,
      eq(operation.state, 'running'),
      eq(operation.leaseOwner, owner),
    )).returning({ id: operation.idempotencyKey });
    return updated !== undefined;
  }

  async retireOperation(idempotencyKey: string, error: string): Promise<void> {
    await this.db.update(operation).set({ state: 'failed', error, updatedAt: new Date() }).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      sql`exists (select 1 from ${delivery} d where d.id = ${operation.deliveryId} and d.tenant_id = ${this.tenantId})`,
      eq(operation.state, 'succeeded'),
    ));
  }

  async markOperationChatTerminal(idempotencyKey: string): Promise<void> {
    await this.db.update(operation).set({ error: 'coder-chat-terminal', updatedAt: new Date() }).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      sql`exists (select 1 from ${delivery} d where d.id = ${operation.deliveryId} and d.tenant_id = ${this.tenantId})`,
      eq(operation.state, 'succeeded'),
      isNull(operation.error),
    ));
  }

  async touchDelivery(id: string): Promise<void> {
    await this.db.update(delivery).set({ updatedAt: new Date() }).where(and(eq(delivery.id, id), eq(delivery.tenantId, this.tenantId)));
  }

  async reserveCompletion(input: { deliveryId: string; reviewedHeadSha: string; reviewedDefaultSha: string; verificationWorkspaceId: string }): Promise<DeliveryCompletionRecord> {
    await this.db.insert(deliveryCompletion).values(input).onConflictDoNothing();
    const [record] = await this.db.select().from(deliveryCompletion).innerJoin(delivery, eq(delivery.id, deliveryCompletion.deliveryId)).where(and(
      eq(deliveryCompletion.deliveryId, input.deliveryId), eq(delivery.tenantId, this.tenantId),
    )).limit(1);
    if (!record) throw new Error('delivery completion reservation failed');
    if (record.delivery_completion.reviewedHeadSha !== input.reviewedHeadSha || record.delivery_completion.reviewedDefaultSha !== input.reviewedDefaultSha) {
      throw Object.assign(new Error('delivery completion is already bound to different review evidence'), { status: 409 });
    }
    return record.delivery_completion;
  }

  async claimCompletion(deliveryId: string, owner: string, now = new Date(), leaseMs = 15 * 60_000): Promise<number | null> {
    const [record] = await this.db.update(deliveryCompletion).set({
      leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + leaseMs),
      leaseGeneration: sql`${deliveryCompletion.leaseGeneration} + 1`, attempts: sql`${deliveryCompletion.attempts} + 1`, updatedAt: now,
    }).where(and(
      eq(deliveryCompletion.deliveryId, deliveryId),
      sql`exists (select 1 from ${delivery} d where d.id = ${deliveryCompletion.deliveryId} and d.tenant_id = ${this.tenantId})`,
      or(isNull(deliveryCompletion.leaseOwner), lte(deliveryCompletion.leaseExpiresAt, now)),
      or(isNull(deliveryCompletion.nextAttemptAt), lte(deliveryCompletion.nextAttemptAt, now)),
    )).returning({ generation: deliveryCompletion.leaseGeneration });
    return record?.generation ?? null;
  }

  async advanceCompletion(deliveryId: string, owner: string, generation: number, phase: DeliveryCompletionRecord['phase'], fields: { mergedSha?: string; error?: string | null } = {}): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [record] = await tx.update(deliveryCompletion).set({
        phase, lastError: fields.error ?? null, nextAttemptAt: null,
        ...(fields.mergedSha ? { mergedSha: fields.mergedSha, mergedAt: now } : {}),
        ...(phase === 'complete' ? { completedAt: now } : {}),
        ...(phase === 'complete' ? { leaseOwner: null, leaseExpiresAt: null } : {}),
        updatedAt: now,
      }).where(and(
        eq(deliveryCompletion.deliveryId, deliveryId), eq(deliveryCompletion.leaseOwner, owner),
        eq(deliveryCompletion.leaseGeneration, generation), sql`${deliveryCompletion.leaseExpiresAt} > now()`,
      )).returning({ id: deliveryCompletion.deliveryId });
      if (!record) return false;
      await tx.insert(deliveryLifecycleEvent).values({ deliveryId, kind: 'completion', phase, detail: fields });
      return true;
    });
  }

  async renewCompletion(deliveryId: string, owner: string, generation: number, now = new Date(), leaseMs = 15 * 60_000): Promise<boolean> {
    const [record] = await this.db.update(deliveryCompletion).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
    }).where(and(
      eq(deliveryCompletion.deliveryId, deliveryId), eq(deliveryCompletion.leaseOwner, owner),
      eq(deliveryCompletion.leaseGeneration, generation), sql`${deliveryCompletion.leaseExpiresAt} > ${now.toISOString()}::timestamptz`,
    )).returning({ id: deliveryCompletion.deliveryId });
    return record !== undefined;
  }

  async retryCompletion(deliveryId: string, owner: string, generation: number, error: string): Promise<void> {
    const current = await this.completion(deliveryId);
    const exhausted = (current?.attempts ?? 0) >= 5;
    await this.db.update(deliveryCompletion).set({
      phase: exhausted ? 'repair' : 'retry-wait', lastError: error, nextAttemptAt: exhausted ? null : new Date(Date.now() + 30_000),
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(and(eq(deliveryCompletion.deliveryId, deliveryId), eq(deliveryCompletion.leaseOwner, owner), eq(deliveryCompletion.leaseGeneration, generation)));
  }

  async completion(deliveryId: string): Promise<DeliveryCompletionRecord | null> {
    const [record] = await this.db.select().from(deliveryCompletion).innerJoin(delivery, eq(delivery.id, deliveryCompletion.deliveryId)).where(and(
      eq(deliveryCompletion.deliveryId, deliveryId), eq(delivery.tenantId, this.tenantId),
    )).limit(1);
    return record?.delivery_completion ?? null;
  }

  async reconcilableCompletions(): Promise<DeliveryCompletionRecord[]> {
    const now = new Date();
    const rows = await this.db.select().from(deliveryCompletion).innerJoin(delivery, eq(delivery.id, deliveryCompletion.deliveryId)).where(and(
      eq(delivery.tenantId, this.tenantId), inArray(deliveryCompletion.phase, ['merge-requested', 'merged', 'cleanup-pending', 'card-transition-pending', 'retry-wait']),
      or(isNull(deliveryCompletion.leaseOwner), lte(deliveryCompletion.leaseExpiresAt, now)),
      or(isNull(deliveryCompletion.nextAttemptAt), lte(deliveryCompletion.nextAttemptAt, now)),
    )).orderBy(asc(deliveryCompletion.updatedAt));
    return rows.map((row) => row.delivery_completion);
  }

  async desireVerification(input: { deliveryId: string; requestedByUserId: string; desiredHeadSha: string; desiredDefaultSha: string }): Promise<DeliveryVerificationRecord> {
    await this.db.insert(deliveryVerification).values(input).onConflictDoUpdate({
      target: deliveryVerification.deliveryId,
      set: {
        requestedByUserId: input.requestedByUserId, desiredHeadSha: input.desiredHeadSha, desiredDefaultSha: input.desiredDefaultSha,
        phase: 'desired', health: 'unknown', workspaceId: null, lastError: null, nextAttemptAt: null,
        leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
      },
      setWhere: sql`(${deliveryVerification.desiredHeadSha} <> ${input.desiredHeadSha} or ${deliveryVerification.desiredDefaultSha} <> ${input.desiredDefaultSha}) and (${deliveryVerification.leaseOwner} is null or ${deliveryVerification.leaseExpiresAt} <= now())`,
    });
    const record = await this.verification(input.deliveryId);
    if (!record) throw new Error('delivery verification reservation failed');
    return record;
  }

  async verification(deliveryId: string): Promise<DeliveryVerificationRecord | null> {
    const [record] = await this.db.select().from(deliveryVerification).innerJoin(delivery, eq(delivery.id, deliveryVerification.deliveryId)).where(and(
      eq(deliveryVerification.deliveryId, deliveryId), eq(delivery.tenantId, this.tenantId),
    )).limit(1);
    return record?.delivery_verification ?? null;
  }

  async reconcilableVerifications(): Promise<DeliveryVerificationRecord[]> {
    const now = new Date();
    const rows = await this.db.select().from(deliveryVerification).innerJoin(delivery, eq(delivery.id, deliveryVerification.deliveryId)).where(and(
      eq(delivery.tenantId, this.tenantId),
      inArray(deliveryVerification.phase, ['desired', 'provisioning', 'retry-wait']),
      or(isNull(deliveryVerification.leaseOwner), lte(deliveryVerification.leaseExpiresAt, now)),
      or(isNull(deliveryVerification.nextAttemptAt), lte(deliveryVerification.nextAttemptAt, now)),
    )).orderBy(asc(deliveryVerification.updatedAt));
    return rows.map((row) => row.delivery_verification);
  }

  async resetVerification(deliveryId: string): Promise<void> {
    await this.db.update(deliveryVerification).set({ phase: 'desired', attempts: 0, lastError: null, nextAttemptAt: null, updatedAt: new Date() }).where(and(
      eq(deliveryVerification.deliveryId, deliveryId), eq(deliveryVerification.phase, 'repair'),
      sql`exists (select 1 from ${delivery} d where d.id = ${deliveryVerification.deliveryId} and d.tenant_id = ${this.tenantId})`,
    ));
  }

  async resetCompletion(deliveryId: string): Promise<void> {
    await this.db.update(deliveryCompletion).set({ phase: 'retry-wait', attempts: 0, lastError: null, nextAttemptAt: new Date(), updatedAt: new Date() }).where(and(
      eq(deliveryCompletion.deliveryId, deliveryId), eq(deliveryCompletion.phase, 'repair'),
      sql`exists (select 1 from ${delivery} d where d.id = ${deliveryCompletion.deliveryId} and d.tenant_id = ${this.tenantId})`,
    ));
  }

  async claimVerification(deliveryId: string, owner: string, now = new Date(), leaseMs = 15 * 60_000): Promise<number | null> {
    const [record] = await this.db.update(deliveryVerification).set({
      phase: 'provisioning', health: 'initializing', leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs), leaseGeneration: sql`${deliveryVerification.leaseGeneration} + 1`,
      attempts: sql`${deliveryVerification.attempts} + 1`, updatedAt: now,
    }).where(and(
      eq(deliveryVerification.deliveryId, deliveryId),
      sql`exists (select 1 from ${delivery} d where d.id = ${deliveryVerification.deliveryId} and d.tenant_id = ${this.tenantId})`,
      or(isNull(deliveryVerification.leaseOwner), lte(deliveryVerification.leaseExpiresAt, now)),
      or(isNull(deliveryVerification.nextAttemptAt), lte(deliveryVerification.nextAttemptAt, now)),
    )).returning({ generation: deliveryVerification.leaseGeneration });
    return record?.generation ?? null;
  }

  async retargetVerification(deliveryId: string, owner: string, generation: number, requestedByUserId: string, headSha: string, defaultSha: string): Promise<boolean> {
    const [record] = await this.db.update(deliveryVerification).set({
      requestedByUserId, desiredHeadSha: headSha, desiredDefaultSha: defaultSha, updatedAt: new Date(),
    }).where(and(
      eq(deliveryVerification.deliveryId, deliveryId), eq(deliveryVerification.leaseOwner, owner),
      eq(deliveryVerification.leaseGeneration, generation), sql`${deliveryVerification.leaseExpiresAt} > now()`,
    )).returning({ id: deliveryVerification.deliveryId });
    return record !== undefined;
  }

  async renewVerification(deliveryId: string, owner: string, generation: number, now = new Date(), leaseMs = 15 * 60_000): Promise<boolean> {
    const [record] = await this.db.update(deliveryVerification).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
    }).where(and(
      eq(deliveryVerification.deliveryId, deliveryId), eq(deliveryVerification.leaseOwner, owner),
      eq(deliveryVerification.leaseGeneration, generation), sql`${deliveryVerification.leaseExpiresAt} > ${now.toISOString()}::timestamptz`,
    )).returning({ id: deliveryVerification.deliveryId });
    return record !== undefined;
  }

  async completeVerification(deliveryId: string, owner: string, generation: number, headSha: string, workspaceId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx.update(deliveryVerification).set({
        currentHeadSha: headSha, workspaceId, phase: 'healthy', health: 'healthy', lastError: null,
        leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, updatedAt: new Date(),
      }).where(this.verificationLease(deliveryId, owner, generation, headSha)).returning({ id: deliveryVerification.deliveryId });
      if (!record) return false;
      await tx.insert(deliveryLifecycleEvent).values({ deliveryId, kind: 'verification', phase: 'healthy', detail: { headSha, workspaceId } });
      return true;
    });
  }

  async retryVerification(deliveryId: string, owner: string, generation: number, headSha: string, error: string): Promise<void> {
    const current = await this.verification(deliveryId);
    const exhausted = (current?.attempts ?? 0) >= 5;
    await this.db.update(deliveryVerification).set({
      phase: exhausted ? 'repair' : 'retry-wait', health: 'unhealthy', lastError: error, nextAttemptAt: exhausted ? null : new Date(Date.now() + 30_000),
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(this.verificationLease(deliveryId, owner, generation, headSha));
  }

  private verificationLease(deliveryId: string, owner: string, generation: number, headSha: string) {
    return and(
      eq(deliveryVerification.deliveryId, deliveryId), eq(deliveryVerification.desiredHeadSha, headSha),
      eq(deliveryVerification.leaseOwner, owner), eq(deliveryVerification.leaseGeneration, generation),
      sql`${deliveryVerification.leaseExpiresAt} > now()`,
    );
  }

  private async finishOperation(
    idempotencyKey: string,
    owner: string,
    values: Pick<OperationRecord, 'state' | 'externalId' | 'error'>,
  ): Promise<boolean> {
    const [updated] = await this.db.update(operation).set({
      ...values,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(operation.idempotencyKey, idempotencyKey),
      sql`exists (select 1 from ${delivery} d where d.id = ${operation.deliveryId} and d.tenant_id = ${this.tenantId})`,
      eq(operation.state, 'running'),
      eq(operation.leaseOwner, owner),
    )).returning({ id: operation.idempotencyKey });
    return updated !== undefined;
  }
}
