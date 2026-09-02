/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../db';
import {
  account,
  coderUserBinding,
  delivery,
  deliveryCompletion,
  deliveryContributor,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  operation,
  session,
  systemRegistration,
  user,
} from '../db/schema';
import { deliveryBranchName } from '../implementation/store';

export interface DeprovisionedUser {
  id: string;
  coderUserId: string | null;
  coderDeprovisioned: boolean;
}

export interface ForgejoContributorRevocation {
  deliveryId: string;
  factoryUserId: string;
  username: string;
  owner: string;
  repository: string;
  branch: string;
}

export class UserDeprovisionStore {
  constructor(private readonly db: Database) {}

  async deprovision(userId: string, tenantGroup: string): Promise<DeprovisionedUser | null> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx.select({
        id: user.id,
        groups: user.groups,
        deprovisionedAt: user.deprovisionedAt,
        deprovisionedCoderUserId: user.deprovisionedCoderUserId,
        coderDeprovisionedAt: user.coderDeprovisionedAt,
      }).from(user).where(eq(user.id, userId)).limit(1).for('update');
      if (!target || (!target.groups.includes(tenantGroup) && !target.deprovisionedAt)) return null;

      const [binding] = await tx.select({ coderUserId: coderUserBinding.coderUserId })
        .from(coderUserBinding).where(eq(coderUserBinding.factoryUserId, userId)).limit(1);
      const coderUserId = target.deprovisionedCoderUserId ?? binding?.coderUserId ?? null;
      const clientRows = await tx.select({ clientId: oauthClient.clientId }).from(oauthClient).where(eq(oauthClient.userId, userId));
      const clientIds = clientRows.map((row) => row.clientId);
      await tx.update(operation).set({
        state: 'failed', leaseOwner: null, leaseExpiresAt: null, error: 'User deprovisioned', updatedAt: new Date(),
      }).where(sql`${operation.factoryUserId} = ${userId} and ${operation.state} in ('pending', 'running', 'ambiguous', 'succeeded')`);
      await tx.delete(oauthAccessToken).where(clientIds.length
        ? or(eq(oauthAccessToken.userId, userId), inArray(oauthAccessToken.clientId, clientIds))!
        : eq(oauthAccessToken.userId, userId));
      await tx.delete(oauthRefreshToken).where(clientIds.length
        ? or(eq(oauthRefreshToken.userId, userId), inArray(oauthRefreshToken.clientId, clientIds))!
        : eq(oauthRefreshToken.userId, userId));
      await tx.delete(oauthConsent).where(clientIds.length
        ? or(eq(oauthConsent.userId, userId), inArray(oauthConsent.clientId, clientIds))!
        : eq(oauthConsent.userId, userId));
      if (!target.deprovisionedAt) {
        await tx.update(oauthClient).set({ disabled: true, clientSecret: null, updatedAt: new Date() }).where(eq(oauthClient.userId, userId));
        await tx.update(account).set({
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          password: null,
          updatedAt: new Date(),
        }).where(eq(account.userId, userId));
      }
      await tx.delete(session).where(eq(session.userId, userId));
      await tx.delete(coderUserBinding).where(eq(coderUserBinding.factoryUserId, userId));
      await tx.execute(sql`
        delete from verification
        where value = ${userId}
           or case when pg_input_is_valid(value, 'jsonb') then value::jsonb ->> 'userId' = ${userId} else false end
      `);
      await tx.update(user).set({
        groups: [],
        deprovisionedAt: target.deprovisionedAt ?? new Date(),
        deprovisionedCoderUserId: coderUserId,
        coderDeprovisionedAt: coderUserId ? target.coderDeprovisionedAt : target.coderDeprovisionedAt ?? new Date(),
        updatedAt: new Date(),
      }).where(eq(user.id, userId));

