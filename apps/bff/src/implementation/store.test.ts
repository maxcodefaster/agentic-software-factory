/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { createDatabase } from '@agentic-software-factory/db';
import { bundledMigrationsFolder, closeDatabase, migrateDatabase } from '@agentic-software-factory/db/migrate';
import { delivery, deliveryCompletion, deliveryContributor, deliveryVerification, operation, systemRegistration, user } from '@agentic-software-factory/db/schema';
import { ImplementationStore } from './store';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('ImplementationStore', () => {
  const database = createDatabase(databaseUrl ?? 'postgres://unused');
  const first = new ImplementationStore(database.db, 'tenant');
  const second = new ImplementationStore(database.db, 'tenant');

  beforeAll(async () => {
    await migrateDatabase(database.db, bundledMigrationsFolder);
    await database.db.insert(user).values([
      { id: 'alice', name: 'Alice', email: 'alice@example.test', emailVerified: true },
      { id: 'bob', name: 'Bob', email: 'bob@example.test', emailVerified: true },
    ]).onConflictDoNothing();
    await database.db.insert(systemRegistration).values({ tenantId: 'tenant', systemId: 'factory/payments', teamId: 'payments', forgejoOwner: 'factory', forgejoRepository: 'payments' }).onConflictDoNothing();
  });

  beforeEach(async () => {
    await database.db.delete(operation);
    await database.db.delete(deliveryContributor);
    await database.db.delete(delivery);
  });

  afterAll(() => closeDatabase(database.sql));

  test('reserves one deterministic delivery and contributor', async () => {
    const input = { id: 'delivery-fixed', requirementNumber: 7, systemId: 'factory/payments', acceptedDigest: 'sha256:accepted', createdByUserId: 'alice' };
    const [left, right] = await Promise.all([first.reserveDelivery(input), second.reserveDelivery(input)]);
    expect(left.delivery.id).toBe(right.delivery.id);
    expect([left.created, right.created].sort()).toEqual([false, true]);
    await first.addContributor(input.id, 'alice');
    await second.addContributor(input.id, 'alice');
    expect(await first.isContributor(input.id, 'alice')).toBe(true);
  });

  test('leases one delivery-wide Chat create across replicas and contributors', async () => {
    await seed(first);
    await first.addContributor('delivery-fixed', 'bob');
    const [left, right] = await Promise.all([
      first.reserveOperation('delivery-fixed', 'alice', 'coder-chat-create'),
      second.reserveOperation('delivery-fixed', 'bob', 'coder-chat-create'),
    ]);
    expect(left.idempotencyKey).toBe(right.idempotencyKey);
    expect(left.factoryUserId).toBe(right.factoryUserId);
    const claims = await Promise.all([
      first.claimOperation(left.idempotencyKey, 'one'),
      second.claimOperation(left.idempotencyKey, 'two'),
    ]);
    expect(claims.sort()).toEqual([false, true]);
    const claimed = await first.operation(left.idempotencyKey);
    expect(await first.markOperationAmbiguous(left.idempotencyKey, claimed.leaseOwner!, 'response lost')).toBe(true);
    expect((await second.reserveOperation('delivery-fixed', 'bob', 'coder-chat-create')).idempotencyKey).toBe(left.idempotencyKey);
  });

  test('does not serialize Chat creates for different delivery branches', async () => {
    await seed(first);
    await first.reserveDelivery({ id: 'delivery-second', requirementNumber: 8, systemId: 'factory/payments', acceptedDigest: 'sha256:second', createdByUserId: 'bob' });
    await first.addContributor('delivery-second', 'bob');

    const [left, right] = await Promise.all([
      first.reserveOperation('delivery-fixed', 'alice', 'coder-chat-create'),
      second.reserveOperation('delivery-second', 'bob', 'coder-chat-create'),
    ]);

    expect(left.deliveryId).toBe('delivery-fixed');
    expect(right.deliveryId).toBe('delivery-second');
    expect(left.idempotencyKey).not.toBe(right.idempotencyKey);
  });

  test('records only the external ID after a successful create', async () => {
    await seed(first);
    const reserved = await first.reserveOperation('delivery-fixed', 'alice', 'coder-chat-create');
    expect(await first.claimOperation(reserved.idempotencyKey, 'worker')).toBe(true);
    expect(await first.markOperationSucceeded(reserved.idempotencyKey, 'worker', 'chat-1')).toBe(true);
    expect(await first.operation(reserved.idempotencyKey)).toMatchObject({
      state: 'succeeded', externalId: 'chat-1', leaseOwner: null, leaseExpiresAt: null,
    });
  });

  test('records the Chat POST boundary without adding workflow columns', async () => {
    await seed(first);
    const reserved = await first.reserveOperation('delivery-fixed', 'alice', 'coder-chat-create');
    expect(await first.claimOperation(reserved.idempotencyKey, 'worker')).toBe(true);
    expect(await first.markOperationPostStarted(reserved.idempotencyKey, 'worker')).toBe(true);
    expect(await first.operation(reserved.idempotencyKey)).toMatchObject({ state: 'running', error: 'coder-post-started' });
  });

  test('selects recoverable verifications without polling healthy verifications', async () => {
    await seed(first);
    await first.reserveDelivery({ id: 'delivery-provisioning', requirementNumber: 8, systemId: 'factory/payments', acceptedDigest: 'sha256:provisioning', createdByUserId: 'alice' });
    await first.reserveDelivery({ id: 'delivery-retry', requirementNumber: 9, systemId: 'factory/payments', acceptedDigest: 'sha256:retry', createdByUserId: 'alice' });
    await first.reserveDelivery({ id: 'delivery-active', requirementNumber: 10, systemId: 'factory/payments', acceptedDigest: 'sha256:active', createdByUserId: 'alice' });
    await first.reserveDelivery({ id: 'delivery-waiting', requirementNumber: 11, systemId: 'factory/payments', acceptedDigest: 'sha256:waiting', createdByUserId: 'alice' });
    const input = { requestedByUserId: 'alice', desiredHeadSha: 'a'.repeat(40), desiredDefaultSha: 'd'.repeat(40) };

    await first.desireVerification({ deliveryId: 'delivery-fixed', ...input });
    const healthyGeneration = await first.claimVerification('delivery-fixed', 'worker');
    expect(healthyGeneration).not.toBeNull();
    expect(await first.completeVerification('delivery-fixed', 'worker', healthyGeneration!, input.desiredHeadSha, 'workspace-healthy')).toBe(true);

    await first.desireVerification({ deliveryId: 'delivery-provisioning', ...input });
    expect(await first.claimVerification('delivery-provisioning', 'crashed-worker', new Date('2026-01-01T00:00:00Z'), 1_000)).not.toBeNull();

    await first.desireVerification({ deliveryId: 'delivery-retry', ...input });
    await database.db.update(deliveryVerification).set({ phase: 'retry-wait', nextAttemptAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(deliveryVerification.deliveryId, 'delivery-retry'));

    await first.desireVerification({ deliveryId: 'delivery-active', ...input });
    expect(await first.claimVerification('delivery-active', 'active-worker', new Date(), 60_000)).not.toBeNull();

    await first.desireVerification({ deliveryId: 'delivery-waiting', ...input });
    await database.db.update(deliveryVerification).set({ phase: 'retry-wait', nextAttemptAt: new Date(Date.now() + 60_000) })
      .where(eq(deliveryVerification.deliveryId, 'delivery-waiting'));

    expect((await first.reconcilableVerifications()).map((verification) => verification.deliveryId).sort()).toEqual([
      'delivery-provisioning',
      'delivery-retry',
    ]);
  });

  test('selects only due completions whose lease is available or expired', async () => {
    for (const [id, number] of [['completion-due', 8], ['completion-future', 9], ['completion-leased', 10], ['completion-expired', 11]] as const) {
      await first.reserveDelivery({ id, requirementNumber: number, systemId: 'factory/payments', acceptedDigest: `sha256:${id}`, createdByUserId: 'alice' });
      await first.reserveCompletion({ deliveryId: id, reviewedHeadSha: 'a'.repeat(40), reviewedDefaultSha: 'd'.repeat(40), verificationWorkspaceId: `verification-${number}` });
    }
    const now = Date.now();
    await database.db.update(deliveryCompletion).set({ phase: 'retry-wait', nextAttemptAt: new Date(now - 1_000) })
      .where(eq(deliveryCompletion.deliveryId, 'completion-due'));
    await database.db.update(deliveryCompletion).set({ phase: 'retry-wait', nextAttemptAt: new Date(now + 60_000) })
      .where(eq(deliveryCompletion.deliveryId, 'completion-future'));
    await database.db.update(deliveryCompletion).set({ leaseOwner: 'active', leaseExpiresAt: new Date(now + 60_000) })
      .where(eq(deliveryCompletion.deliveryId, 'completion-leased'));
    await database.db.update(deliveryCompletion).set({ leaseOwner: 'stale', leaseExpiresAt: new Date(now - 1_000) })
      .where(eq(deliveryCompletion.deliveryId, 'completion-expired'));

    expect((await first.reconcilableCompletions()).map((completion) => completion.deliveryId).sort()).toEqual([
      'completion-due',
      'completion-expired',
    ]);
  });
});

async function seed(store: ImplementationStore): Promise<void> {
  await store.reserveDelivery({ id: 'delivery-fixed', requirementNumber: 7, systemId: 'factory/payments', acceptedDigest: 'sha256:accepted', createdByUserId: 'alice' });
  await store.addContributor('delivery-fixed', 'alice');
}
