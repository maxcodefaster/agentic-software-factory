/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { OnboardingPhase } from '@agentic-software-factory/api-contracts/applications';

import type { Database } from '../db';
import { systemOnboarding, systemOnboardingEvent, systemRegistration } from '../db/schema';
import type { CompatibilityIssue } from './system-contract';

export type { OnboardingPhase };

export interface OnboardingRecord {
  systemId: string;
  team: string;
  targetTeam: string | null;
  repositoryOwner: string;
  repositoryName: string;
  phase: OnboardingPhase;
  targetSha: string | null;
  contractVersion: number | null;
  compatibilityIssues: CompatibilityIssue[];
  policyPlan: Record<string, unknown> | null;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  updatedAt: Date;
}

export interface OnboardingLifecycleStore {
  reserve(input: { systemId: string; team: string; repositoryOwner: string; repositoryName: string }): Promise<OnboardingRecord>;
  get(systemId: string): Promise<OnboardingRecord | null>;
  list(): Promise<OnboardingRecord[]>;
  claim(systemId: string, owner: string, now: Date, leaseMs: number): Promise<number | null>;
  renew(systemId: string, owner: string, generation: number, now: Date, leaseMs: number): Promise<boolean>;
  advance(systemId: string, owner: string, generation: number, phase: OnboardingPhase, detail?: Record<string, unknown>, fields?: { targetSha?: string; contractVersion?: number; compatibilityIssues?: CompatibilityIssue[] }): Promise<void>;
  policyPlan(systemId: string, owner: string, generation: number, plan: Record<string, unknown>): Promise<void>;
  fail(systemId: string, owner: string, generation: number, phase: 'retry-wait' | 'repair' | 'failed' | 'reassigning' | 'reassigning-access' | 'unregistering', error: string, issues?: CompatibilityIssue[], nextAttemptAt?: Date): Promise<void>;
  release(systemId: string, owner: string, generation: number): Promise<void>;
  events(systemId: string): Promise<Array<{ phase: OnboardingPhase; detail: Record<string, unknown>; createdAt: Date }>>;
  reassign(systemId: string, team: string): Promise<void>;
  finishReassignment(systemId: string, owner: string, generation: number): Promise<void>;
  unregister(systemId: string): Promise<void>;
  remove(systemId: string, owner: string, generation: number): Promise<void>;
  retry(systemId: string): Promise<void>;
}

export class DatabaseOnboardingLifecycleStore implements OnboardingLifecycleStore {
  constructor(private readonly db: Database, private readonly tenantId: string) {}

