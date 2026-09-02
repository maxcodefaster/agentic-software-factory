/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import { ApplicationsClient } from '../api/applications.client';
import { AuthService } from '../auth/auth.service';
import { SystemContextService } from './system-context.service';

const systems = [
  { id: 'factory/orders', name: 'Orders' },
  { id: 'factory/billing', name: 'Billing' },
].map((system): ApplicationSummary => ({
  ...system, team: 'factory', description: '', status: 'ready', healthy: true, workspaceId: null, workspaceUrl: null,
  chatUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [], declaredApps: [], repositoryUrl: null, releasesUrl: null, newAgentUrl: null,
}));

@Component({ template: '' })
class EmptyRoute {}

describe('SystemContextService', () => {
  it('validates the query against team Systems and defaults to the first result', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams: signal(['factory']) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: systems }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?team=factory&application=other%2Fprivate');
    const context = TestBed.inject(SystemContextService);
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(context.activeSystem()?.id).toBe('factory/orders');
    expect(router.url).toBe('/?team=factory&application=factory%2Forders');
  });

  it('selects a System without dropping a routed requirement', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams: signal(['factory']) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: systems }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/board/42?team=factory&application=factory%2Forders');
    const context = TestBed.inject(SystemContextService);
    TestBed.flushEffects();
    context.select('factory/billing');
    await TestBed.inject(ApplicationRef).whenStable();

    expect(router.url).toBe('/board/42?team=factory&application=factory%2Fbilling');
  });
});
