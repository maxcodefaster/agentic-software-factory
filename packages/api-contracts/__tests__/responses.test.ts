/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { applicationsResponseSchema } from '../src/applications';
import { errorResponseSchema } from '../src/errors';
import { implementationRunSchema } from '../src/implementation';
import { boardResponseSchema } from '../src/kanban';

describe('shared response contracts', () => {
  test('accepts an explicit truncated board page', () => {
    expect(boardResponseSchema.parse({
      repository: 'factory/requirements', total: 205, truncated: true, nextCursor: '5',
      columns: { ideation: [], requirements: [], implementation: [], done: [] },
    })).toMatchObject({ total: 205, truncated: true, nextCursor: '5' });
  });

  test.each([
    ['error response without a message', errorResponseSchema, { code: 'bad_request' }],
    ['error response with unknown details', errorResponseSchema, { error: 'invalid', secret: 'nope' }],
    ['board response with an invalid column', boardResponseSchema, { repository: 'factory/requirements', total: 0, truncated: false, nextCursor: null, columns: { ideation: [], requirements: [], implementation: [], done: 'closed' } }],
    ['board response with a hidden next page', boardResponseSchema, { repository: 'factory/requirements', total: 201, truncated: true, nextCursor: null, columns: { ideation: [], requirements: [], implementation: [], done: [] } }],
    ['implementation run without its projection', implementationRunSchema, { id: 'run-1' }],
    ['applications response with a malformed application', applicationsResponseSchema, { applications: [{ id: 'app-1' }] }],
  ])('rejects %s', (_label, schema, response) => {
    expect(schema.safeParse(response).success).toBe(false);
  });
});
