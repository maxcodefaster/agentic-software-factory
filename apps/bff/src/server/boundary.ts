/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ServerServices } from './types';
import { BlockList, isIP } from 'node:net';
import { applicationErrorCodeForStatus, errorResponseSchema } from '@agentic-software-factory/api-contracts/errors';
import type { ApplicationError, ApplicationErrorCode, SanitizedErrorCause } from '../errors';
import { validateResponse } from './response-contracts';

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_MCP_BODY_BYTES = 256 * 1024;

export const SPA_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'";

const securityHeaders = {
  'content-security-policy': SPA_CONTENT_SECURITY_POLICY,
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

export interface HttpRequestLog {
  timestamp: string;
  level: 'info';
  event: 'http_request';
  requestId: string;
  traceId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: { code: ApplicationErrorCode; cause?: SanitizedErrorCause };
}

export interface OperationalLog {
  timestamp: string;
  level: 'warn';
  event: 'ai_interview_start_failed' | 'ai_interview_blocked' | 'ai_interview_answer_failed' | 'ai_interview_sharpen_failed' | 'ai_interview_reconcile_failed';
  requirementNumber?: number;
}

export type RequestLog = HttpRequestLog | OperationalLog;

interface RequestState {
  requestId: string;
  traceId: string;
  startedAt: number;
  startedAtUnixNano: string;
  method: string;
  path: string;
  error?: { code: ApplicationErrorCode; cause?: SanitizedErrorCause };
}

interface LimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  auth: number;
  mcp: number;
  writes: number;
  windowMs: number;
  maxEntries: number;
}

const defaultRateLimits: RateLimitOptions = {
  auth: 30,
  mcp: 60,
  writes: 20,
  windowMs: 60_000,
  maxEntries: 10_000,
};

function boundaryError(message: string, status: number): Response {
  return Response.json(validateResponse(errorResponseSchema, {
    error: message,
    code: applicationErrorCodeForStatus(status),
  }), { status });
}

// This process-local limiter is defense-in-depth, not a cluster-wide quota.
class BoundedRateLimiter {
  private readonly entries = new Map<string, LimitEntry>();

  constructor(private readonly options: RateLimitOptions) {}

  consume(key: string, limit: number, now = Date.now()): number | null {
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.entries.size >= this.options.maxEntries) {
        const oldest = this.entries.keys().next().value as string | undefined;
        if (oldest) this.entries.delete(oldest);
      }
      this.entries.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return null;
    }
    if (current.count >= limit) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    current.count += 1;
    return null;
  }
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id');
  return supplied && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function traceId(request: Request): string {
  const traceparent = request.headers.get('traceparent');
  const supplied = traceparent?.match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/)?.[1];
  return supplied ?? crypto.randomUUID().replaceAll('-', '');
}

