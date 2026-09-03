/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, mock, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTableName, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';

import { createDatabase } from '.';
import { authSchema } from './schema';
import { assertDatabaseSchema, bundledMigrationsFolder, closeDatabase, migrateDatabase } from './migrate';

const drizzle = bundledMigrationsFolder;
const authTables = [
  'account',
  'jwks',
  'oauth_access_token',
  'oauth_client',
  'oauth_client_assertion',
  'oauth_client_resource',
  'oauth_consent',
  'oauth_refresh_token',
  'oauth_resource',
  'session',
  'user',
  'verification',
];
const factoryTables = ['coder_user_binding', 'delivery', 'delivery_completion', 'delivery_contributor', 'delivery_lifecycle_event', 'delivery_verification', 'operation', 'staging_reconciliation', 'staging_reconciliation_event', 'system_onboarding', 'system_onboarding_event', 'system_registration', 'workspace_startup'];

test('migration history and latest snapshot match the modeled schema', async () => {
  const [journalSource, snapshotSource] = await Promise.all([
    readFile(resolve(drizzle, 'meta/_journal.json'), 'utf8'),
    readFile(resolve(drizzle, 'meta/0000_snapshot.json'), 'utf8'),
  ]);
  const journal = JSON.parse(journalSource) as { entries: unknown[] };
  const snapshot = JSON.parse(snapshotSource) as { prevId: string; tables: Record<string, unknown> };

  expect(journal.entries).toEqual([expect.objectContaining({ idx: 0, tag: '0000_baseline' })]);
  expect(snapshot.prevId).toBe('00000000-0000-0000-0000-000000000000');
  expect(Object.keys(snapshot.tables).sort()).toEqual([...authTables, ...factoryTables].map((name) => `public.${name}`).sort());
  const modeledAuthTables: string[] = Object.values(authSchema).map(getTableName).sort();
  expect(modeledAuthTables).toEqual(authTables);
});

test('startup schema verification accepts the exact bundled migration state', async () => {
  const migrations = readMigrationFiles({ migrationsFolder: drizzle });
  const execute = mock(async (query: string) => query.includes('__drizzle_migrations')
    ? migrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) }))
    : []);

  await assertDatabaseSchema({ execute } as unknown as ReturnType<typeof createDatabase>['db'], drizzle);

  expect(execute).toHaveBeenCalledTimes(1 + factoryTables.length + 2);
});

test.each([
  ['missing migration', (rows: Array<{ hash: string; created_at: string }>) => rows.slice(0, -1)],
  ['extra migration', (rows: Array<{ hash: string; created_at: string }>) => [...rows, { hash: 'extra', created_at: '9999999999999' }]],
  ['changed hash', (rows: Array<{ hash: string; created_at: string }>) => rows.map((row, index) => index === 0 ? { ...row, hash: 'changed' } : row)],
  ['changed journal timestamp', (rows: Array<{ hash: string; created_at: string }>) => rows.map((row, index) => index === 0 ? { ...row, created_at: String(Number(row.created_at) + 1) } : row)],
])('startup schema verification rejects %s', async (_case, mutate) => {
  const migrations = readMigrationFiles({ migrationsFolder: drizzle });
  const rows = migrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) }));
  const execute = mock(async (query: string) => query.includes('__drizzle_migrations') ? mutate(rows) : []);

  await expect(assertDatabaseSchema(
    { execute } as unknown as ReturnType<typeof createDatabase>['db'],
    drizzle,
  )).rejects.toThrow('database migration state does not match bundled migrations');
  expect(execute).toHaveBeenCalledTimes(1);
});

test('startup schema verification fails when applied migration history cannot be read', async () => {
  const execute = mock(async () => { throw new Error('migration table unavailable'); });

  await expect(assertDatabaseSchema(
    { execute } as unknown as ReturnType<typeof createDatabase>['db'],
    drizzle,
  )).rejects.toThrow('migration table unavailable');
  expect(execute).toHaveBeenCalledTimes(1);
});