      return { id: target.id, coderUserId, coderDeprovisioned: Boolean(target.coderDeprovisionedAt) || !coderUserId };
    });
  }

  async markCoderDeprovisioned(userId: string, coderUserId: string): Promise<void> {
    await this.db.update(user).set({ coderDeprovisionedAt: new Date(), updatedAt: new Date() }).where(sql`
      ${user.id} = ${userId} and ${user.deprovisionedCoderUserId} = ${coderUserId} and ${user.deprovisionedAt} is not null
    `);
  }

  async pendingCoderDeprovisions(limit = 100): Promise<Array<{ userId: string; coderUserId: string }>> {
    return this.db.select({ userId: user.id, coderUserId: user.deprovisionedCoderUserId })
      .from(user)
      .where(sql`${user.deprovisionedAt} is not null and ${user.deprovisionedCoderUserId} is not null and ${user.coderDeprovisionedAt} is null`)
      .limit(limit) as Promise<Array<{ userId: string; coderUserId: string }>>;
  }

  async pendingForgejoRevocations(userId?: string, limit = 100): Promise<ForgejoContributorRevocation[]> {
    const rows = await this.db.select({
      deliveryId: delivery.id,
      requirementNumber: delivery.requirementNumber,
      factoryUserId: deliveryContributor.factoryUserId,
      username: user.preferredUsername,
      owner: systemRegistration.forgejoOwner,
      repository: systemRegistration.forgejoRepository,
    }).from(deliveryContributor)
      .innerJoin(delivery, eq(delivery.id, deliveryContributor.deliveryId))
      .innerJoin(user, eq(user.id, deliveryContributor.factoryUserId))
      .innerJoin(systemRegistration, and(
        eq(systemRegistration.tenantId, delivery.tenantId),
        eq(systemRegistration.systemId, delivery.systemId),
      ))
      .leftJoin(deliveryCompletion, eq(deliveryCompletion.deliveryId, delivery.id))
      .where(and(
        sql`${user.deprovisionedAt} is not null`,
        isNull(deliveryContributor.forgejoAccessRevokedAt),
        or(isNull(deliveryCompletion.deliveryId), ne(deliveryCompletion.phase, 'complete')),
        ...(userId ? [eq(deliveryContributor.factoryUserId, userId)] : []),
      ))
      .limit(limit);
    return rows.map((row) => ({ ...row, branch: deliveryBranchName({ id: row.deliveryId, requirementNumber: row.requirementNumber }) }));
  }

  async markForgejoAccessRevoked(deliveryIds: string[], factoryUserId: string): Promise<void> {
    if (deliveryIds.length === 0) return;
    await this.db.update(deliveryContributor).set({ forgejoAccessRevokedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(deliveryContributor.factoryUserId, factoryUserId),
      inArray(deliveryContributor.deliveryId, deliveryIds),
    ));
  }
}

export interface UserDeprovisionCoder {
  deprovisionUser(coderUserId: string, signal?: AbortSignal): Promise<{ revokedTokenCount: number }>;
}

export interface UserDeprovisionForgejo {
  revokeImplementationContributorBranch(owner: string, repository: string, branch: string, contributor: string, signal?: AbortSignal): Promise<void>;
  removeCollaborator(owner: string, repository: string, username: string, signal?: AbortSignal): Promise<void>;
}

export interface UserDeprovisionResult {
  id: string;
  status: 'deprovisioned';
  persisted: true;
  coder: { status: 'suspended' | 'not-linked' | 'pending'; revokedTokenCount?: number };
  forgejo: { status: 'requested'; immediate: boolean };
}

export class UserDeprovisionService {
  constructor(
    private readonly store: UserDeprovisionStore,
    private readonly coder: UserDeprovisionCoder,
    private readonly forgejo: UserDeprovisionForgejo,
    private readonly requestForgejoReconciliation: () => boolean,
  ) {}

  async deprovision(userId: string, tenantGroup: string): Promise<UserDeprovisionResult | null> {
    const target = await this.store.deprovision(userId, tenantGroup);
    if (!target) return null;
    const immediate = this.requestForgejoReconciliation();
    await this.reconcileForgejo(userId).catch(() => undefined);
    if (!target.coderUserId) return {
      id: userId, status: 'deprovisioned', persisted: true,
      coder: { status: 'not-linked' }, forgejo: { status: 'requested', immediate },
    };
    if (target.coderDeprovisioned) return {
      id: userId, status: 'deprovisioned', persisted: true,
      coder: { status: 'suspended' }, forgejo: { status: 'requested', immediate },
    };
    try {
      const result = await this.coder.deprovisionUser(target.coderUserId, AbortSignal.timeout(10_000));
      await this.store.markCoderDeprovisioned(userId, target.coderUserId);
      return {
        id: userId, status: 'deprovisioned', persisted: true,
        coder: { status: 'suspended', revokedTokenCount: result.revokedTokenCount },
        forgejo: { status: 'requested', immediate },
      };
    } catch {
      return {
        id: userId, status: 'deprovisioned', persisted: true,
        coder: { status: 'pending' }, forgejo: { status: 'requested', immediate },
      };
    }
  }

  async reconcileCoder(signal?: AbortSignal): Promise<void> {
    for (const pending of await this.store.pendingCoderDeprovisions()) {
      signal?.throwIfAborted();
      await this.coder.deprovisionUser(pending.coderUserId, signal);
      await this.store.markCoderDeprovisioned(pending.userId, pending.coderUserId);
    }
  }


  async reconcileForgejo(userId?: string, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const pending = await this.store.pendingForgejoRevocations(userId);
      if (pending.length === 0) return;
      const repositories = new Map<string, ForgejoContributorRevocation[]>();
      for (const revocation of pending) {
        const key = `${revocation.factoryUserId}\n${revocation.owner}\n${revocation.repository}`;
        const group = repositories.get(key) ?? [];
        group.push(revocation);
        repositories.set(key, group);
      }
      for (const revocations of repositories.values()) {
        signal?.throwIfAborted();
        const first = revocations[0]!;
        for (const revocation of revocations) {
          await this.forgejo.revokeImplementationContributorBranch(
            revocation.owner, revocation.repository, revocation.branch, revocation.username, signal,
          );
        }
        await this.forgejo.removeCollaborator(first.owner, first.repository, first.username, signal);
        await this.store.markForgejoAccessRevoked(revocations.map((revocation) => revocation.deliveryId), first.factoryUserId);
      }
    }
  }
}
