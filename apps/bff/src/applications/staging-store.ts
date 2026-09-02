/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { stagingReconciliation, stagingReconciliationEvent, systemRegistration } from '../db/schema';
import type { CoderWorkspace } from '../integrations/coder';

export interface StagingRecord {
  systemId: string;
  desiredSha: string;
  currentSha: string | null;
  phase: 'pending' | 'provisioning' | 'healthy' | 'retry-wait' | 'failed' | 'deleting';
  health: 'unknown' | 'initializing' | 'healthy' | 'unhealthy';
  workspace: CoderWorkspace | null;
  lastError: string | null;
  attempts: number;
  updatedAt: Date;
}

export type StagingDeletionClaim =
  | { status: 'claimed'; generation: number }
  | { status: 'busy' }
  | { status: 'missing' };

export class StagingStore {
  constructor(private readonly db: Database, private readonly tenantId: string) {}

  async desire(systemId: string, desiredSha: string): Promise<StagingRecord> {
    await this.db.insert(stagingReconciliation).values({ tenantId: this.tenantId, systemId, desiredSha })
      .onConflictDoUpdate({
        target: [stagingReconciliation.tenantId, stagingReconciliation.systemId],
        set: {
          desiredSha,
          currentSha: sql`case when ${stagingReconciliation.phase} = 'deleting' then null else ${stagingReconciliation.currentSha} end`,
          phase: 'pending',
          health: 'unknown',
          workspace: sql`case when ${stagingReconciliation.phase} = 'deleting' then null else ${stagingReconciliation.workspace} end`,
          attempts: sql`case when ${stagingReconciliation.phase} = 'deleting' then 0 else ${stagingReconciliation.attempts} end`,
          lastError: null,
          nextAttemptAt: null,
          leaseOwner: null, leaseExpiresAt: null, leaseGeneration: sql`${stagingReconciliation.leaseGeneration} + 1`, updatedAt: new Date(),
        },
        setWhere: sql`(${stagingReconciliation.phase} = 'deleting' and ${stagingReconciliation.leaseOwner} is null)
          or (${stagingReconciliation.desiredSha} <> ${desiredSha} and ${stagingReconciliation.phase} <> 'deleting')`,
      });
    return (await this.get(systemId))!;
  }

