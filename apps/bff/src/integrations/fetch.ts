/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

export type UpstreamFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class UpstreamHttpError extends Error {
  readonly requestId?: string;

  constructor(readonly service: string, readonly status: number, requestId?: string) {
    super(`${service} returned ${status}`);
    this.name = "UpstreamHttpError";
    this.requestId = requestId && /^[A-Za-z0-9._-]{1,128}$/.test(requestId) ? requestId : undefined;
  }
}

export class UpstreamTimeoutError extends Error {
  constructor(readonly service: string, readonly timeoutMs: number) {
    super(`${service} request timed out`);
    this.name = "UpstreamTimeoutError";
  }
}

export interface UpstreamFetchOptions {
  service: string;
  timeoutMs: number;
  retryTransient?: boolean;
}

const transientStatuses = new Set([408, 429, 502, 503, 504]);
const maxErrorBodyBytes = 4_096;

export async function fetchUpstream(
  fetchImplementation: UpstreamFetch,
  input: string | URL | Request,
  init: RequestInit,
  options: UpstreamFetchOptions,
): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const retry = options.retryTransient === true && (method === "GET" || method === "HEAD");
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = init.signal == null ? timeoutSignal : AbortSignal.any([init.signal, timeoutSignal]);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchImplementation(input, { ...init, signal });
      if (retry && attempt === 0 && transientStatuses.has(response.status)) {
        await discardErrorBody(response);
        continue;
      }
      return response;
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason ?? error;
      if (timeoutSignal.aborted) throw new UpstreamTimeoutError(options.service, options.timeoutMs);
      if (!(retry && attempt === 0 && error instanceof TypeError)) throw error;
    }
  }
}

export async function upstreamHttpError(service: string, response: Response): Promise<UpstreamHttpError> {
  await discardErrorBody(response);
  return new UpstreamHttpError(service, response.status, response.headers.get("x-request-id") ?? undefined);
}

export function isUpstreamStatus(error: unknown, service: string, status: number): boolean {
  return error instanceof UpstreamHttpError && error.service === service && error.status === status;
}

async function discardErrorBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  let read = 0;
  let complete = false;
  try {
    while (read < maxErrorBodyBytes) {
      const result = await reader.read();
      if (result.done) {
        complete = true;
        break;
      }
      read += Math.min(result.value.byteLength, maxErrorBodyBytes - read);
    }
  } catch {
    // The status is sufficient for a sanitized upstream failure.
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
