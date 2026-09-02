/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { createHttpBoundary } from './boundary';
import type { ServerServices } from './types';

function invoke(boundary: ReturnType<typeof createHttpBoundary>, request: Request) {
  return boundary.onRequest({
    request,
    set: { headers: {} },
    server: { requestIP: () => ({ address: '203.0.113.7' }) },
  });
}

describe('HTTP rate-limit boundary', () => {
  test('allows Angular component styles without weakening script execution', async () => {
    const boundary = createHttpBoundary({} as ServerServices);
    const set = { headers: {} as Record<string, string | number> };

    await boundary.onRequest({
      request: new Request('https://factory.example/board/42'),
      set,
      server: { requestIP: () => ({ address: '203.0.113.7' }) },
    });

    const policy = String(set.headers['content-security-policy']);
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("script-src 'self'");
    expect(policy.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
  });

  test('applies the write quota to every mutating API verb but not reads', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const boundary = createHttpBoundary({ rateLimits: { writes: 1 } } as ServerServices);
      expect(await invoke(boundary, new Request('https://factory.example/api/v1/unmatched', { method }))).toBeUndefined();
      expect((await invoke(boundary, new Request('https://factory.example/api/v1/unmatched', { method })))?.status).toBe(429);
    }

    const boundary = createHttpBoundary({ rateLimits: { writes: 1 } } as ServerServices);
    expect(await invoke(boundary, new Request('https://factory.example/api/v1/unmatched'))).toBeUndefined();
    expect(await invoke(boundary, new Request('https://factory.example/api/v1/unmatched'))).toBeUndefined();
  });

  test('overwrites the private Better Auth client address header', async () => {
    const boundary = createHttpBoundary({ rateLimits: { auth: 2 } } as ServerServices);
    const request = new Request('https://factory.example/sign-in/email', {
      method: 'POST',
      headers: { 'x-factory-client-ip': '192.0.2.99', 'x-real-ip': '192.0.2.100' },
    });

    expect(await invoke(boundary, request)).toBeUndefined();
    expect(request.headers.get('x-factory-client-ip')).toBe('203.0.113.7');
  });
});
