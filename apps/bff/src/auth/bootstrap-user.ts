/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import type { Database } from '../db';
import { account, user } from '../db/schema';
import type { BootstrapUserConfig } from './config';
import { sha256Base64Url } from './security';

const CREDENTIAL_ISSUER = 'local:credential';

/** Installs or updates only the local credential identity deterministically owned by bootstrap. */
export async function bootstrapLocalUser(db: Database, config: BootstrapUserConfig): Promise<void> {
  const digest = await sha256Base64Url(config.email);
  const userId = `bootstrap:${digest}`;
  const accountId = `bootstrap-credential:${digest}`;
  const preferredUsername = config.email.split('@')[0] || config.email;
  const password = await hashPassword(config.password);

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      email: config.email,
      emailVerified: true,
      name: config.name,
      preferredUsername,
      groups: config.groups,
    }).onConflictDoNothing({ target: user.email });

    const existing = await tx.query.user.findFirst({
      columns: { id: true },
      where: eq(user.email, config.email),
    });
    if (existing?.id !== userId) {
      throw new Error('LOCAL_AUTH_EMAIL belongs to an existing non-bootstrap user');
    }

    await tx.update(user).set({
      emailVerified: true,
      name: config.name,
      preferredUsername,
      groups: config.groups,
      updatedAt: new Date(),
    }).where(eq(user.id, userId));

    await tx.insert(account).values({
      id: accountId,
      issuer: CREDENTIAL_ISSUER,
      accountId: userId,
      providerId: 'credential',
      userId,
      password,
    }).onConflictDoUpdate({
      target: [account.issuer, account.accountId],
      set: { password, updatedAt: new Date() },
    });
  });
}
