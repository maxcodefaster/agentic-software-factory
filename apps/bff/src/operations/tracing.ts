/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

export interface HttpSpan {
  traceId: string;
  spanId: string;
  name: string;
  startedAtUnixNano: string;
  endedAtUnixNano: string;
  attributes: Record<string, string | number>;
  error: boolean;
}

type TraceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class OtlpTraceExporter {
  private readonly endpoint: string;

  constructor(endpoint: string, private readonly serviceName: string, private readonly fetch: TraceFetch = globalThis.fetch.bind(globalThis)) {
    this.endpoint = `${endpoint.replace(/\/+$/, '')}/v1/traces`;
  }

  export(span: HttpSpan): void {
    const payload = {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }] },
        scopeSpans: [{
          scope: { name: 'agentic-software-factory-bff' },
          spans: [{
            traceId: span.traceId,
            spanId: span.spanId,
            name: span.name,
            kind: 2,
            startTimeUnixNano: span.startedAtUnixNano,
            endTimeUnixNano: span.endedAtUnixNano,
            attributes: Object.entries(span.attributes).map(([key, value]) => ({
              key,
              value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
            })),
            status: { code: span.error ? 2 : 1 },
          }],
        }],
      }],
    };
    void this.fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_000),
    }).then((response) => response.body?.cancel()).catch(() => undefined);
  }
}
