/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import { AuthService } from '../../core/auth/auth.service';
import { SystemContextService } from '../../core/system/system-context.service';
import { TeamContextService } from '../../core/team/team-context.service';
import { SystemSwitcher } from './system-switcher';

const system = {
  id: 'factory/orders', team: 'factory', name: 'Orders', description: 'Order service', status: 'ready', healthy: true,
  workspaceId: null, workspaceUrl: null, chatUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [], declaredApps: [],
  repositoryUrl: null, releasesUrl: null, newAgentUrl: null,
} satisfies ApplicationSummary;

const billing = { ...system, id: 'factory/billing', name: 'Billing' } satisfies ApplicationSummary;

function keydown(key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  return event;
}

describe('SystemSwitcher', () => {
  it('renders an accessible listbox and limits creation to application managers', async () => {
    const applications = signal([system, billing]);
    const activeSystem = signal(system);
    await TestBed.configureTestingModule({
      imports: [SystemSwitcher, TranslocoTestingModule.forRoot({
        langs: { de: { factory: { systems: 'Systeme' }, applications: { selectSystem: 'System auswählen', closeMenu: 'Menü schließen', empty: 'Leer', onboarding: { create: 'Neues System erstellen' } } } },
        translocoConfig: { availableLangs: ['de'], defaultLang: 'de' },
      })],
      providers: [
        { provide: AuthService, useValue: { canManageApplications: signal(false) } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications, activeSystem, select: vi.fn(), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SystemSwitcher);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();
    expect(root.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true');
    expect(root.textContent).not.toContain('Neues System erstellen');
  });

  it('focuses the selected option and supports full listbox keyboard navigation', async () => {
    const select = vi.fn();
    await TestBed.configureTestingModule({
      imports: [SystemSwitcher, TranslocoTestingModule.forRoot({
        langs: { en: { factory: { systems: 'Systems' }, applications: { selectSystem: 'Select System', closeMenu: 'Close menu', empty: 'Empty', onboarding: { create: 'Create System' } } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
      providers: [
        { provide: AuthService, useValue: { canManageApplications: signal(false) } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([system, billing]), activeSystem: signal(billing), select, refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SystemSwitcher);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;

    trigger.dispatchEvent(keydown('ArrowDown', 40));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.textContent).toContain('Billing');

    document.activeElement?.dispatchEvent(keydown('Home', 36));
    expect(document.activeElement?.textContent).toContain('Orders');
    document.activeElement?.dispatchEvent(keydown('End', 35));
    expect(document.activeElement?.textContent).toContain('Billing');
    document.activeElement?.dispatchEvent(keydown('ArrowUp', 38));
    expect(document.activeElement?.textContent).toContain('Orders');
    document.activeElement?.dispatchEvent(keydown(' ', 32));
    expect(select).toHaveBeenCalledWith(system.id);

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    document.activeElement?.dispatchEvent(keydown('Escape', 27));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the outside-click layer out of the tab order', async () => {
    await TestBed.configureTestingModule({
      imports: [SystemSwitcher, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        { provide: AuthService, useValue: { canManageApplications: signal(false) } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([system, billing]), activeSystem: signal(system), select: vi.fn(), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SystemSwitcher);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-outside-click]')?.tagName).toBe('DIV');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-outside-click]')?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows one System as static text for members but keeps manager creation reachable', async () => {
    const canManageApplications = signal(false);
    await TestBed.configureTestingModule({
      imports: [SystemSwitcher, TranslocoTestingModule.forRoot({
        langs: { en: { factory: { systems: 'Systems' }, applications: { selectSystem: 'Select System', onboarding: { create: 'Create System' } } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
      providers: [
        { provide: AuthService, useValue: { canManageApplications } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), select: vi.fn(), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SystemSwitcher);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[aria-haspopup="listbox"]')).toBeNull();
    expect(root.textContent).toContain('Orders');

    canManageApplications.set(true);
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
    fixture.detectChanges();
    expect(root.textContent).toContain('Create System');
  });
});
