/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, mock, test } from 'bun:test';

import { UserDeprovisionService, type UserDeprovisionStore } from './deprovision';

describe('UserDeprovisionService', () => {
  test('reports a persisted deprovision and wakes Forgejo reconciliation', async () => {
    const store = {
      deprovision: mock(async () => ({ id: 'user-1', coderUserId: 'coder-1', coderDeprovisioned: false })),
      markCoderDeprovisioned: mock(async () => undefined),
      pendingCoderDeprovisions: mock(async () => []),
      pendingForgejoRevocations: mock(async () => []),
      markForgejoAccessRevoked: mock(async () => undefined),
    } as unknown as UserDeprovisionStore;
    const coder = { deprovisionUser: mock(async () => ({ revokedTokenCount: 3 })) };
    const forgejo = { revokeImplementationContributorBranch: mock(async () => undefined), removeCollaborator: mock(async () => undefined) };
    const wake = mock(() => true);

    const result = await new UserDeprovisionService(store, coder, forgejo, wake).deprovision('user-1', 'tenant-factory');

    expect(result).toEqual({
      id: 'user-1', status: 'deprovisioned', persisted: true,
      coder: { status: 'suspended', revokedTokenCount: 3 },
      forgejo: { status: 'requested', immediate: true },
    });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  test('is idempotent and preserves pending Coder work for retry', async () => {
    const store = {
      deprovision: mock(async () => ({ id: 'user-1', coderUserId: 'coder-1', coderDeprovisioned: false })),
      markCoderDeprovisioned: mock(async () => undefined),
      pendingCoderDeprovisions: mock(async () => [{ userId: 'user-1', coderUserId: 'coder-1' }]),
      pendingForgejoRevocations: mock(async () => []),
      markForgejoAccessRevoked: mock(async () => undefined),
    } as unknown as UserDeprovisionStore;
    let fail = true;
    const coder = { deprovisionUser: mock(async () => {
      if (fail) throw new Error('Coder unavailable');
      return { revokedTokenCount: 1 };
    }) };
    const forgejo = { revokeImplementationContributorBranch: mock(async () => undefined), removeCollaborator: mock(async () => undefined) };
    const service = new UserDeprovisionService(store, coder, forgejo, () => false);

    expect(await service.deprovision('user-1', 'tenant-factory')).toMatchObject({
      persisted: true, coder: { status: 'pending' }, forgejo: { status: 'requested', immediate: false },
    });
    fail = false;
    await service.reconcileCoder();
    expect(store.markCoderDeprovisioned).toHaveBeenCalledWith('user-1', 'coder-1');

    (store.deprovision as ReturnType<typeof mock>).mockImplementation(async () => ({ id: 'user-1', coderUserId: 'coder-1', coderDeprovisioned: true }));
    expect(await service.deprovision('user-1', 'tenant-factory')).toMatchObject({ coder: { status: 'suspended' } });
    expect(coder.deprovisionUser).toHaveBeenCalledTimes(2);
  });

  test('revokes every exact delivery branch before removing direct repository access', async () => {
    const pending = [
      { deliveryId: 'delivery-1', factoryUserId: 'user-1', username: 'alice', owner: 'factory', repository: 'app', branch: 'factory/requirement-1-one' },
      { deliveryId: 'delivery-2', factoryUserId: 'user-1', username: 'alice', owner: 'factory', repository: 'app', branch: 'factory/requirement-2-two' },
    ];
    let read = false;
    const store = {
      pendingForgejoRevocations: mock(async () => read ? [] : pending),
      markForgejoAccessRevoked: mock(async () => { read = true; }),
    } as unknown as UserDeprovisionStore;
    const calls: string[] = [];
    const forgejo = {
      revokeImplementationContributorBranch: mock(async (_owner: string, _repository: string, branch: string) => { calls.push(`branch:${branch}`); }),
      removeCollaborator: mock(async () => { calls.push('collaborator'); }),
    };
    const service = new UserDeprovisionService(store, { deprovisionUser: mock(async () => ({ revokedTokenCount: 0 })) }, forgejo, () => false);

    await service.reconcileForgejo('user-1');

    expect(calls).toEqual(['branch:factory/requirement-1-one', 'branch:factory/requirement-2-two', 'collaborator']);
    expect(store.markForgejoAccessRevoked).toHaveBeenCalledWith(['delivery-1', 'delivery-2'], 'user-1');
  });
});