  async reserve(input: { systemId: string; team: string; repositoryOwner: string; repositoryName: string }): Promise<OnboardingRecord> {
    await this.db.insert(systemOnboarding).values({
      tenantId: this.tenantId,
      systemId: input.systemId,
      teamId: input.team,
      forgejoOwner: input.repositoryOwner,
      forgejoRepository: input.repositoryName,
    }).onConflictDoNothing();
    let record = await this.get(input.systemId);
    if (!record) throw new Error('System onboarding reservation conflicted');
    if (record.phase === 'removed') {
      const [reactivated] = await this.db.update(systemOnboarding).set({
        teamId: input.team,
        targetTeamId: null,
        forgejoOwner: input.repositoryOwner,
        forgejoRepository: input.repositoryName,
        phase: 'validating',
        targetSha: null,
        contractVersion: null,
        compatibilityIssues: [],
        policyPlan: null,
        lastError: null,
        attempts: 0,
        nextAttemptAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId),
        eq(systemOnboarding.systemId, input.systemId),
        eq(systemOnboarding.phase, 'removed'),
        isNull(systemOnboarding.leaseOwner),
      )).returning({ id: systemOnboarding.systemId });
      if (!reactivated) throw Object.assign(new Error('System onboarding is busy'), { status: 409 });
      record = (await this.get(input.systemId))!;
    }
    if (record.team !== input.team) throw Object.assign(new Error('System is already assigned to another team'), { status: 409 });
    return record;
  }

  async get(systemId: string): Promise<OnboardingRecord | null> {
    const [record] = await this.db.select().from(systemOnboarding).where(and(
      eq(systemOnboarding.tenantId, this.tenantId),
      eq(systemOnboarding.systemId, systemId),
    )).limit(1);
    return record ? toRecord(record) : null;
  }

  async list(): Promise<OnboardingRecord[]> {
    const records = await this.db.select().from(systemOnboarding)
      .where(eq(systemOnboarding.tenantId, this.tenantId))
      .orderBy(asc(systemOnboarding.updatedAt));
    return records.map(toRecord);
  }

  async claim(systemId: string, owner: string, now: Date, leaseMs: number): Promise<number | null> {
    const [claimed] = await this.db.update(systemOnboarding).set({
      leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      attempts: sql`${systemOnboarding.attempts} + 1`,
      leaseGeneration: sql`${systemOnboarding.leaseGeneration} + 1`,
      updatedAt: now,
    }).where(and(
      eq(systemOnboarding.tenantId, this.tenantId),
      eq(systemOnboarding.systemId, systemId),
      or(isNull(systemOnboarding.leaseOwner), lt(systemOnboarding.leaseExpiresAt, now)),
    )).returning({ generation: systemOnboarding.leaseGeneration });
    return claimed?.generation ?? null;
  }

  async renew(systemId: string, owner: string, generation: number, now: Date, leaseMs: number): Promise<boolean> {
    const [renewed] = await this.db.update(systemOnboarding).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(and(
      eq(systemOnboarding.tenantId, this.tenantId),
      eq(systemOnboarding.systemId, systemId),
      eq(systemOnboarding.leaseOwner, owner),
      eq(systemOnboarding.leaseGeneration, generation),
      gt(systemOnboarding.leaseExpiresAt, now),
    )).returning({ systemId: systemOnboarding.systemId });
    return renewed?.systemId === systemId;
  }

  async advance(
    systemId: string,
    owner: string,
    generation: number,
    phase: OnboardingPhase,
    detail: Record<string, unknown> = {},
    fields: { targetSha?: string; contractVersion?: number; compatibilityIssues?: CompatibilityIssue[] } = {},
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx.update(systemOnboarding).set({
        phase,
        lastError: null,
        ...(fields.compatibilityIssues ? { compatibilityIssues: fields.compatibilityIssues } : {}),
        nextAttemptAt: null,
        ...(fields.targetSha ? { targetSha: fields.targetSha } : {}),
        ...(fields.contractVersion ? { contractVersion: fields.contractVersion } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId),
        eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.leaseOwner, owner),
        eq(systemOnboarding.leaseGeneration, generation),
        sql`${systemOnboarding.leaseExpiresAt} > now()`,
      )).returning({ systemId: systemOnboarding.systemId });
      if (!updated) throw new Error('System onboarding lease was lost');
      await tx.insert(systemOnboardingEvent).values({ tenantId: this.tenantId, systemId, phase, detail });
    });
  }

  async fail(systemId: string, owner: string, generation: number, phase: 'retry-wait' | 'repair' | 'failed' | 'reassigning' | 'reassigning-access' | 'unregistering', error: string, issues: CompatibilityIssue[] = [], nextAttemptAt?: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select({ attempts: systemOnboarding.attempts }).from(systemOnboarding).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.leaseOwner, owner), eq(systemOnboarding.leaseGeneration, generation),
      )).limit(1);
      const finalPhase = phase === 'retry-wait' && (current?.attempts ?? 0) >= 5 ? 'repair' : phase;
      const retrying = ['retry-wait', 'reassigning', 'reassigning-access', 'unregistering'].includes(finalPhase);
      const [updated] = await tx.update(systemOnboarding).set({
        phase: finalPhase, lastError: error, compatibilityIssues: issues, nextAttemptAt: retrying ? nextAttemptAt ?? null : null,
        leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId),
        eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.leaseOwner, owner),
        eq(systemOnboarding.leaseGeneration, generation),
        sql`${systemOnboarding.leaseExpiresAt} > now()`,
      )).returning({ systemId: systemOnboarding.systemId });
      if (!updated) throw new Error('System onboarding lease was lost');
      await tx.insert(systemOnboardingEvent).values({ tenantId: this.tenantId, systemId, phase: finalPhase, detail: { error, issues, nextAttemptAt: retrying ? nextAttemptAt?.toISOString() : undefined } });
    });
  }

  async policyPlan(systemId: string, owner: string, generation: number, plan: Record<string, unknown>): Promise<void> {
    const [record] = await this.db.update(systemOnboarding).set({ policyPlan: plan, updatedAt: new Date() }).where(and(
      eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
      eq(systemOnboarding.leaseOwner, owner), eq(systemOnboarding.leaseGeneration, generation),
      sql`${systemOnboarding.leaseExpiresAt} > now()`,
    )).returning({ id: systemOnboarding.systemId });
    if (!record) throw new Error('System onboarding lease was lost');
  }

  async release(systemId: string, owner: string, generation: number): Promise<void> {
    await this.db.update(systemOnboarding).set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(
      eq(systemOnboarding.tenantId, this.tenantId),
      eq(systemOnboarding.systemId, systemId),
      eq(systemOnboarding.leaseOwner, owner),
      eq(systemOnboarding.leaseGeneration, generation),
    ));
  }

  async events(systemId: string) {
    const records = await this.db.select().from(systemOnboardingEvent).where(and(
      eq(systemOnboardingEvent.tenantId, this.tenantId),
      eq(systemOnboardingEvent.systemId, systemId),
    )).orderBy(asc(systemOnboardingEvent.id));
    return records.map((record) => ({ phase: record.phase as OnboardingPhase, detail: record.detail, createdAt: record.createdAt }));
  }

  async reassign(systemId: string, team: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select({ team: systemOnboarding.teamId, targetTeam: systemOnboarding.targetTeamId, phase: systemOnboarding.phase })
        .from(systemOnboarding).where(and(eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId))).limit(1);
      if (!current) throw Object.assign(new Error('System was not found'), { status: 404 });
      if (current.phase === 'ready' && current.team === team) return;
      if (current.phase !== 'ready' && !(['reassigning', 'reassigning-access'].includes(current.phase) && current.targetTeam === team)) {
        throw Object.assign(new Error('System has another lifecycle transition in progress'), { status: 409 });
      }
      if (current.phase !== 'ready') return;
      const [record] = await tx.update(systemOnboarding).set({
        phase: 'reassigning', targetTeamId: team, lastError: null, nextAttemptAt: null,
        ...(current.phase === 'ready' ? { attempts: 0 } : {}), updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.phase, current.phase), isNull(systemOnboarding.leaseOwner),
      )).returning({ id: systemOnboarding.systemId });
      if (!record) throw Object.assign(new Error('System onboarding is busy or was not found'), { status: 409 });
      await tx.insert(systemOnboardingEvent).values({ tenantId: this.tenantId, systemId, phase: 'reassigning', detail: { action: 'reassign', from: current.team, to: team } });
    });
  }

  async finishReassignment(systemId: string, owner: string, generation: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select({ targetTeam: systemOnboarding.targetTeamId }).from(systemOnboarding).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.leaseOwner, owner), eq(systemOnboarding.leaseGeneration, generation),
        eq(systemOnboarding.phase, 'reassigning-access'), sql`${systemOnboarding.leaseExpiresAt} > now()`,
      )).limit(1);
      if (!current?.targetTeam) throw new Error('System onboarding lease was lost');
      await tx.update(systemRegistration).set({ teamId: current.targetTeam, updatedAt: new Date() }).where(and(
        eq(systemRegistration.tenantId, this.tenantId), eq(systemRegistration.systemId, systemId),
      ));
      const [updated] = await tx.update(systemOnboarding).set({
        teamId: current.targetTeam, targetTeamId: null, phase: 'ready', lastError: null, nextAttemptAt: null,
        leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.leaseOwner, owner), eq(systemOnboarding.leaseGeneration, generation),
        eq(systemOnboarding.phase, 'reassigning-access'), sql`${systemOnboarding.leaseExpiresAt} > now()`,
      )).returning({ id: systemOnboarding.systemId });
      if (!updated) throw new Error('System onboarding lease was lost');
      await tx.insert(systemOnboardingEvent).values({ tenantId: this.tenantId, systemId, phase: 'ready', detail: { action: 'reassigned', team: current.targetTeam } });
    });
  }

  async unregister(systemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select({ phase: systemOnboarding.phase }).from(systemOnboarding).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
      )).limit(1);
      if (!current || current.phase === 'removed') return;
      if (!['ready', 'unregistering'].includes(current.phase)) {
        throw Object.assign(new Error('System has another lifecycle transition in progress'), { status: 409 });
      }
      const [record] = await tx.update(systemOnboarding).set({
        phase: 'unregistering', targetTeamId: null, lastError: null, nextAttemptAt: null,
        ...(current.phase === 'ready' ? { attempts: 0 } : {}), updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.phase, current.phase), isNull(systemOnboarding.leaseOwner),
      )).returning({ id: systemOnboarding.systemId });
      if (!record) throw Object.assign(new Error('System onboarding is busy or was not found'), { status: 409 });
      if (current.phase === 'ready') {
        await tx.insert(systemOnboardingEvent).values({ tenantId: this.tenantId, systemId, phase: 'unregistering', detail: { action: 'unregister' } });
      }
    });
  }

  async remove(systemId: string, owner: string, generation: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [record] = await tx.update(systemOnboarding).set({
        phase: 'removed', targetTeamId: null, lastError: null, nextAttemptAt: null,
        leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
      }).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
        eq(systemOnboarding.leaseOwner, owner), eq(systemOnboarding.leaseGeneration, generation),
        eq(systemOnboarding.phase, 'unregistering'), sql`${systemOnboarding.leaseExpiresAt} > now()`,
      )).returning({ id: systemOnboarding.systemId });
      if (!record) throw new Error('System onboarding lease was lost');
      await tx.insert(systemOnboardingEvent).values({ tenantId: this.tenantId, systemId, phase: 'removed', detail: { action: 'unregistered' } });
    });
  }

  async retry(systemId: string): Promise<void> {
    await this.db.update(systemOnboarding).set({
      phase: 'validating', attempts: 0, lastError: null, nextAttemptAt: null, compatibilityIssues: [], updatedAt: new Date(),
    }).where(and(
      eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
      inArray(systemOnboarding.phase, ['repair', 'failed']), isNull(systemOnboarding.leaseOwner),
    ));
  }
}

function toRecord(record: typeof systemOnboarding.$inferSelect): OnboardingRecord {
  return {
    systemId: record.systemId,
    team: record.teamId,
    targetTeam: record.targetTeamId,
    repositoryOwner: record.forgejoOwner,
    repositoryName: record.forgejoRepository,
    phase: record.phase as OnboardingPhase,
    targetSha: record.targetSha,
    contractVersion: record.contractVersion,
    compatibilityIssues: record.compatibilityIssues,
    policyPlan: record.policyPlan,
    lastError: record.lastError,
    attempts: record.attempts,
    nextAttemptAt: record.nextAttemptAt,
    updatedAt: record.updatedAt,
  };
}