function trustedProxyList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const parts = cidr.split('/');
    const [address, prefixValue] = parts;
    const version = address ? isIP(address) : 0;
    const prefix = Number(prefixValue);
    if (parts.length !== 2 || !version || !/^\d+$/.test(prefixValue ?? '') || prefix > (version === 4 ? 32 : 128)) {
      throw new Error(`invalid trusted proxy CIDR: ${cidr}`);
    }
    list.addSubnet(address!, prefix, version === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

export function validateTrustedProxyCidrs(cidrs: readonly string[]): void {
  trustedProxyList(cidrs);
}

function rateLimitAddress(request: Request, socketAddress: string, trustedProxies: BlockList): string {
  const socketVersion = isIP(socketAddress);
  if (!socketVersion || !trustedProxies.check(socketAddress, socketVersion === 4 ? 'ipv4' : 'ipv6')) return socketAddress;
  const ingressAddress = request.headers.get('x-real-ip')?.trim();
  return ingressAddress && isIP(ingressAddress) ? ingressAddress : socketAddress;
}

function isNoStorePath(path: string): boolean {
  return path.startsWith('/api/')
    || path.startsWith('/auth/')
    || path.startsWith('/oauth2/')
    || path.startsWith('/sign-')
    || path.startsWith('/callback/')
    || path.startsWith('/.well-known/')
    || path === '/login'
    || path === '/consent'
    || path === '/get-session'
    || path === '/jwks'
    || path === '/__factory/logout'
    || path === '/mcp'
    || path === '/healthz'
    || path === '/readyz'
    || path === '/statusz';
}

function limitCategory(method: string, path: string): 'auth' | 'mcp' | 'writes' | null {
  if (path === '/mcp') return 'mcp';
  if ((method === 'GET' || method === 'HEAD') && ['/auth/config', '/login', '/consent'].includes(path)) return null;
  if (method === 'GET' && path === '/oauth2/authorize') return null;
  if (path.startsWith('/auth/') || path.startsWith('/api/auth/') || path.startsWith('/sign-in/')
    || path.startsWith('/sign-up/') || path.startsWith('/change-password') || path.startsWith('/verify-password')
    || path.startsWith('/request-password-reset') || path.startsWith('/reset-password') || path.startsWith('/callback/') || path.startsWith('/oauth2/')
    || path === '/login' || path === '/consent' || path === '/get-session' || path === '/__factory/logout') return 'auth';
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  if (path.startsWith('/api/v1/')) return 'writes';
  return null;
}

function responseStatus(responseValue: unknown, setStatus: number | string | undefined): number {
  if (responseValue instanceof Response) return responseValue.status;
  if (typeof setStatus === 'number') return setStatus;
  return 200;
}

async function bodyExceeds(request: Request, maximum: number): Promise<boolean> {
  if (!request.body) return false;
  const reader = request.clone().body!.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      size += value.byteLength;
      if (size > maximum) return true;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createHttpBoundary(services: ServerServices) {
  const states = new WeakMap<Request, RequestState>();
  const logged = new WeakSet<Request>();
  const options = { ...defaultRateLimits, ...services.rateLimits };
  const limiter = new BoundedRateLimiter(options);
  const trustedProxies = trustedProxyList(services.trustedProxyCidrs ?? []);
  const origins = new Set(services.allowedOrigins ?? []);
  const log = services.log ?? ((entry: RequestLog) => console.log(JSON.stringify(entry)));

  return {
    async onRequest({ request, set, server }: { request: Request; set: { headers: Record<string, string | number>; status?: number | string }; server: { requestIP(request: Request): { address: string } | null } | null }): Promise<Response | undefined> {
      const url = new URL(request.url);
      const state = { requestId: requestId(request), traceId: traceId(request), startedAt: performance.now(), startedAtUnixNano: `${BigInt(Date.now()) * 1_000_000n}`, method: request.method, path: url.pathname };
      states.set(request, state);
      Object.assign(set.headers, securityHeaders, { 'x-request-id': state.requestId, 'x-trace-id': state.traceId });
      if (isNoStorePath(url.pathname)) set.headers['cache-control'] = 'no-store';

      const origin = request.headers.get('origin');
      if (origin && origins.has(origin)) {
        set.headers['access-control-allow-origin'] = origin;
        set.headers['access-control-allow-credentials'] = 'true';
        set.headers['access-control-allow-headers'] = 'Authorization, Content-Type, X-Requested-With, X-Request-ID';
        set.headers['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
        set.headers['access-control-expose-headers'] = 'X-Request-ID, Retry-After';
        set.headers['vary'] = 'Origin';
      } else if (origin && origin !== url.origin) {
        return boundaryError('origin not allowed', 403);
      }

      const maximum = url.pathname === '/mcp' ? MAX_MCP_BODY_BYTES : MAX_BODY_BYTES;
      const contentLength = request.headers.get('content-length');
      const length = Number(contentLength);
      if (contentLength && Number.isFinite(length) && length > maximum) {
        return boundaryError('payload too large', 413);
      }
      const category = limitCategory(request.method, url.pathname);
      if (category) {
        const socketAddress = server?.requestIP(request)?.address ?? 'unknown';
        const address = rateLimitAddress(request, socketAddress, trustedProxies);
        request.headers.set('x-factory-client-ip', address);
        const retryAfter = limiter.consume(`${category}:${address}`, options[category]);
        if (retryAfter !== null) {
          set.headers['retry-after'] = String(retryAfter);
          return boundaryError('too many requests', 429);
        }
      }
      if ((!contentLength || !Number.isFinite(length) || !server) && await bodyExceeds(request, maximum)) {
        return boundaryError('payload too large', 413);
      }
      return undefined;
    },
    recordError(request: Request, error: ApplicationError): void {
      const state = states.get(request);
      if (state) state.error = { code: error.code, ...(error.sanitizedCause ? { cause: error.sanitizedCause } : {}) };
    },
    onAfterResponse({ request, responseValue, set }: { request: Request; responseValue: unknown; set: { status?: number | string } }): void {
      const state = states.get(request);
      if (!state || logged.has(request)) return;
      logged.add(request);
      const status = responseStatus(responseValue, set.status);
      const durationMs = Math.max(0, Math.round((performance.now() - state.startedAt) * 100) / 100);
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'http_request',
        requestId: state.requestId,
        traceId: state.traceId,
        method: state.method,
        path: state.path,
        status,
        durationMs,
        ...(state.error ? { error: state.error } : {}),
      });
      services.trace?.({
        traceId: state.traceId,
        spanId: crypto.randomUUID().replaceAll('-', '').slice(0, 16),
        name: `${state.method} ${state.path}`,
        startedAtUnixNano: state.startedAtUnixNano,
        endedAtUnixNano: `${BigInt(Date.now()) * 1_000_000n}`,
        attributes: { 'http.request.method': state.method, 'url.path': state.path, 'http.response.status_code': status },
        error: status >= 500,
      });
    },
  };
}

export async function parseBoundedJson(request: Request): Promise<unknown> {
  const maximum = new URL(request.url).pathname === '/mcp' ? MAX_MCP_BODY_BYTES : MAX_BODY_BYTES;
  const bytes = await request.clone().arrayBuffer();
  if (bytes.byteLength > maximum) throw Object.assign(new Error('payload too large'), { status: 413 });
  try {
    const text = new TextDecoder().decode(bytes);
    return text ? JSON.parse(text) : undefined;
  } catch {
    throw Object.assign(new Error('invalid request'), { status: 400 });
  }
}
