/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { Database } from './index';
import type postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export async function migrateDatabase(db: Database, migrationsFolder: string): Promise<void> {
  await assertCompatibleBaseline(db, migrationsFolder);
  await migrate(db, { migrationsFolder });
  await assertDatabaseSchema(db, migrationsFolder);
}

async function assertCompatibleBaseline(db: Database, migrationsFolder: string): Promise<void> {
  const expected = readMigrationFiles({ migrationsFolder });
  if (expected.length !== 1) throw new Error('bundled migrations must contain exactly one clean baseline');

  const state = await db.execute<{ migration_table: string | null; has_application_tables: boolean }>(`
    select
      to_regclass('drizzle.__drizzle_migrations')::text as migration_table,
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
      ) as has_application_tables
  `);
  const current = state[0];
  if (!current?.migration_table) {
    if (!current?.has_application_tables) return;
    throw unsupportedUpgrade('application tables exist without this baseline migration history');
  }

  let applied: Array<{ hash: string; created_at: string }>;
  try {
    applied = await db.execute<{ hash: string; created_at: string }>(
      'select hash, created_at from drizzle.__drizzle_migrations order by created_at, id',
    );
  } catch (cause) {
    throw new Error(unsupportedUpgrade('the applied migration history cannot be read').message, { cause });
  }
  const baseline = expected[0]!;
  if (applied.length !== 1 || applied[0]?.hash !== baseline.hash || Number(applied[0]?.created_at) !== baseline.folderMillis) {
    throw unsupportedUpgrade('the applied baseline does not match this release');
  }
}

function unsupportedUpgrade(reason: string): Error {
  return new Error(`unsupported database upgrade: ${reason}. This project supports one clean baseline only; reset the database and install on an empty schema`);
}

/** Tables are intentionally managed by Drizzle migrations, never mutated at request time. */
export async function assertDatabaseSchema(db: Database, migrationsFolder: string): Promise<void> {
  const expected = readMigrationFiles({ migrationsFolder });
  const applied = await db.execute<{ hash: string; created_at: string }>(
    'select hash, created_at from drizzle.__drizzle_migrations order by created_at, id',
  );
  const matches = applied.length === expected.length && expected.every((migration, index) => {
    const row = applied[index];
    return row?.hash === migration.hash && Number(row.created_at) === migration.folderMillis;
  });
  if (!matches) throw new Error('database migration state does not match bundled migrations');

  await db.execute('select 1 from "user" limit 0');
  await db.execute('select 1 from "oauth_client" limit 0');
  await db.execute('select 1 from "system_registration" limit 0');
  await db.execute('select 1 from "system_onboarding" limit 0');
  await db.execute('select 1 from "system_onboarding_event" limit 0');
  await db.execute('select 1 from "staging_reconciliation" limit 0');
  await db.execute('select 1 from "staging_reconciliation_event" limit 0');
  await db.execute('select 1 from "workspace_startup" limit 0');
  await db.execute('select 1 from "coder_user_binding" limit 0');
  await db.execute('select 1 from "delivery" limit 0');
  await db.execute('select 1 from "delivery_completion" limit 0');
  await db.execute('select 1 from "delivery_verification" limit 0');
  await db.execute('select 1 from "delivery_lifecycle_event" limit 0');
  await db.execute('select 1 from "delivery_contributor" limit 0');
  await db.execute('select 1 from "operation" limit 0');
}

export async function closeDatabase(sql: postgres.Sql): Promise<void> {
  await sql.end({ timeout: 5 });
}
