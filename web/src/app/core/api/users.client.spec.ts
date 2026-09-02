/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UsersClient } from './users.client';

describe('UsersClient', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HttpClientTestingModule] }));

  it('loads the tenant user directory', () => {
    const client = TestBed.inject(UsersClient);
    client.list({ team: 'operations', application: null }).subscribe((response) => expect(response.users[0]?.username).toBe('alice'));
    TestBed.inject(HttpTestingController).expectOne('/api/v1/users?team=operations').flush({ users: [{ id: '1', username: 'alice', displayName: 'Alice', initials: 'A' }] });
  });

  it('rejects a malformed user directory response', () => {
    let error: unknown;
    TestBed.inject(UsersClient).list({ team: 'operations', application: null }).subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/users?team=operations').flush({ users: [{ id: 1, username: 'alice' }] });
    expect(error).toBeTruthy();
  });
});
