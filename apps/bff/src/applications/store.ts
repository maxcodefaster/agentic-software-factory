/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, asc, eq, ne } from 'drizzle-orm';

import type { Database } from '@agentic-software-factory/db';
import { systemOnboarding, systemRegistration } from '@agentic-software-factory/db/schema';
import type { ApplicationDefinition, SystemRegistration } from './catalog';

export interface PersistedRegistrySystem {
  systemId: string;
  onboardingPhase: import('./onboarding-store').OnboardingPhase | null;
  onboardingError: string | null;
  onboardingUpdatedAt: Date;
  targetSha: string | null;
  registered: boolean;
  projection: ApplicationDefinition | null;
  projectionUpdatedAt: Date | null;
  projectionError: string | null;
  projectionErrorAt: Date | null;
}

export class ApplicationStore {
  constructor(private readonly db: Database, private readonly tenantId: string) {}

  async list(): Promise<SystemRegistration[]> {
    const rows = await this.db.select({ registration: systemRegistration }).from(systemRegistration)
      .innerJoin(systemOnboarding, and(eq(systemOnboarding.tenantId, systemRegistration.tenantId), eq(systemOnboarding.systemId, systemRegistration.systemId)))
      .where(and(eq(systemRegistration.tenantId, this.tenantId), eq(systemOnboarding.phase, 'ready')))
      .orderBy(asc(systemRegistration.teamId), asc(systemRegistration.forgejoOwner), asc(systemRegistration.forgejoRepository));
    return rows.map((row) => toRegistration(row.registration));
  }

  async get(id: string): Promise<SystemRegistration | null> {
    const [record] = await this.db.select({ registration: systemRegistration }).from(systemRegistration)
      .innerJoin(systemOnboarding, and(eq(systemOnboarding.tenantId, systemRegistration.tenantId), eq(systemOnboarding.systemId, systemRegistration.systemId))).where(and(
      eq(systemRegistration.tenantId, this.tenantId),
      eq(systemRegistration.systemId, id),
      eq(systemOnboarding.phase, 'ready'),
    )).limit(1);
    return record ? toRegistration(record.registration) : null;
  }

  async getPending(id: string): Promise<SystemRegistration | null> {
    const [record] = await this.db.select().from(systemRegistration).where(and(eq(systemRegistration.tenantId, this.tenantId), eq(systemRegistration.systemId, id))).limit(1);
    return record ? toRegistration(record) : null;
  }

  async getProjection(id: string): Promise<ApplicationDefinition | null> {
    const [record] = await this.db.select({ projection: systemRegistration.projection }).from(systemRegistration)
      .innerJoin(systemOnboarding, and(eq(systemOnboarding.tenantId, systemRegistration.tenantId), eq(systemOnboarding.systemId, systemRegistration.systemId))).where(and(
        eq(systemRegistration.tenantId, this.tenantId),
        eq(systemRegistration.systemId, id),
        eq(systemOnboarding.phase, 'ready'),
      )).limit(1);
    return record?.projection ?? null;
  }

  async saveProjection(application: ApplicationDefinition): Promise<void> {
    await this.db.update(systemRegistration).set({
      projection: application,
      projectionUpdatedAt: new Date(),
      projectionError: null,
      projectionErrorAt: null,
    }).where(and(
      eq(systemRegistration.tenantId, this.tenantId),
      eq(systemRegistration.systemId, application.id),
    ));
  }

  async saveProjectionError(id: string, error: string): Promise<void> {
    await this.db.update(systemRegistration).set({ projectionError: error, projectionErrorAt: new Date() }).where(and(
      eq(systemRegistration.tenantId, this.tenantId),
      eq(systemRegistration.systemId, id),
    ));
  }