test('migration refuses an untracked old schema before applying the clean baseline', async () => {
  const execute = mock(async (query: string) => query.includes('to_regclass')
    ? [{ migration_table: null, has_application_tables: true }]
    : (() => { throw new Error(`unexpected migration query: ${query}`); })());

  await expect(migrateDatabase(
    { execute } as unknown as ReturnType<typeof createDatabase>['db'],
    drizzle,
  )).rejects.toThrow('unsupported database upgrade: application tables exist without this baseline migration history. This project supports one clean baseline only; reset the database and install on an empty schema');
  expect(execute).toHaveBeenCalledTimes(1);
});

test('migration refuses a mismatched applied baseline before applying SQL', async () => {
  const execute = mock(async (query: string) => {
    if (query.includes('to_regclass')) return [{ migration_table: 'drizzle.__drizzle_migrations', has_application_tables: true }];
    if (query.includes('__drizzle_migrations')) return [{ hash: 'old-baseline', created_at: '1' }];
    throw new Error(`unexpected migration query: ${query}`);
  });

  await expect(migrateDatabase(
    { execute } as unknown as ReturnType<typeof createDatabase>['db'],
    drizzle,
  )).rejects.toThrow('unsupported database upgrade: the applied baseline does not match this release. This project supports one clean baseline only; reset the database and install on an empty schema');
  expect(execute).toHaveBeenCalledTimes(2);
});

