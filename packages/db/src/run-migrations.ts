/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { createDatabase } from './index';
import { bundledMigrationsFolder, closeDatabase, migrateDatabase } from './migrate';

export async function runMigrations(migrationsFolder = bundledMigrationsFolder): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const environment = process.env.FACTORY_ENVIRONMENT ?? 'local';
  const tlsCa = process.env.DATABASE_TLS_CA?.trim();
  if (environment === 'production' && (new URL(databaseUrl).searchParams.get('sslmode') !== 'verify-full' || !tlsCa)) {
    throw new Error('production DATABASE_URL must set sslmode=verify-full and DATABASE_TLS_CA must contain the PostgreSQL CA PEM');
  }
  const database = createDatabase(databaseUrl, tlsCa);
  try {
    await migrateDatabase(database.db, migrationsFolder);
  } finally {
    await closeDatabase(database.sql);
  }
}

if (import.meta.main) await runMigrations();
