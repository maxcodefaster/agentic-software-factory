/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createDatabase } from '../db';
import { closeDatabase, migrateDatabase } from '../db/migrate';
import { DatabaseOnboardingLifecycleStore } from './onboarding-store';
import { StagingStore } from './staging-store';
import { ImplementationStore } from '../implementation/store';
import { ApplicationStore } from './store';

const url = process.env.TEST_DATABASE_URL;
const database = url ? createDatabase(url) : null;

beforeAll(async () => {
  if (!database) return;
  await migrateDatabase(database.db, resolve(import.meta.dir, '../../drizzle'));
  await database.db.execute('truncate table operation, delivery_completion, delivery_verification, delivery_contributor, delivery, staging_reconciliation_event, staging_reconciliation, system_onboarding_event, system_onboarding, system_registration, coder_user_binding, "user" cascade');
  await database.db.execute(`insert into "user" (id, name, email, email_verified, preferred_username) values ('reviewer', 'Reviewer', 'reviewer@example.test', true, 'reviewer')`);
});

afterAll(async () => { if (database) await closeDatabase(database.sql); });

test.skipIf(!database)('onboarding lease generations reject a stale replica after takeover', async () => {
  const store = new DatabaseOnboardingLifecycleStore(database!.db, 'tenant');
  await store.reserve({ systemId: 'owner/app', team: 'team', repositoryOwner: 'owner', repositoryName: 'app' });
  const now = Date.now();
  const first = await store.claim('owner/app', 'replica-a', new Date(now), 1_000);
  expect(first).toBe(1);
  const second = await store.claim('owner/app', 'replica-b', new Date(now + 2_000), 60_000);
  expect(second).toBe(2);
  expect(await store.renew('owner/app', 'replica-a', first!, new Date(now + 2_100), 1_000)).toBe(false);
  await expect(store.advance('owner/app', 'replica-a', first!, 'ready')).rejects.toThrow('lease was lost');
  await store.advance('owner/app', 'replica-b', second!, 'ready');
});

test.skipIf(!database)('normal System queries expose registrations only after onboarding is ready', async () => {
  const lifecycle = new DatabaseOnboardingLifecycleStore(database!.db, 'tenant');
  const applications = new ApplicationStore(database!.db, 'tenant');
  await lifecycle.reserve({ systemId: 'owner/hidden', team: 'team', repositoryOwner: 'owner', repositoryName: 'hidden' });
  await applications.create({ team: 'team', repositoryOwner: 'owner', repositoryName: 'hidden' });
  expect(await applications.get('owner/hidden')).toBeNull();
  const generation = await lifecycle.claim('owner/hidden', 'replica', new Date(), 60_000);
  await lifecycle.advance('owner/hidden', 'replica', generation!, 'ready');
  expect(await applications.get('owner/hidden')).toEqual({ team: 'team', repositoryOwner: 'owner', repositoryName: 'hidden' });
  const projection = {
    id: 'owner/hidden', team: 'team', repositoryOwner: 'owner', repositoryName: 'hidden', name: 'Hidden', description: '',
    repositoryUrl: 'https://forgejo.example/owner/hidden', cloneUrl: 'https://forgejo.example/owner/hidden.git',
    defaultBranch: 'main', defaultSha: 'a'.repeat(40), declaredApps: [],
  };
  await applications.saveProjection(projection);
  expect(await applications.getProjection('owner/hidden')).toEqual(projection);
});

test.skipIf(!database)('reassignment stays hidden until the target team is atomically published', async () => {
  const lifecycle = new DatabaseOnboardingLifecycleStore(database!.db, 'tenant');
  const applications = new ApplicationStore(database!.db, 'tenant');
  await lifecycle.reserve({ systemId: 'owner/reassigned', team: 'payments', repositoryOwner: 'owner', repositoryName: 'reassigned' });
  await applications.create({ team: 'payments', repositoryOwner: 'owner', repositoryName: 'reassigned' });
  let generation = await lifecycle.claim('owner/reassigned', 'seed', new Date(), 60_000);
  await lifecycle.advance('owner/reassigned', 'seed', generation!, 'ready');

  await lifecycle.reassign('owner/reassigned', 'platform');
  expect(await applications.get('owner/reassigned')).toBeNull();
  expect(await applications.getPending('owner/reassigned')).toMatchObject({ team: 'payments' });
  expect(await lifecycle.get('owner/reassigned')).toMatchObject({ team: 'payments', targetTeam: 'platform', phase: 'reassigning' });

  generation = await lifecycle.claim('owner/reassigned', 'worker', new Date(), 60_000);
  await lifecycle.advance('owner/reassigned', 'worker', generation!, 'reassigning-access');
  expect(await applications.get('owner/reassigned')).toBeNull();
  await lifecycle.finishReassignment('owner/reassigned', 'worker', generation!);
  expect(await applications.get('owner/reassigned')).toMatchObject({ team: 'platform' });
  expect(await lifecycle.get('owner/reassigned')).toMatchObject({ team: 'platform', targetTeam: null, phase: 'ready' });
});

