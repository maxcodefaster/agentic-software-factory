/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { applicationsResponseSchema, onboardingAttemptSchema } from '../src/applications';
import { errorResponseSchema } from '../src/errors';
import { implementationRunSchema } from '../src/implementation';
import { boardResponseSchema } from '../src/kanban';
import { workspaceKindSchema } from '../src/monitoring';
import { assignmentUsersResponseSchema, userDeprovisionResponseSchema } from '../src/users';

describe('shared response contracts', () => {
  test('accepts an explicit truncated board page', () => {
    expect(boardResponseSchema.parse({
      repository: 'factory/requirements', total: 205, truncated: true, nextCursor: '5',
      columns: { ideation: [], requirements: [], implementation: [], done: [] },
    })).toMatchObject({ total: 205, truncated: true, nextCursor: '5' });
  });

  test.each(['reassigning', 'reassigning-access'])('accepts the %s onboarding phase', (phase) => {
    expect(onboardingAttemptSchema.parse({
      systemId: 'factory/app', team: 'factory', repositoryOwner: 'factory', repositoryName: 'app', phase,
      targetSha: null, contractVersion: null, compatibilityIssues: [], policyPlan: null, lastError: null,
      attempts: 1, nextAttemptAt: null, updatedAt: '2026-09-02T10:00:00Z',
    }).phase).toBe(phase);
  });

  test('rejects staging workspace monitoring', () => {
    expect(workspaceKindSchema.safeParse('staging').success).toBe(false);
  });

  test.each([
    { status: 'suspended', revokedTokenCount: 2 },
    { status: 'not-linked' },
    { status: 'pending' },
  ])('accepts the $status user deprovision result', (coder) => {
    expect(userDeprovisionResponseSchema.parse({
      id: 'user-1', status: 'deprovisioned', persisted: true,
      coder, forgejo: { status: 'requested', immediate: true },
    }).coder).toEqual(coder);
  });

  test.each([
    ['error response without a message', errorResponseSchema, { code: 'bad_request' }],
    ['error response without a code', errorResponseSchema, { error: 'invalid' }],
    ['error response with unknown details', errorResponseSchema, { error: 'invalid', secret: 'nope' }],
    ['board response with an invalid column', boardResponseSchema, { repository: 'factory/requirements', total: 0, truncated: false, nextCursor: null, columns: { ideation: [], requirements: [], implementation: [], done: 'closed' } }],
    ['board response with a hidden next page', boardResponseSchema, { repository: 'factory/requirements', total: 201, truncated: true, nextCursor: null, columns: { ideation: [], requirements: [], implementation: [], done: [] } }],
    ['implementation run without its projection', implementationRunSchema, { id: 'run-1' }],
    ['applications response with a malformed application', applicationsResponseSchema, { applications: [{ id: 'app-1' }] }],
    ['assignment users with an email', assignmentUsersResponseSchema, { users: [{ id: 'user-1', username: 'alice', displayName: 'Alice', initials: 'A', email: 'alice@example.test' }] }],
    ['deprovision response with an invalid Coder result', userDeprovisionResponseSchema, { id: 'user-1', status: 'deprovisioned', persisted: true, coder: { status: 'deleted' }, forgejo: { status: 'requested', immediate: true } }],
    ['pending deprovision response with a token count', userDeprovisionResponseSchema, { id: 'user-1', status: 'deprovisioned', persisted: true, coder: { status: 'pending', revokedTokenCount: 2 }, forgejo: { status: 'requested', immediate: true } }],
  ])('rejects %s', (_label, schema, response) => {
    expect(schema.safeParse(response).success).toBe(false);
  });
});
