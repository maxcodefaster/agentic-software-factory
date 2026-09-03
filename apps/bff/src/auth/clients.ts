/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { eq } from 'drizzle-orm';

import type { Database } from '@agentic-software-factory/db';
import { oauthClient } from '@agentic-software-factory/db/schema';
import type { ConfidentialClientConfig, FactoryAuthConfig } from './config';
import { OIDC_SCOPES } from './config';
import { sha256Base64Url } from './security';

interface NamedClient extends ConfidentialClientConfig {
  name: string;
}

function configuredClients(config: FactoryAuthConfig): NamedClient[] {
  return [
    config.coder ? { ...config.coder, name: 'Coder' } : undefined,
    config.forgejo ? { ...config.forgejo, name: 'Forgejo' } : undefined,
  ].filter((client): client is NamedClient => client !== undefined);
}

/** Idempotently installs the two operator-owned confidential clients from env. */
export async function bootstrapConfidentialClients(
  db: Database,
  config: FactoryAuthConfig,
): Promise<void> {
  for (const client of configuredClients(config)) {
    const storedSecret = await sha256Base64Url(client.clientSecret);
    const scopes = client.policy === 'coder'
      ? [...OIDC_SCOPES]
      : OIDC_SCOPES.filter((scope) => scope !== 'offline_access' && scope !== 'mcp:call');
    const values = {
      id: `static:${client.clientId}`,
      clientId: client.clientId,
      clientSecret: storedSecret,
      name: client.name,
      redirectUris: client.redirectUris,
      postLogoutRedirectUris: client.postLogoutRedirectUris ?? [],
      tokenEndpointAuthMethod: 'client_secret_basic',
      applicationType: 'web',
      grantTypes: client.policy === 'coder' ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
      responseTypes: ['code'],
      scopes,
      requirePKCE: client.policy === 'coder',
      skipConsent: true,
      enableEndSession: true,
      disabled: false,
      updatedAt: new Date(),
    };
    await db
      .insert(oauthClient)
      .values(values)
      .onConflictDoUpdate({ target: oauthClient.clientId, set: values });
  }
}

export async function configuredClientExists(db: Database, clientId: string): Promise<boolean> {
  const row = await db.query.oauthClient.findFirst({
    columns: { id: true },
    where: eq(oauthClient.clientId, clientId),
  });
  return row !== undefined;
}