  async listPersistedStatus(): Promise<PersistedRegistrySystem[]> {
    const [onboardingRows, registrationRows] = await Promise.all([
      this.db.select({
        systemId: systemOnboarding.systemId,
        onboardingPhase: systemOnboarding.phase,
        onboardingError: systemOnboarding.lastError,
        onboardingUpdatedAt: systemOnboarding.updatedAt,
        targetSha: systemOnboarding.targetSha,
      }).from(systemOnboarding)
      .where(and(eq(systemOnboarding.tenantId, this.tenantId), ne(systemOnboarding.phase, 'removed')))
      .orderBy(asc(systemOnboarding.systemId)),
      this.db.select({
        systemId: systemRegistration.systemId,
        updatedAt: systemRegistration.updatedAt,
        projection: systemRegistration.projection,
        projectionUpdatedAt: systemRegistration.projectionUpdatedAt,
        projectionError: systemRegistration.projectionError,
        projectionErrorAt: systemRegistration.projectionErrorAt,
      }).from(systemRegistration).where(eq(systemRegistration.tenantId, this.tenantId)),
    ]);
    const registrations = new Map(registrationRows.map((row) => [row.systemId, row]));
    const systems = onboardingRows.map((row): PersistedRegistrySystem => {
      const registration = registrations.get(row.systemId);
      registrations.delete(row.systemId);
      return {
        systemId: row.systemId,
        onboardingPhase: row.onboardingPhase as PersistedRegistrySystem['onboardingPhase'],
        onboardingError: row.onboardingError,
        onboardingUpdatedAt: row.onboardingUpdatedAt,
        targetSha: row.targetSha,
        registered: registration !== undefined,
        projection: registration?.projection ?? null,
        projectionUpdatedAt: registration?.projectionUpdatedAt ?? null,
        projectionError: registration?.projectionError ?? null,
        projectionErrorAt: registration?.projectionErrorAt ?? null,
      };
    });
    for (const registration of registrations.values()) systems.push({
      systemId: registration.systemId,
      onboardingPhase: null,
      onboardingError: 'Onboarding state is missing',
      onboardingUpdatedAt: registration.updatedAt,
      targetSha: null,
      registered: true,
      projection: registration.projection,
      projectionUpdatedAt: registration.projectionUpdatedAt,
      projectionError: registration.projectionError,
      projectionErrorAt: registration.projectionErrorAt,
    });
    return systems.sort((left, right) => left.systemId.localeCompare(right.systemId));
  }

  async create(input: SystemRegistration): Promise<{ registration: SystemRegistration; created: boolean }> {
    const systemId = `${input.repositoryOwner}/${input.repositoryName}`;
    const [created] = await this.db.insert(systemRegistration).values({
      tenantId: this.tenantId,
      systemId,
      teamId: input.team,
      forgejoOwner: input.repositoryOwner,
      forgejoRepository: input.repositoryName,
    }).onConflictDoNothing().returning();
    if (created) return { registration: toRegistration(created), created: true };
    const existing = await this.getPending(systemId);
    if (!existing) throw Object.assign(new Error('System registration conflicted'), { status: 409 });
    if (existing.team !== input.team) {
      const [lifecycle] = await this.db.select({ team: systemOnboarding.teamId, phase: systemOnboarding.phase }).from(systemOnboarding).where(and(
        eq(systemOnboarding.tenantId, this.tenantId), eq(systemOnboarding.systemId, systemId),
      )).limit(1);
      if (!lifecycle || lifecycle.team !== input.team || lifecycle.phase === 'ready') {
        throw Object.assign(new Error('System is already registered to another team'), { status: 409 });
      }
      await this.reassign(systemId, input.team);
      return { registration: input, created: false };
    }
    return { registration: existing, created: false };
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(systemRegistration).where(and(
      eq(systemRegistration.tenantId, this.tenantId),
      eq(systemRegistration.systemId, id),
    ));
  }

  async reassign(id: string, team: string): Promise<void> {
    await this.db.update(systemRegistration).set({ teamId: team, updatedAt: new Date() }).where(and(
      eq(systemRegistration.tenantId, this.tenantId), eq(systemRegistration.systemId, id),
    ));
  }
}

function toRegistration(record: typeof systemRegistration.$inferSelect): SystemRegistration {
  return {
    team: record.teamId,
    repositoryOwner: record.forgejoOwner,
    repositoryName: record.forgejoRepository,
  };
}
