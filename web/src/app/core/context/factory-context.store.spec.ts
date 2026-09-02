/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import { ApplicationsClient } from '../api/applications.client';
import { AuthService } from '../auth/auth.service';
import { FactoryContextStore } from './factory-context.store';

@Component({ template: '' })
class EmptyRoute {}

const application = {
  id: 'operations/orders', team: 'operations', name: 'Orders', description: '', status: 'ready', healthy: true,
  workspaceId: null, workspaceUrl: null, chatUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null,
  apps: [], declaredApps: [], repositoryUrl: null, releasesUrl: null, newAgentUrl: null,
} satisfies ApplicationSummary;

describe('FactoryContextStore', () => {
  beforeEach(() => localStorage.clear());

  it('uses storage only when the URL has no team and writes the resolved default into the URL', async () => {
    localStorage.setItem('factory.activeTeam', 'operations');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams: signal(['factory', 'operations']) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [application] }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/board/42');
    const store = TestBed.inject(FactoryContextStore);
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.requestContext()).toEqual({ team: 'operations', application: 'operations/orders' });
    expect(router.url).toBe('/board/42?team=operations&application=operations%2Forders');
  });

  it('keeps an explicit URL team authoritative over storage', async () => {
    localStorage.setItem('factory.activeTeam', 'operations');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams: signal(['factory', 'operations']) } },
        { provide: ApplicationsClient, useValue: { list: (context: { team: string }) => of({ applications: [{ ...application, id: `${context.team}/orders`, team: context.team }] }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?team=factory');
    const store = TestBed.inject(FactoryContextStore);
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.activeTeam()).toBe('factory');
    expect(router.url).toBe('/?team=factory&application=factory%2Forders');
  });

  it('preserves an explicit application through a failed initial list and selects it after retry', async () => {
    const list = vi.fn()
      .mockReturnValueOnce(throwError(() => new Error('temporarily unavailable')))
      .mockReturnValueOnce(of({ applications: [
        { ...application, id: 'operations/billing', name: 'Billing' },
        application,
      ] }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { state: signal('authenticated'), teams: signal(['operations']) } },
        { provide: ApplicationsClient, useValue: { list } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/board/42?team=operations&application=operations%2Forders&view=activity');
    const store = TestBed.inject(FactoryContextStore);
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(router.url).toBe('/board/42?team=operations&application=operations%2Forders&view=activity');

    store.refreshApplications();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.activeApplication()?.id).toBe('operations/orders');
    expect(router.url).toBe('/board/42?team=operations&application=operations%2Forders&view=activity');
  });

  it('drops applications returned outside the selected team', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams: signal(['factory', 'platform']) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [application] }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?team=platform&application=operations%2Forders');
    const store = TestBed.inject(FactoryContextStore);
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.requestContext()).toEqual({ team: 'platform', application: null });
    expect(router.url).toBe('/?team=platform');
  });

  it('never exposes the previous team application while team navigation loads', async () => {
    const teams = signal(['operations', 'platform']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [application] }) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?team=operations&application=operations%2Forders');
    const store = TestBed.inject(FactoryContextStore);
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(store.activeApplication()?.id).toBe('operations/orders');

    store.selectTeam('platform');
    expect(store.activeApplication()).toBeNull();
  });

  it('does not overwrite initial navigation with the stored team', async () => {
    localStorage.setItem('factory.activeTeam', 'factory');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: EmptyRoute }]),
        { provide: AuthService, useValue: { teams: signal(['factory', 'platform']) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [] }) } },
      ],
    });
    const router = TestBed.inject(Router);
    const store = TestBed.inject(FactoryContextStore);
    TestBed.flushEffects();

    await router.navigateByUrl('/?team=platform');
    TestBed.flushEffects();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.activeTeam()).toBe('platform');
    expect(router.url).toBe('/?team=platform');
  });
});