test.skipIf(!database)('removed Systems retain registration history and can be registered to a new team', async () => {
  const lifecycle = new DatabaseOnboardingLifecycleStore(database!.db, 'tenant');
  const applications = new ApplicationStore(database!.db, 'tenant');
  await lifecycle.reserve({ systemId: 'owner/returning', team: 'payments', repositoryOwner: 'owner', repositoryName: 'returning' });
  await applications.create({ team: 'payments', repositoryOwner: 'owner', repositoryName: 'returning' });
  let generation = await lifecycle.claim('owner/returning', 'worker', new Date(), 60_000);
  await lifecycle.advance('owner/returning', 'worker', generation!, 'ready');
  await lifecycle.release('owner/returning', 'worker', generation!);
  await lifecycle.unregister('owner/returning');
  generation = await lifecycle.claim('owner/returning', 'worker', new Date(), 60_000);
  await lifecycle.remove('owner/returning', 'worker', generation!);

  expect(await applications.get('owner/returning')).toBeNull();
  expect(await applications.getPending('owner/returning')).toMatchObject({ team: 'payments' });
  await lifecycle.reserve({ systemId: 'owner/returning', team: 'platform', repositoryOwner: 'owner', repositoryName: 'returning' });
  await applications.create({ team: 'platform', repositoryOwner: 'owner', repositoryName: 'returning' });
  expect(await applications.getPending('owner/returning')).toMatchObject({ team: 'platform' });
});

test.skipIf(!database)('only one staging replica claims a System and stale SHA completion is fenced', async () => {
  await database!.db.execute(`insert into system_registration (tenant_id, system_id, team_id, forgejo_owner, forgejo_repository) values ('tenant', 'owner/staging', 'team', 'owner', 'staging')`);
  const store = new StagingStore(database!.db, 'tenant');
  await store.desire('owner/staging', 'a'.repeat(40));
  const [first, competing] = await Promise.all([
    store.claim('owner/staging', 'replica-a', new Date(), 60_000),
    store.claim('owner/staging', 'replica-b', new Date(), 60_000),
  ]);
  expect([first, competing].filter((value) => value !== null)).toHaveLength(1);
  await store.desire('owner/staging', 'b'.repeat(40));
  const generation = first ?? competing!;
  expect(await store.succeed('owner/staging', first ? 'replica-a' : 'replica-b', generation, 'a'.repeat(40), workspace())).toBe(false);
});

test.skipIf(!database)('a new staging desired SHA immediately fences the old lease', async () => {
  await database!.db.execute(`insert into system_registration (tenant_id, system_id, team_id, forgejo_owner, forgejo_repository) values ('tenant', 'owner/staging-race', 'team', 'owner', 'staging-race')`);
  const store = new StagingStore(database!.db, 'tenant');
  await store.desire('owner/staging-race', 'a'.repeat(40));
  const oldGeneration = await store.claim('owner/staging-race', 'replica-a', new Date(), 60_000);
  await store.desire('owner/staging-race', 'b'.repeat(40));
  const newGeneration = await store.claim('owner/staging-race', 'replica-b', new Date(), 60_000);
  expect(newGeneration).toBeGreaterThan(oldGeneration!);
  expect(await store.succeed('owner/staging-race', 'replica-a', oldGeneration!, 'a'.repeat(40), workspace())).toBe(false);
  expect(await store.succeed('owner/staging-race', 'replica-b', newGeneration!, 'b'.repeat(40), { ...workspace(), parameters: { repository_ref: 'b'.repeat(40) } })).toBe(true);
  expect(await store.get('owner/staging-race')).toMatchObject({ phase: 'healthy', currentSha: 'b'.repeat(40) });
  expect(await store.claim('owner/staging-race', 'replica-c', new Date(), 60_000)).toBeNull();
});

