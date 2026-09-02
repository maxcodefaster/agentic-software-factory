/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import type { FactoryAuthConfig } from './config';
import { FactoryAuthService, type AuthCore } from './service';

const issuer = 'https://factory.example';
const authSecret = 'test-logout-secret';

function config(overrides: Partial<FactoryAuthConfig> = {}): FactoryAuthConfig {
  return {
    mode: 'local',
    issuer,
    secret: authSecret,
    trustedOrigins: [],
    requiredGroup: 'factory',
    personaGroups: { admin: 'factory-admin', business: 'factory-business', developer: 'factory-developer' },
    ...overrides,
  };
}

function service(authConfig: FactoryAuthConfig, logoutTimeoutMs = 5_000): FactoryAuthService {
  const core = {
    auth: {
      api: {
        signOut: mock(async () => new Response(null, { headers: { 'set-cookie': 'factory.session_token=; Max-Age=0' } })),
      },
    },
  } as unknown as AuthCore;
  return new FactoryAuthService(core, authConfig, undefined, logoutTimeoutMs);
}

function bridgeRequest(audience: 'coder' | 'forgejo', next = `${issuer}/login`): Request {
  const payload = Buffer.from(JSON.stringify({ audience, expiresAt: Date.now() + 60_000, next })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(payload).digest('base64url');
  return new Request(`https://${audience}.example/__factory/logout?${new URLSearchParams({ payload, signature })}`, {
    headers: { cookie: 'coder_session_token=coder; session=current; i_like_gitea=legacy; persistent=remembered; gitea_incredible=legacy-remembered' },
  });
}

afterEach(() => mock.restore());

describe('coordinated logout', () => {
  test('exposes only strict presentation settings to Angular', () => {
    const tenantId = crypto.randomUUID();
    const auth = service(config({ mode: 'entra', entra: {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`, tenantId,
      clientId: 'factory', clientSecret: 'secret', teamRoles: {},
    } }));

    expect(auth.uiConfig).toEqual({ localEmailPassword: false, organizationSignIn: true, postLoginRedirect: '/' });
    expect(auth.uiConfig).not.toHaveProperty('issuer');
    expect(auth.uiConfig).not.toHaveProperty('secret');
  });

  test('lands on the Angular login route after the Factory session ends', async () => {
    const response = await service(config()).handle(
      'logout',
      new Request(`${issuer}/auth/logout`, { method: 'POST', headers: { origin: issuer } }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${issuer}/login?return_to=%2F`);
  });

  test('starts a Forgejo-only logout chain', async () => {
    const response = await service(config({ forgejoPublicUrl: 'https://forgejo.example' })).handle(
      'logout',
      new Request(`${issuer}/auth/logout`, { method: 'POST', headers: { origin: issuer } }),
    );

    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://forgejo.example');
    expect(location.pathname).toBe('/__factory/logout');
  });

  test('reports a downstream Forgejo logout failure instead of redirecting', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('failed', { status: 500 }));

    const response = await service(config({ forgejoPublicUrl: 'https://forgejo.example' }))
      .logoutBridgeRequest(bridgeRequest('forgejo'));

    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ error: 'Forgejo logout failed' });
  });

  test('reports a downstream Coder logout failure instead of redirecting', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('failed', { status: 500 }));

    const response = await service(config({ coderPublicUrl: 'https://coder.example' }))
      .logoutBridgeRequest(bridgeRequest('coder'));

    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ error: 'Coder logout failed' });
  });

  test('clears current and legacy Forgejo cookies after downstream logout', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const response = await service(config({ forgejoPublicUrl: 'https://forgejo.example' }))
      .logoutBridgeRequest(bridgeRequest('forgejo'));
    const cookies = response.headers.getSetCookie();

    expect(response.status).toBe(303);
    for (const name of ['session', 'i_like_gitea', 'persistent', 'gitea_incredible']) {
      expect(cookies.some((value) => value.startsWith(`${name}=;`) && value.includes('Max-Age=0'))).toBe(true);
    }
  });

  test('bounds downstream logout and returns a sanitized failure', async () => {
    let downstreamSignal: AbortSignal | undefined;
    spyOn(globalThis, 'fetch').mockImplementation((async (_input, init) => {
      downstreamSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }) as typeof fetch);

    const response = await service(config({ coderPublicUrl: 'https://coder.example' }), 1)
      .logoutBridgeRequest(bridgeRequest('coder'));

    expect(downstreamSignal?.aborted).toBe(true);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Coder logout failed' });
  });

  test('combines request cancellation with the logout deadline', async () => {
    const controller = new AbortController();
    let downstreamSignal: AbortSignal | undefined;
    spyOn(globalThis, 'fetch').mockImplementation((async (_input, init) => {
      downstreamSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        queueMicrotask(() => controller.abort(new Error('browser disconnected')));
      });
    }) as typeof fetch);

    const base = bridgeRequest('forgejo');
    const request = new Request(base, { signal: controller.signal });
    const response = await service(config({ forgejoPublicUrl: 'https://forgejo.example' }))
      .logoutBridgeRequest(request);

    expect(downstreamSignal).not.toBe(controller.signal);
    expect(downstreamSignal?.reason).toEqual(controller.signal.reason);
    expect(response.status).toBe(502);
  });
});
