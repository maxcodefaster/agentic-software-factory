/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { workspaceStartup } from '../db/schema';

export class WorkspaceStartupMetrics {
  constructor(private readonly db: Database, private readonly tenantId: string) {}

  async measure<T>(input: { systemId: string; kind: 'developer' | 'ticket' | 'staging' | 'verification'; sha: string; contractVersion: number; architecture?: string; cacheKey: string }, action: () => Promise<T>): Promise<T> {
    const id = `startup_${crypto.randomUUID().replaceAll('-', '')}`;
    const started = Date.now();
    await this.db.insert(workspaceStartup).values({
      id, tenantId: this.tenantId, systemId: input.systemId, workspaceKind: input.kind,
      repositorySha: input.sha, contractVersion: input.contractVersion,
      architecture: input.architecture ?? 'unknown', cacheKey: input.cacheKey,
      cacheState: 'unknown',
    });
    try {
      const result = await action();
      const readyAt = new Date();
      await this.db.update(workspaceStartup).set({ outcome: 'ready', readyAt, durationMs: readyAt.getTime() - started, updatedAt: readyAt }).where(eq(workspaceStartup.id, id));
      return result;
    } catch (error) {
      const failedAt = new Date();
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      await this.db.update(workspaceStartup).set({
        outcome: cancelled ? 'cancelled' : 'failed', failedAt, durationMs: failedAt.getTime() - started,
        errorClass: error instanceof Error ? error.constructor.name : 'UnknownError', updatedAt: failedAt,
      }).where(eq(workspaceStartup.id, id));
      throw error;
    }
  }

  async summary(since: Date): Promise<Array<{ kind: string; cacheState: string; outcome: string; count: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }>> {
    return this.db.select({
      kind: workspaceStartup.workspaceKind,
      cacheState: workspaceStartup.cacheState,
      outcome: workspaceStartup.outcome,
      count: sql<number>`count(*)::int`,
      p50Ms: sql<number | null>`percentile_cont(0.50) within group (order by ${workspaceStartup.durationMs})::int`,
      p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${workspaceStartup.durationMs})::int`,
      p99Ms: sql<number | null>`percentile_cont(0.99) within group (order by ${workspaceStartup.durationMs})::int`,
    }).from(workspaceStartup).where(and(eq(workspaceStartup.tenantId, this.tenantId), gte(workspaceStartup.requestedAt, since)))
      .groupBy(workspaceStartup.workspaceKind, workspaceStartup.cacheState, workspaceStartup.outcome);
  }
}
