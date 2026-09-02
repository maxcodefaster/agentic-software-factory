/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { MonitoringClient } from './monitoring.client';

describe('MonitoringClient', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HttpClientTestingModule] }));

  it('requests workspace monitoring', () => {
    let response: unknown;
    TestBed.inject(MonitoringClient).getWorkspaceMonitoring().subscribe((value) => { response = value; });

    const request = TestBed.inject(HttpTestingController).expectOne('/api/v1/governance');
    expect(request.request.method).toBe('GET');
    const monitoring = { generatedAt: '', workspaces: { available: true, count: 0, workspaces: [] }, capabilities: {} };
    request.flush(monitoring);
    expect(response).toEqual(monitoring);
  });

  it('rejects a malformed workspace monitoring response', () => {
    let error: unknown;
    TestBed.inject(MonitoringClient).getWorkspaceMonitoring().subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/governance').flush({ generatedAt: '', workspaces: [] });
    expect(error).toBeTruthy();
  });
});
