/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { createDatabase } from '../../apps/bff/src/db';
import { closeDatabase } from '../../apps/bff/src/db/migrate';
import { bootstrapLocalUser } from '../../apps/bff/src/auth/bootstrap-user';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const database = createDatabase(required('DATABASE_URL'));
const group = required('FACTORY_TENANT_GROUP');
const businessGroup = required('FACTORY_BUSINESS_GROUP');
const developerGroup = required('FACTORY_DEVELOPER_GROUP');
const adminGroup = required('FACTORY_ADMIN_GROUP');
const teamGroups = (() => {
  const source = process.env.FACTORY_TEAM_BOARDS?.trim();
  if (!source) return [];
  const value = JSON.parse(source) as Array<{ group?: unknown }>;
  return value.flatMap((team) => typeof team.group === 'string' && team.group.trim() ? [team.group.trim()] : []);
})();

try {
  await reconcileBootstrapUser({
    email: required('AUTH_BOOTSTRAP_USER_EMAIL'),
    name: required('AUTH_BOOTSTRAP_USER_NAME'),
    password: required('AUTH_BOOTSTRAP_USER_PASSWORD'),
    groups: [group, adminGroup, businessGroup, developerGroup, ...teamGroups],
  });
  await reconcileBootstrapUser({
    email: 'business@example.test',
    name: 'Factory Business User',
    password: required('AUTH_E2E_BUSINESS_PASSWORD'),
    groups: [group, businessGroup, ...teamGroups],
  });
  await reconcileBootstrapUser({
    email: 'implementer@example.test',
    name: 'Factory Developer',
    password: required('AUTH_E2E_DEVELOPER_PASSWORD'),
    groups: [group, developerGroup, ...teamGroups],
  });
} finally {
  await closeDatabase(database.sql);
}

async function reconcileBootstrapUser(config: Parameters<typeof bootstrapLocalUser>[1]): Promise<void> {
  await bootstrapLocalUser(database.db, config);
}
