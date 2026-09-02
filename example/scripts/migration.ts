/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/postgres-js/migrator";

type MigrationDatabase = Parameters<typeof migrate>[0];

export async function migrateDatabase(
  db: MigrationDatabase,
  migrationsFolder: string,
  apply: typeof migrate = migrate,
): Promise<void> {
  await assertCompatibleBaseline(db, migrationsFolder);
  await apply(db, { migrationsFolder });
}

async function assertCompatibleBaseline(
  db: MigrationDatabase,
  migrationsFolder: string,
): Promise<void> {
  const expected = readMigrationFiles({ migrationsFolder });
  if (expected.length !== 1)
    throw new Error(
      "bundled migrations must contain exactly one clean baseline",
    );
  const baseline = expected[0];
  if (!baseline)
    throw new Error(
      "bundled migrations must contain exactly one clean baseline",
    );

  const state = await db.execute<{
    migration_table: string | null;
    has_application_tables: boolean;
  }>(`
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
    throw unsupportedUpgrade(
      "application tables exist without this baseline migration history",
    );
  }

  const applied = await db.execute<{ hash: string; created_at: string }>(
    "select hash, created_at from drizzle.__drizzle_migrations order by created_at, id",
  );
  if (
    applied.length !== 1 ||
    applied[0]?.hash !== baseline.hash ||
    Number(applied[0]?.created_at) !== baseline.folderMillis
  ) {
    throw unsupportedUpgrade(
      "the applied baseline does not match this release",
    );
  }
}

function unsupportedUpgrade(reason: string): Error {
  return new Error(
    `unsupported database upgrade: ${reason}. This example supports one clean baseline only; reset the database and install on an empty schema`,
  );
}