test.skipIf(!database)('re-registering reactivates a retained deleting staging row and reaches healthy', async () => {
  const lifecycle = new DatabaseOnboardingLifecycleStore(database!.db, 'tenant');
  const applications = new ApplicationStore(database!.db, 'tenant');
  const staging = new StagingStore(database!.db, 'tenant');
  const systemId = 'owner/returning-staging';
  const sha = 'c'.repeat(40);
  await lifecycle.reserve({ systemId, team: 'payments', repositoryOwner: 'owner', repositoryName: 'returning-staging' });
  await applications.create({ team: 'payments', repositoryOwner: 'owner', repositoryName: 'returning-staging' });
  let generation = await lifecycle.claim(systemId, 'onboarding', new Date(), 60_000);
  await lifecycle.advance(systemId, 'onboarding', generation!, 'ready');
  await lifecycle.release(systemId, 'onboarding', generation!);
  await staging.desire(systemId, sha);
  generation = await staging.claim(systemId, 'staging', new Date(), 60_000);
  await staging.succeed(systemId, 'staging', generation!, sha, { ...workspace(), parameters: { repository_ref: sha } });

  await lifecycle.unregister(systemId);
  generation = await staging.claimDeletion(systemId, 'staging-delete', new Date(), 60_000).then((claim) => claim.status === 'claimed' ? claim.generation : null);
  expect(generation).not.toBeNull();
  expect(await staging.finishDeletion(systemId, 'staging-delete', generation!)).toBe(true);
  generation = await lifecycle.claim(systemId, 'onboarding', new Date(), 60_000);
  await lifecycle.remove(systemId, 'onboarding', generation!);
  expect(await staging.get(systemId)).toMatchObject({ phase: 'deleting', desiredSha: sha, currentSha: null, workspace: null });

  await lifecycle.reserve({ systemId, team: 'payments', repositoryOwner: 'owner', repositoryName: 'returning-staging' });
  const desired = await staging.desire(systemId, sha);
  expect(desired).toMatchObject({ phase: 'pending', desiredSha: sha, currentSha: null, health: 'unknown' });
  generation = await staging.claim(systemId, 'staging-return', new Date(), 60_000);
  expect(generation).not.toBeNull();
  expect(await staging.succeed(systemId, 'staging-return', generation!, sha, { ...workspace(), parameters: { repository_ref: sha } })).toBe(true);
  expect(await staging.get(systemId)).toMatchObject({ phase: 'healthy', desiredSha: sha, currentSha: sha, health: 'healthy' });
});

test.skipIf(!database)('delivery completion has one claimant and rejects stale generation writes', async () => {
  await database!.db.execute(`insert into system_registration (tenant_id, system_id, team_id, forgejo_owner, forgejo_repository) values ('tenant', 'owner/delivery', 'team', 'owner', 'delivery')`);
  await database!.db.execute(`insert into delivery (id, requirement_number, tenant_id, system_id, accepted_digest, created_by_user_id) values ('delivery-ha', 9, 'tenant', 'owner/delivery', 'digest', 'reviewer')`);
  const store = new ImplementationStore(database!.db, 'tenant');
  await store.reserveCompletion({ deliveryId: 'delivery-ha', reviewedHeadSha: 'a'.repeat(40), reviewedDefaultSha: 'b'.repeat(40), verificationWorkspaceId: 'verification-1' });
  const [first, competing] = await Promise.all([
    store.claimCompletion('delivery-ha', 'replica-a', new Date(), 60_000),
    store.claimCompletion('delivery-ha', 'replica-b', new Date(), 60_000),
  ]);
  expect([first, competing].filter((value) => value !== null)).toHaveLength(1);
  const generation = first ?? competing!;
  expect(await store.advanceCompletion('delivery-ha', first ? 'replica-b' : 'replica-a', generation, 'complete')).toBe(false);
  expect(await store.advanceCompletion('delivery-ha', first ? 'replica-a' : 'replica-b', generation, 'complete')).toBe(true);
});

function workspace() {
  return { id: 'workspace', name: 'staging', owner: 'automation', template: 'factory', status: 'running', transition: 'start', healthy: true, outdated: false, lastUsedAt: '', apps: [], parameters: { repository_ref: 'a'.repeat(40) } };
}
