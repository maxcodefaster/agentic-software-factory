/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, it } from "bun:test";
import { fetchUpstream, UpstreamTimeoutError, upstreamHttpError } from "./fetch";

describe("dependency fetch resilience", () => {
  it("preserves caller cancellation instead of reporting an internal timeout", async () => {
    const caller = new AbortController();
    const cancelled = new Error("caller cancelled");
    const request = fetchUpstream(async (_input, init) => {
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }, "https://dependency", { signal: caller.signal }, { service: "Test", timeoutMs: 50 });

    caller.abort(cancelled);
    await expect(request).rejects.toBe(cancelled);
  });

  it("raises a typed sanitized timeout error", async () => {
    const request = fetchUpstream(async (_input, init) => {
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }, "https://dependency", {}, { service: "Test", timeoutMs: 1 });

    const error = await request.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(UpstreamTimeoutError);
    expect(error).toMatchObject({ service: "Test", timeoutMs: 1, message: "Test request timed out" });
  });

  it("retries one transient read but never retries a mutation", async () => {
    let reads = 0;
    const read = await fetchUpstream(async () => {
      reads += 1;
      return new Response(null, { status: reads === 1 ? 503 : 200 });
    }, "https://dependency", { method: "GET" }, { service: "Test", timeoutMs: 100, retryTransient: true });
    let writes = 0;
    const write = await fetchUpstream(async () => {
      writes += 1;
      return new Response(null, { status: 503 });
    }, "https://dependency", { method: "POST" }, { service: "Test", timeoutMs: 100, retryTransient: true });

    expect(read.status).toBe(200);
    expect(reads).toBe(2);
    expect(write.status).toBe(503);
    expect(writes).toBe(1);
  });

  it("bounds and discards upstream error bodies without exposing their content", async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(2_048));
      },
      cancel() {
        cancelled = true;
      },
    });

    const error = await upstreamHttpError("Test", new Response(body, { status: 502, headers: { "x-request-id": "upstream-123" } }));
    expect(error.message).toBe("Test returned 502");
    expect(error.requestId).toBe("upstream-123");
    expect(reads).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("drops an unsafe upstream request ID", async () => {
    const error = await upstreamHttpError("Test", new Response(null, {
      status: 401,
      headers: { "x-request-id": "secret/value" },
    }));

    expect(error.requestId).toBeUndefined();
  });
});
