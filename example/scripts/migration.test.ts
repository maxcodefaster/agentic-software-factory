/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { migrate } from "drizzle-orm/postgres-js/migrator";

import { migrateDatabase } from "./migration";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");

test("refuses the retired three-migration history before applying the clean baseline", async () => {
  const execute = mock(async (query: string) =>
    query.includes("to_regclass")
      ? [
          {
            migration_table: "drizzle.__drizzle_migrations",
            has_application_tables: true,
          },
        ]
      : [
          { hash: "old-0", created_at: "1" },
          { hash: "old-1", created_at: "2" },
          { hash: "old-2", created_at: "3" },
        ],
  );
  const apply = mock(async () => undefined);

  await expect(
    migrateDatabase(
      { execute } as unknown as Parameters<typeof migrate>[0],
      migrationsFolder,
      apply as unknown as typeof migrate,
    ),
  ).rejects.toThrow(
    "unsupported database upgrade: the applied baseline does not match this release. This example supports one clean baseline only; reset the database and install on an empty schema",
  );
  expect(apply).not.toHaveBeenCalled();
});

test("accepts an empty schema and an already applied matching baseline", async () => {
  const [baseline] = readMigrationFiles({ migrationsFolder });
  if (!baseline) throw new Error("expected one baseline migration");
  const apply = mock(async () => undefined);
  const empty = mock(async () => [
    { migration_table: null, has_application_tables: false },
  ]);
  await migrateDatabase(
    { execute: empty } as unknown as Parameters<typeof migrate>[0],
    migrationsFolder,
    apply as unknown as typeof migrate,
  );

  const current = mock(async (query: string) =>
    query.includes("to_regclass")
      ? [
          {
            migration_table: "drizzle.__drizzle_migrations",
            has_application_tables: true,
          },
        ]
      : [{ hash: baseline.hash, created_at: String(baseline.folderMillis) }],
  );
  await migrateDatabase(
    { execute: current } as unknown as Parameters<typeof migrate>[0],
    migrationsFolder,
    apply as unknown as typeof migrate,
  );
  expect(apply).toHaveBeenCalledTimes(2);
});
