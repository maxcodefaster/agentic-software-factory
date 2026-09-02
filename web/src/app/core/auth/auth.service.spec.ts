/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';

const capabilities = {
  boardRead: true,
  requirementsCreate: false,
  requirementsEdit: false,
  requirementsClose: false,
  requirementsMove: false,
  requirementsInterview: false,
  requirementsPropose: false,
  requirementsAccept: false,
  applicationsRead: true,
  developerWorkspaceCreate: false,
  implementationRead: true,
  implementationStart: false,
  implementationPrepare: false,
  implementationReview: false,
  implementationComplete: false,
  monitoringRead: true,
  applicationsManage: false,
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

const { teams: _teams, ...sessionWithoutTeams } = session;

describe('AuthService session contract', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HttpClientTestingModule] }));

  it('stores a valid session response', async () => {
    const service = TestBed.inject(AuthService);
    const hydration = service.hydrate();

    TestBed.inject(HttpTestingController).expectOne('/api/v1/session').flush(session);
    await hydration;

    expect(service.user()).toEqual(session);
    expect(service.state()).toBe('authenticated');
  });

  it('treats a null session as anonymous', async () => {
    const service = TestBed.inject(AuthService);
    const hydration = service.hydrate();

    expect(service.state()).toBe('loading');
    TestBed.inject(HttpTestingController).expectOne('/api/v1/session').flush(null);
    await hydration;

    expect(service.state()).toBe('anonymous');
    expect(service.isAuthenticated()).toBe(false);
  });

  it('treats a 401 session response as anonymous', async () => {
    const service = TestBed.inject(AuthService);
    const hydration = service.hydrate();

    TestBed.inject(HttpTestingController).expectOne('/api/v1/session').flush(null, { status: 401, statusText: 'Unauthorized' });
    await hydration;

    expect(service.state()).toBe('anonymous');
  });

  it('treats a 500 session response as unavailable', async () => {
    const service = TestBed.inject(AuthService);
    const hydration = service.hydrate();

    TestBed.inject(HttpTestingController).expectOne('/api/v1/session').flush(null, { status: 500, statusText: 'Server Error' });
    await hydration;

    expect(service.state()).toBe('unavailable');
  });

  it('treats a network failure as unavailable', async () => {
    const service = TestBed.inject(AuthService);
    const hydration = service.hydrate();

    TestBed.inject(HttpTestingController).expectOne('/api/v1/session').error(new ProgressEvent('error'));
    await hydration;

    expect(service.state()).toBe('unavailable');
  });

  it.each([
    ['a missing field', sessionWithoutTeams],
    ['an unknown persona', { ...session, personas: ['operator'] }],
    ['a malformed capability', { ...session, capabilities: { ...capabilities, boardRead: 'yes' } }],
  ])('rejects %s', async (_label, response) => {
    const service = TestBed.inject(AuthService);
    const hydration = service.hydrate();

    TestBed.inject(HttpTestingController).expectOne('/api/v1/session').flush(response);
    await hydration;

    expect(service.user()).toBeNull();
    expect(service.state()).toBe('unavailable');
    expect(service.isAuthenticated()).toBe(false);
    expect(service.loading()).toBe(false);
  });
});
