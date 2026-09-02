/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApplicationsClient } from './applications.client';

describe('ApplicationsClient', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
  }));

  it('imports an existing Forgejo repository', () => {
    const client = TestBed.inject(ApplicationsClient);
    const http = TestBed.inject(HttpTestingController);

    client.listOnboardingRepositories().subscribe();
    http.expectOne('/api/v1/applications/onboarding/repositories').flush({ repositories: [] });

    client.register({ repository: 'customer-portal', team: 'factory' }).subscribe();
    const register = http.expectOne('/api/v1/applications/onboarding/register');
    expect(register.request.method).toBe('POST');
    expect(register.request.body).toEqual({ repository: 'customer-portal', team: 'factory' });
    register.flush({ id: 'factory/customer-portal', name: 'Customer Portal', description: '', repositoryUrl: 'https://git/customer-portal' });

    http.verify();
  });

  it('rejects a malformed applications response', () => {
    const client = TestBed.inject(ApplicationsClient);
    let error: unknown;

    client.list({ team: 'factory', application: null }).subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/applications?team=factory').flush({ applications: [{ id: 'app-1' }] });

    expect(error).toBeTruthy();
  });

  it('rejects malformed development-tools and workspace responses', () => {
    const client = TestBed.inject(ApplicationsClient);
    const http = TestBed.inject(HttpTestingController);
    const errors: unknown[] = [];

    client.developmentTools().subscribe({ error: (error) => errors.push(error) });
    http.expectOne('/api/v1/development-tools').flush({ ready: 'yes' });

    client.createWorkspace({ team: 'operations', application: 'operations/orders' }, 'operations/orders').subscribe({ error: (error) => errors.push(error) });
    http.expectOne('/api/v1/applications/operations%2Forders/workspace?team=operations').flush({ workspaceId: 17, ideUrl: 'https://ide.example' });

    expect(errors).toHaveLength(2);
    http.verify();
  });

  it('creates an IDE workspace in the active team scope', () => {
    const client = TestBed.inject(ApplicationsClient);
    const http = TestBed.inject(HttpTestingController);

    let result: unknown;
    client.createWorkspace({ team: 'operations', application: 'operations/customer portal' }, 'operations/customer portal').subscribe((workspace) => { result = workspace; });

    const request = http.expectOne('/api/v1/applications/operations%2Fcustomer%20portal/workspace?team=operations');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    const workspace = { workspaceId: 'workspace-1', workspaceUrl: null, ideUrl: 'https://ide.example', terminalUrl: null, servicesUrl: null, apps: [] };
    request.flush(workspace);
    expect(result).toEqual(workspace);
    http.verify();
  });

  it('polls the applications projection while the IDE starts', async () => {
    const client = TestBed.inject(ApplicationsClient);
    const http = TestBed.inject(HttpTestingController);
    let result: unknown;

    client.createWorkspace({ team: 'operations', application: 'operations/customer-portal' }, 'operations/customer-portal').subscribe((workspace) => { result = workspace; });
    http.expectOne('/api/v1/applications/operations%2Fcustomer-portal/workspace?team=operations').flush({
      workspaceId: 'workspace-1', workspaceUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/applications/operations%2Fcustomer-portal/workspaces/workspace-1?team=operations').flush({
      workspaceId: 'workspace-1', workspaceUrl: 'https://coder.example/workspace', ideUrl: 'https://ide.example', terminalUrl: null, servicesUrl: null, apps: [],
    });

    expect(result).toMatchObject({ workspaceId: 'workspace-1', ideUrl: 'https://ide.example' });
    http.verify();
  });

  it('keeps polling in the team that started the workspace request', async () => {
    const client = TestBed.inject(ApplicationsClient);
    const http = TestBed.inject(HttpTestingController);

    const context: { team: string; application: string | null } = { team: 'operations', application: 'operations/customer-portal' };
    client.createWorkspace(context, 'operations/customer-portal').subscribe();
    http.expectOne('/api/v1/applications/operations%2Fcustomer-portal/workspace?team=operations').flush({
      workspaceId: 'workspace-1', workspaceUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [],
    });
    context.team = 'factory';
    context.application = 'factory/billing';
    await new Promise((resolve) => setTimeout(resolve, 0));

    http.expectNone('/api/v1/applications/factory%2Fbilling/workspaces/workspace-1?team=factory');
    http.expectOne('/api/v1/applications/operations%2Fcustomer-portal/workspaces/workspace-1?team=operations').flush({
      workspaceId: 'workspace-1', workspaceUrl: null, ideUrl: 'https://ide.example', terminalUrl: null, servicesUrl: null, apps: [],
    });
    http.verify();
  });

  it('does not treat the Coder workspace page as a ready IDE', async () => {
    const client = TestBed.inject(ApplicationsClient);
    const http = TestBed.inject(HttpTestingController);
    let result: unknown;

    client.createWorkspace({ team: 'operations', application: 'operations/customer-portal' }, 'operations/customer-portal').subscribe((workspace) => { result = workspace; });
    const workspace = {
      workspaceId: 'workspace-1', workspaceUrl: 'https://coder.example/workspace', ideUrl: null,
      terminalUrl: null, servicesUrl: null, apps: [{ slug: 'application', displayName: 'Application', url: 'https://app.example', health: 'initializing' }],
    };
    http.expectOne('/api/v1/applications/operations%2Fcustomer-portal/workspace?team=operations').flush(workspace);

    expect(result).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/applications/operations%2Fcustomer-portal/workspaces/workspace-1?team=operations').flush({
      workspaceId: 'workspace-1', workspaceUrl: workspace.workspaceUrl, ideUrl: 'https://ide.example', terminalUrl: null, servicesUrl: null, apps: [],
    });
    expect(result).toMatchObject({ workspaceId: 'workspace-1', ideUrl: 'https://ide.example' });
    http.verify();
  });
});