  async get(systemId: string): Promise<StagingRecord | null> {
    const [record] = await this.db.select().from(stagingReconciliation).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
    )).limit(1);
    return record ? project(record) : null;
  }

  async list(): Promise<StagingRecord[]> {
    return (await this.db.select().from(stagingReconciliation).where(eq(stagingReconciliation.tenantId, this.tenantId)))
      .map(project);
  }

  async observeHealthy(systemId: string, desiredSha: string, workspace: CoderWorkspace): Promise<void> {
    await this.db.update(stagingReconciliation).set({ workspace: workspace as unknown as Record<string, unknown>, updatedAt: new Date() }).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId),
      eq(stagingReconciliation.systemId, systemId),
      eq(stagingReconciliation.desiredSha, desiredSha),
      eq(stagingReconciliation.currentSha, desiredSha),
      eq(stagingReconciliation.phase, 'healthy'),
      eq(stagingReconciliation.health, 'healthy'),
    ));
  }

  async retry(systemId: string): Promise<void> {
    const now = new Date();
    await this.db.update(stagingReconciliation).set({
      phase: 'pending', attempts: 0, lastError: null, nextAttemptAt: null,
      leaseOwner: null, leaseExpiresAt: null, leaseGeneration: sql`${stagingReconciliation.leaseGeneration} + 1`, updatedAt: now,
    }).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      inArray(stagingReconciliation.phase, ['pending', 'provisioning', 'healthy', 'retry-wait', 'failed']),
      or(isNull(stagingReconciliation.leaseOwner), lt(stagingReconciliation.leaseExpiresAt, now)),
    ));
  }

  async claim(systemId: string, owner: string, now: Date, leaseMs: number): Promise<number | null> {
    const [record] = await this.db.update(stagingReconciliation).set({
      phase: 'provisioning', health: 'initializing', leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs), leaseGeneration: sql`${stagingReconciliation.leaseGeneration} + 1`,
      attempts: sql`${stagingReconciliation.attempts} + 1`, updatedAt: now,
    }).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      inArray(stagingReconciliation.phase, ['pending', 'provisioning', 'retry-wait', 'failed']),
      or(isNull(stagingReconciliation.leaseOwner), lt(stagingReconciliation.leaseExpiresAt, now)),
      or(isNull(stagingReconciliation.nextAttemptAt), lt(stagingReconciliation.nextAttemptAt, now)),
    )).returning({ generation: stagingReconciliation.leaseGeneration, desiredSha: stagingReconciliation.desiredSha });
    if (!record) return null;
    await this.db.insert(stagingReconciliationEvent).values({ tenantId: this.tenantId, systemId, desiredSha: record.desiredSha, phase: 'provisioning' });
    return record.generation;
  }

  async claimDeletion(systemId: string, owner: string, now: Date, leaseMs: number): Promise<StagingDeletionClaim> {
    const existing = await this.get(systemId);
    if (!existing) {
      const [registration] = await this.db.select({ id: systemRegistration.systemId }).from(systemRegistration).where(and(
        eq(systemRegistration.tenantId, this.tenantId), eq(systemRegistration.systemId, systemId),
      )).limit(1);
      if (!registration) return { status: 'missing' };
    }
    const [created] = await this.db.insert(stagingReconciliation).values({
      tenantId: this.tenantId,
      systemId,
      desiredSha: '',
      phase: 'deleting',
      leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      leaseGeneration: 1,
      updatedAt: now,
    }).onConflictDoNothing().returning({ generation: stagingReconciliation.leaseGeneration });
    if (created) {
      await this.db.insert(stagingReconciliationEvent).values({
        tenantId: this.tenantId, systemId, desiredSha: '', phase: 'deleting',
      });
      return { status: 'claimed', generation: created.generation };
    }
    const [record] = await this.db.update(stagingReconciliation).set({
      phase: 'deleting', health: 'unknown', leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs), leaseGeneration: sql`${stagingReconciliation.leaseGeneration} + 1`,
      nextAttemptAt: null, updatedAt: now,
    }).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      or(isNull(stagingReconciliation.leaseOwner), lt(stagingReconciliation.leaseExpiresAt, now)),
    )).returning({ generation: stagingReconciliation.leaseGeneration, desiredSha: stagingReconciliation.desiredSha });
    if (record) {
      await this.db.insert(stagingReconciliationEvent).values({
        tenantId: this.tenantId, systemId, desiredSha: record.desiredSha, phase: 'deleting',
      });
      return { status: 'claimed', generation: record.generation };
    }
    return await this.get(systemId) ? { status: 'busy' } : { status: 'missing' };
  }

  async renew(systemId: string, owner: string, generation: number, desiredSha: string, now: Date, leaseMs: number): Promise<boolean> {
    const [record] = await this.db.update(stagingReconciliation).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
    }).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      eq(stagingReconciliation.desiredSha, desiredSha), eq(stagingReconciliation.leaseOwner, owner),
      eq(stagingReconciliation.leaseGeneration, generation), sql`${stagingReconciliation.leaseExpiresAt} > ${now.toISOString()}::timestamptz`,
    )).returning({ id: stagingReconciliation.systemId });
    return record !== undefined;
  }

  async renewDeletion(systemId: string, owner: string, generation: number, now: Date, leaseMs: number): Promise<boolean> {
    const [record] = await this.db.update(stagingReconciliation).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now,
    }).where(and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      eq(stagingReconciliation.phase, 'deleting'), eq(stagingReconciliation.leaseOwner, owner),
      eq(stagingReconciliation.leaseGeneration, generation), sql`${stagingReconciliation.leaseExpiresAt} > ${now.toISOString()}::timestamptz`,
    )).returning({ id: stagingReconciliation.systemId });
    return record !== undefined;
  }

  async finishDeletion(systemId: string, owner: string, generation: number): Promise<boolean> {
    const [record] = await this.db.update(stagingReconciliation).set({
      workspace: null, currentSha: null, lastError: null,
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(this.deletionLease(systemId, owner, generation)).returning({ id: stagingReconciliation.systemId });
    return record !== undefined;
  }

  async failDeletion(systemId: string, owner: string, generation: number, error: string): Promise<void> {
    await this.db.update(stagingReconciliation).set({
      phase: 'failed', health: 'unhealthy', lastError: error,
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(this.deletionLease(systemId, owner, generation));
  }

  async succeed(systemId: string, owner: string, generation: number, desiredSha: string, workspace: CoderWorkspace): Promise<boolean> {
    const [record] = await this.db.update(stagingReconciliation).set({
      currentSha: desiredSha, phase: 'healthy', health: 'healthy', workspace: workspace as unknown as Record<string, unknown>,
      lastError: null, nextAttemptAt: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(this.lease(systemId, owner, generation, desiredSha)).returning({ systemId: stagingReconciliation.systemId });
    if (!record) return false;
    await this.db.insert(stagingReconciliationEvent).values({ tenantId: this.tenantId, systemId, desiredSha, phase: 'healthy', detail: { workspaceId: workspace.id } });
    return true;
  }

  async fail(systemId: string, owner: string, generation: number, desiredSha: string, error: string): Promise<boolean> {
    const current = await this.get(systemId);
    const exhausted = (current?.attempts ?? 0) >= 5;
    const nextAttemptAt = new Date(Date.now() + (exhausted ? 5 * 60_000 : 30_000));
    const [record] = await this.db.update(stagingReconciliation).set({
      phase: exhausted ? 'failed' : 'retry-wait', health: 'unhealthy', lastError: error, nextAttemptAt,
      leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(this.lease(systemId, owner, generation, desiredSha)).returning({ systemId: stagingReconciliation.systemId });
    if (!record) return false;
    await this.db.insert(stagingReconciliationEvent).values({ tenantId: this.tenantId, systemId, desiredSha, phase: exhausted ? 'failed' : 'retry-wait', detail: { error, nextAttemptAt: nextAttemptAt.toISOString() } });
    return true;
  }

  private lease(systemId: string, owner: string, generation: number, desiredSha: string) {
    return and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      eq(stagingReconciliation.desiredSha, desiredSha), eq(stagingReconciliation.leaseOwner, owner),
      eq(stagingReconciliation.leaseGeneration, generation), sql`${stagingReconciliation.leaseExpiresAt} > now()`,
    );
  }

  private deletionLease(systemId: string, owner: string, generation: number) {
    return and(
      eq(stagingReconciliation.tenantId, this.tenantId), eq(stagingReconciliation.systemId, systemId),
      eq(stagingReconciliation.phase, 'deleting'), eq(stagingReconciliation.leaseOwner, owner),
      eq(stagingReconciliation.leaseGeneration, generation), sql`${stagingReconciliation.leaseExpiresAt} > now()`,
    );
  }
}

function project(record: typeof stagingReconciliation.$inferSelect): StagingRecord {
  return {
    systemId: record.systemId, desiredSha: record.desiredSha, currentSha: record.currentSha,
    phase: record.phase as StagingRecord['phase'], health: record.health as StagingRecord['health'],
    workspace: record.workspace as unknown as CoderWorkspace | null, lastError: record.lastError,
    attempts: record.attempts, updatedAt: record.updatedAt,
  };
}
