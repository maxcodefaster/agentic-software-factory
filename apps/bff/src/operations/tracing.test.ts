/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, mock, test } from 'bun:test';
import { OtlpTraceExporter } from './tracing';

test('exports bounded low-cardinality OTLP HTTP spans without failing the request path', async () => {
  let payload: unknown;
  const fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body));
    return new Response(null, { status: 202 });
  });
  const exporter = new OtlpTraceExporter('https://otel.example/', 'factory', fetch);
  exporter.export({
    traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'GET /readyz',
    startedAtUnixNano: '1', endedAtUnixNano: '2',
    attributes: { 'http.request.method': 'GET', 'url.path': '/readyz', 'http.response.status_code': 200 }, error: false,
  });
  await Bun.sleep(0);

  expect(fetch).toHaveBeenCalledWith('https://otel.example/v1/traces', expect.objectContaining({ method: 'POST' }));
  expect(JSON.stringify(payload)).toContain('agentic-software-factory-bff');
  expect(JSON.stringify(payload)).not.toContain('repository');

  const unavailable = new OtlpTraceExporter('https://otel.example', 'factory', mock(async () => { throw new Error('down'); }));
  expect(() => unavailable.export({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'GET /healthz', startedAtUnixNano: '1', endedAtUnixNano: '2', attributes: {}, error: false })).not.toThrow();
});
