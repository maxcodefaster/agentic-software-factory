/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { sessionResponseSchema } from '../src/session';

const capabilities = {
  boardRead: true,
  requirementsCreate: true,
  requirementsEdit: true,
  requirementsClose: true,
  requirementsMove: true,
  requirementsInterview: true,
  requirementsPropose: true,
  requirementsAccept: true,
  applicationsRead: true,
  developerWorkspaceCreate: true,
  implementationRead: true,
  implementationStart: true,
  implementationPrepare: true,
  implementationReview: true,
  implementationComplete: true,
  monitoringRead: true,
  applicationsManage: true,
};

const session = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  initials: 'A',
  teams: ['factory'],
  ownerTeams: [],
  admin: false,
  personas: ['business'],
  capabilities,
};

const { id: _id, ...sessionWithoutId } = session;
const { boardRead: _boardRead, ...capabilitiesWithoutBoardRead } = capabilities;

describe('session response contract', () => {
  test('accepts authenticated and empty sessions', () => {
    expect(sessionResponseSchema.safeParse(session).success).toBe(true);
    expect(sessionResponseSchema.safeParse(null).success).toBe(true);
  });

  test.each([
    ['a missing session field', sessionWithoutId],
    ['an unknown persona', { ...session, personas: ['operator'] }],
    ['a non-boolean capability', { ...session, capabilities: { ...capabilities, boardRead: 'yes' } }],
    ['a missing capability', { ...session, capabilities: capabilitiesWithoutBoardRead }],
    ['an unexpected session field', { ...session, accessToken: 'secret' }],
  ])('rejects %s', (_label, response) => {
    expect(sessionResponseSchema.safeParse(response).success).toBe(false);
  });
});
