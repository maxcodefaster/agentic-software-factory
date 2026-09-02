/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { MonitoringDrawer } from './monitoring-drawer';

const translations = {
  monitoring: {
    open: 'Workspace monitoring', section: 'Operations', title: 'Workspace monitoring', close: 'Close',
    refresh: 'Refresh', generated: 'Generated', loading: 'Loading', loadFailed: 'Failed',
    workspaceSection: 'Workspaces', workspaceCount: '{{count}} workspaces', workspacesUnavailable: 'Workspace visibility unavailable', noWorkspaces: 'No workspaces',
    healthy: 'Healthy', unhealthy: 'Attention', outdated: 'Update available', lastUsed: 'Last used',
    kind: { developer: 'Developer', verification: 'Verification' },
  },
  common: { loading: 'Loading' },
};

describe('MonitoringDrawer', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitoringDrawer, HttpClientTestingModule, TranslocoTestingModule.forRoot({ langs: { en: translations }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
    }).compileComponents();
  });

  it('shows workspace state', () => {
    const fixture = TestBed.createComponent(MonitoringDrawer);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/governance').flush({
      generatedAt: '2026-08-24T10:00:00Z',
      workspaces: { available: true, count: 1, workspaces: [{ id: 'w1', name: 'verification-app', owner: 'alice', template: 'Factory', status: 'running', transition: 'start', healthy: true, outdated: true, lastUsedAt: '2026-08-24T09:00:00Z', kind: 'verification' }] },
      capabilities: {},
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('verification-app');
    expect(fixture.nativeElement.textContent).toContain('Verification');
  });

  it('refreshes workspace monitoring', () => {
    const fixture = TestBed.createComponent(MonitoringDrawer);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/governance').flush({ generatedAt: '', workspaces: { available: true, count: 0, workspaces: [] }, capabilities: {} });
    fixture.detectChanges();

    const refreshButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((button) => button.textContent?.includes('Refresh'))!;
    refreshButton.click();
    http.expectOne('/api/v1/governance').flush({ generatedAt: '', workspaces: { available: true, count: 0, workspaces: [] }, capabilities: {} });
  });
});