test.skipIf(!process.env.TEST_DATABASE_URL)('migration history applies twice and enforces delivery operation identities', async () => {
  await withTemporaryDatabase(async (database) => {
    await migrateDatabase(database.db, drizzle);
    const first = await database.db.execute('select id, hash, created_at from drizzle.__drizzle_migrations order by id');
    expect(first).toHaveLength(1);

    await migrateDatabase(database.db, drizzle);
    expect(await database.db.execute('select id, hash, created_at from drizzle.__drizzle_migrations order by id')).toEqual(first);

    const tables = await database.db.execute("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
    expect(tables.map((row) => row.table_name)).toEqual([...authTables, ...factoryTables].sort());
    await seedModel(database.db);

    await database.db.execute("insert into system_registration (tenant_id, system_id, team_id, forgejo_owner, forgejo_repository) values ('tenant', 'owner/second', 'team', 'owner', 'second')");
    const registrations = await database.db.execute("select system_id from system_registration where tenant_id = 'tenant' and team_id = 'team' order by system_id");
    expect(registrations.map((row) => row.system_id)).toEqual(['owner/repository', 'owner/second']);
    await database.db.execute("update system_registration set team_id = 'platform' where tenant_id = 'tenant' and system_id = 'owner/repository'");
    const deliveryRepository = await database.db.execute("select r.forgejo_owner, r.forgejo_repository from delivery d join system_registration r using (tenant_id, system_id) where d.id = 'delivery-1'");
    expect(deliveryRepository).toMatchObject([{ forgejo_owner: 'owner', forgejo_repository: 'repository' }]);

    expect(await rejectedConstraint(database.db.execute("insert into delivery (id, requirement_number, tenant_id, system_id, accepted_digest, created_by_user_id) values ('duplicate', 7, 'tenant', 'owner/repository', 'digest', 'other')")))
      .toContain('delivery_identity_uq');
    expect(await rejectedConstraint(database.db.execute("insert into operation (idempotency_key, delivery_id, factory_user_id, kind) values ('second-chat', 'delivery-1', 'creator', 'coder-chat-create')")))
      .toContain('operation_delivery_kind_uq');
    expect(await rejectedConstraint(database.db.execute("insert into operation (idempotency_key, delivery_id, factory_user_id, kind) values ('not-a-contributor', 'delivery-1', 'other', 'other-operation')")))
      .toContain('operation_delivery_contributor_fk');
    expect(await rejectedConstraint(database.db.execute("update operation set state = 'running' where idempotency_key = 'create-chat'")))
      .toContain('operation_lease_check');

    await database.db.execute("insert into delivery_contributor (delivery_id, factory_user_id) values ('delivery-1', 'other')");
    expect(await rejectedConstraint(database.db.execute("insert into operation (idempotency_key, delivery_id, factory_user_id, kind) values ('other-chat', 'delivery-1', 'other', 'coder-chat-create')")))
      .toContain('operation_delivery_kind_uq');
    const operations = await database.db.execute<{ count: number }>(sql`select count(*)::int as count from operation where delivery_id = 'delivery-1' and kind = 'coder-chat-create'`);
    expect(operations[0]?.count).toBe(1);

    await database.db.execute("insert into \"user\" (id, name, email, deprovisioned_at) values ('deprovisioned', 'Deprovisioned', 'deprovisioned@example.test', now())");
    expect(await rejectedConstraint(database.db.execute("insert into delivery_contributor (delivery_id, factory_user_id) values ('delivery-1', 'deprovisioned')")))
      .toContain('cannot grant authority to deprovisioned user');

    await database.db.execute("update operation set state = 'failed', error = 'Coder rejected the request' where idempotency_key = 'create-chat'");
    await database.db.execute("insert into operation (idempotency_key, delivery_id, factory_user_id, kind) values ('retry-chat', 'delivery-1', 'other', 'coder-chat-create')");
    await database.db.execute("update operation set state = 'running', lease_owner = 'worker-1', lease_expires_at = now() + interval '5 minutes' where idempotency_key = 'retry-chat'");
    await database.db.execute("update operation set state = 'ambiguous', lease_owner = null, lease_expires_at = null, error = 'Coder response was lost' where idempotency_key = 'retry-chat'");
    expect(await rejectedConstraint(database.db.execute("insert into operation (idempotency_key, delivery_id, factory_user_id, kind) values ('unsafe-retry', 'delivery-1', 'creator', 'coder-chat-create')")))
      .toContain('operation_delivery_kind_uq');
  });
});

async function seedModel(db: ReturnType<typeof createDatabase>['db']): Promise<void> {
  await db.execute("insert into \"user\" (id, name, email, email_verified) values ('creator', 'Creator', 'creator@example.test', true), ('other', 'Other', 'other@example.test', true)");
  await db.execute("insert into system_registration (tenant_id, system_id, team_id, forgejo_owner, forgejo_repository) values ('tenant', 'owner/repository', 'team', 'owner', 'repository')");
  await db.execute("insert into coder_user_binding (factory_user_id, coder_user_id) values ('creator', 'coder-creator')");
  await db.execute("insert into delivery (id, requirement_number, tenant_id, system_id, accepted_digest, created_by_user_id) values ('delivery-1', 7, 'tenant', 'owner/repository', 'digest', 'creator')");
  await db.execute("insert into delivery_contributor (delivery_id, factory_user_id) values ('delivery-1', 'creator')");
  await db.execute("insert into operation (idempotency_key, delivery_id, factory_user_id, kind) values ('create-chat', 'delivery-1', 'creator', 'coder-chat-create')");
}

async function rejectedConstraint(query: PromiseLike<unknown>): Promise<string> {
  const error = await Promise.resolve(query).then(() => null, (caught: unknown) => caught);
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? cause.message : error.message;
}

async function withTemporaryDatabase(run: (database: ReturnType<typeof createDatabase>) => Promise<void>): Promise<void> {
  const adminUrl = new URL(process.env.TEST_DATABASE_URL!);
  const databaseName = `factory_migration_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = createDatabase(adminUrl.toString());
  adminUrl.pathname = `/${databaseName}`;
  try {
    await admin.db.execute(`create database "${databaseName}"`);
    const database = createDatabase(adminUrl.toString());
    try {
      await run(database);
    } finally {
      await closeDatabase(database.sql);
    }
  } finally {
    await admin.db.execute(`drop database if exists "${databaseName}" with (force)`).catch(() => undefined);
    await closeDatabase(admin.sql);
  }
}
