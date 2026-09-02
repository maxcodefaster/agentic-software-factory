/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { deliveryCompletion, deliveryVerification, stagingReconciliationEvent, systemOnboardingEvent, workspaceStartup } from '../db/schema';

export class RetentionService {
  constructor(private readonly db: Database, private readonly tenantId: string) {}

  async sweep(now = new Date()): Promise<void> {
    const eventsBefore = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
    const metricsBefore = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const completedBefore = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    await this.db.transaction(async (tx) => {
      await tx.delete(workspaceStartup).where(and(eq(workspaceStartup.tenantId, this.tenantId), lt(workspaceStartup.requestedAt, metricsBefore)));
      await tx.delete(systemOnboardingEvent).where(and(eq(systemOnboardingEvent.tenantId, this.tenantId), lt(systemOnboardingEvent.createdAt, eventsBefore)));
      await tx.delete(stagingReconciliationEvent).where(and(eq(stagingReconciliationEvent.tenantId, this.tenantId), lt(stagingReconciliationEvent.createdAt, eventsBefore)));
      await tx.delete(deliveryVerification).where(and(
        eq(deliveryVerification.phase, 'healthy'), lt(deliveryVerification.updatedAt, completedBefore),
        sql`exists (select 1 from ${deliveryCompletion} c join delivery d on d.id = c.delivery_id where c.delivery_id = ${deliveryVerification.deliveryId} and c.phase = 'complete' and d.tenant_id = ${this.tenantId})`,
      ));
    });
  }
}
