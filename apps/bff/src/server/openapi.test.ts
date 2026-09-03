/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';
import { buildFactoryOpenApiDocument, serializeFactoryOpenApiDocument } from './openapi';

describe('Factory OpenAPI document', () => {
  test('contains only Factory /api/v1 routes', () => {
    const document = buildFactoryOpenApiDocument();
    const paths = Object.keys(document.paths);
    const operations = Object.values(document.paths)
      .flatMap((path) => Object.values(path as Record<string, { operationId?: string }>));
    const operationIds = operations.map((operation) => operation.operationId);

    expect(paths).toContain('/api/v1/board');
    expect(paths).toContain('/api/v1/applications');
    expect(paths).toContain('/api/v1/requirements/{number}/implementation-runs');
    expect(paths).toContain('/api/v1/users/{id}/deprovision');
    expect(paths).toHaveLength(34);
    expect(operations).toHaveLength(39);
    expect(paths.every((path) => path.startsWith('/api/v1/'))).toBe(true);
    for (const excluded of ['/healthz', '/readyz', '/statusz', '/metrics', '/mcp', '/auth/config', '/openapi']) {
      expect(paths).not.toContain(excluded);
    }
    expect(operationIds.every((operationId) => typeof operationId === 'string')).toBe(true);
    expect(operationIds.every((operationId) => operationId && /^[A-Za-z][A-Za-z0-9]*$/.test(operationId))).toBe(true);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect((document.paths['/api/v1/board'] as Record<string, { operationId?: string }>).get?.operationId)
      .toBe('getApiV1Board');
    expect(document.components?.securitySchemes?.cookieAuth).toEqual({
      type: 'apiKey', in: 'cookie', name: 'factory.session_token',
    });
    expect(document.security).toEqual([{ cookieAuth: [] }]);
  });

  test('uses compact reusable JSON schemas', () => {
    const document = buildFactoryOpenApiDocument();
    const operations = Object.values(document.paths)
      .flatMap((path) => Object.values(path as Record<string, OpenApiOperation>));
    const requestContent = operations
      .flatMap((operation) => operation.requestBody ? [operation.requestBody.content] : []);
    const responses = operations.flatMap((operation) => Object.entries(operation.responses ?? {}));
    const responseSchemas = responses.flatMap(([, response]) =>
      response.content?.['application/json']?.schema ? [response.content['application/json'].schema] : []);

    expect(requestContent).toHaveLength(24);
    expect(requestContent.every((content) => Object.keys(content).join() === 'application/json')).toBe(true);
    expect(requestContent.every((content) => isComponentReference(content['application/json']?.schema))).toBe(true);
    expect(responseSchemas.every(isComponentReference)).toBe(true);
    expect(Object.keys(document.components?.schemas ?? {}).length).toBeLessThan(60);
    expect(serializeFactoryOpenApiDocument().length).toBeLessThan(250_000);

    const errorReferences = new Set(responses
      .filter(([status]) => Number(status) >= 400)
      .map(([, response]) => response.content?.['application/json']?.schema?.$ref));
    expect(errorReferences).toEqual(new Set(['#/components/schemas/ErrorResponse']));
  });

  test('documents no-content responses without a JSON schema', () => {
    const document = buildFactoryOpenApiDocument();
    for (const operationId of [
      'deleteApiV1RequirementsByNumber',
      'deleteApiV1ApplicationsByIdRegistration',
      'postApiV1ApplicationsByIdStagingRetry',
      'postApiV1ImplementationRunsByIdVerificationRetry',
      'postApiV1ImplementationRunsByIdCompleteRetry',
    ]) {
      const operation = Object.values(document.paths)
        .flatMap((path) => Object.values(path as Record<string, OpenApiOperation>))
        .find((candidate) => candidate.operationId === operationId);
      expect(operation).toBeDefined();
      const noContentResponse = operationId.startsWith('delete') ? operation?.responses?.['204'] : operation?.responses?.['202'];
      expect(noContentResponse?.content).toBeUndefined();
    }

    const deprovision = Object.values(document.paths)
      .flatMap((path) => Object.values(path as Record<string, OpenApiOperation>))
      .find((candidate) => candidate.operationId === 'postApiV1UsersByIdDeprovision');
    expect(deprovision?.requestBody?.required).toBe(false);
  });

  test('is byte-for-byte deterministic', () => {
    expect(serializeFactoryOpenApiDocument()).toBe(serializeFactoryOpenApiDocument());
  });
});

type OpenApiOperation = {
  operationId?: string;
  requestBody?: { content: Record<string, { schema?: Record<string, unknown> }>; required?: boolean };
  responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }>;
};

function isComponentReference(schema: Record<string, unknown> | undefined): boolean {
  return typeof schema?.$ref === 'string' && schema.$ref.startsWith('#/components/schemas/');
}
