/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule } from '@angular/common/http/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component, signal } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { LocaleService } from './core/i18n/locale';
import { SystemContextService } from './core/system/system-context.service';
import { TeamContextService } from './core/team/team-context.service';
import { ThemeService } from './core/theme/theme.service';

@Component({ template: '' })
class EmptyRoute {}

function keydown(key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  return event;
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        App,
        HttpClientTestingModule,
        TranslocoTestingModule.forRoot({
          langs: { en: {}, de: {} },
          translocoConfig: { availableLangs: ['en', 'de'], defaultLang: 'de' },
        }),
      ],
      providers: [provideRouter([{ path: '**', component: EmptyRoute }])],
    }).compileComponents();
  });

  it('should create the shell', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders a compact shell without sidebar navigation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('aside')).toBeNull();
    expect(compiled.querySelector('aside')).toBeNull();
  });

  it('uses client-side brand navigation and preserves team and System context', async () => {
    const application = { id: 'factory/orders', team: 'factory', name: 'Orders', description: '', status: 'ready', healthy: true, workspaceId: null, workspaceUrl: null, chatUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [], declaredApps: [], repositoryUrl: null, releasesUrl: null, newAgentUrl: null };
    TestBed.overrideProvider(AuthService, { useValue: { state: signal('authenticated'), loading: signal(false), isAuthenticated: signal(true), user: signal(null), isAdmin: signal(false), canManageApplications: signal(false) } });
    TestBed.overrideProvider(ThemeService, { useValue: { isDark: signal(false), toggle: vi.fn() } });
    TestBed.overrideProvider(LocaleService, { useValue: { active: signal('en'), toggle: vi.fn() } });
    TestBed.overrideProvider(TeamContextService, { useValue: { activeTeam: signal('factory'), teams: signal(['factory']) } });
    TestBed.overrideProvider(SystemContextService, { useValue: { applications: signal([application]), activeSystem: signal(application), select: vi.fn(), refresh: vi.fn() } });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/board/42?team=factory&application=factory%2Forders');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const brand = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('[data-brand-link]')!;

    expect(brand.textContent).toContain('Agentic Software Factory');
    expect(brand.textContent).toContain('ASF');
    expect(brand.getAttribute('href')).toContain('team=factory');
    expect(brand.getAttribute('href')).toContain('application=factory%2Forders');
    brand.click();
    await fixture.whenStable();
    expect(router.url).toBe('/?team=factory&application=factory%2Forders');
  });

  it('opens account actions in an anchored menu and closes it with Escape', async () => {
    const user = { id: '1', email: 'alex@example.com', displayName: 'Alex Smith', initials: 'AS', teams: ['factory'], ownerTeams: [], admin: false, personas: [], capabilities: {} };
    TestBed.overrideProvider(AuthService, { useValue: { state: signal('authenticated'), loading: signal(false), isAuthenticated: signal(true), user: signal(user), canManageApplications: signal(false), signOut: vi.fn() } });
    TestBed.overrideProvider(ThemeService, { useValue: { isDark: signal(false), toggle: vi.fn() } });
    TestBed.overrideProvider(LocaleService, { useValue: { active: signal('en'), toggle: vi.fn() } });
    TestBed.overrideProvider(TeamContextService, { useValue: { activeTeam: signal('factory'), teams: signal(['factory']) } });
    TestBed.overrideProvider(SystemContextService, { useValue: { applications: signal([]), activeSystem: signal(null), select: vi.fn(), refresh: vi.fn() } });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const trigger = compiled.querySelector<HTMLButtonElement>('[data-testid="account-menu"]')!;

    expect(trigger.textContent?.trim()).toBe('AS');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(overlay.querySelector('[data-testid="account-dropdown"]')).toBeNull();
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(overlay.querySelector('[data-testid="account-dropdown"]')?.getAttribute('role')).toBe('menu');
    expect(overlay.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    expect(document.activeElement).toBe(overlay.querySelector('[role="menuitem"]'));

    document.activeElement?.dispatchEvent(keydown('Escape', 27));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(overlay.querySelector('[data-testid="account-dropdown"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('retries session hydration from the unavailable shell', async () => {
    const state = signal<'unavailable' | 'authenticated'>('unavailable');
    const hydrate = vi.fn(async () => state.set('authenticated'));
    const requestedUrl = signal('/board/42?team=operations&application=operations%2Forders&view=activity');
    TestBed.overrideProvider(AuthService, { useValue: { state, requestedUrl, loading: signal(false), isAuthenticated: signal(false), user: signal(null), canManageApplications: signal(false), hydrate, signIn: vi.fn() } });
    TestBed.overrideProvider(TeamContextService, { useValue: { activeTeam: signal(null), teams: signal([]) } });
    TestBed.overrideProvider(SystemContextService, { useValue: { applications: signal([]), activeSystem: signal(null), select: vi.fn(), refresh: vi.fn() } });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const retry = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="auth-unavailable"] button')!;
    retry.click();
    await fixture.whenStable();

    expect(hydrate).toHaveBeenCalledOnce();
    expect(state()).toBe('authenticated');
    expect(TestBed.inject(Router).url).toBe('/board/42?team=operations&application=operations%2Forders&view=activity');
  });

  it('navigates to the client login route when an unavailable retry resolves anonymous', async () => {
    const state = signal<'unavailable' | 'anonymous'>('unavailable');
    const hydrate = vi.fn(async () => state.set('anonymous'));
    const requestedUrl = signal('/board/42?view=activity');
    const signIn = vi.fn();
    TestBed.overrideProvider(AuthService, { useValue: { state, requestedUrl, loading: signal(false), isAuthenticated: signal(false), user: signal(null), canManageApplications: signal(false), hydrate, signIn } });
    TestBed.overrideProvider(TeamContextService, { useValue: { activeTeam: signal(null), teams: signal([]) } });
    TestBed.overrideProvider(SystemContextService, { useValue: { applications: signal([]), activeSystem: signal(null), select: vi.fn(), refresh: vi.fn() } });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="auth-unavailable"] button')!.click();
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/login?return_to=%2Fboard%2F42%3Fview%3Dactivity');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('renders a public auth route without app header while session state is unavailable', async () => {
    TestBed.overrideProvider(AuthService, { useValue: { state: signal('unavailable'), requestedUrl: signal(null), loading: signal(false), isAuthenticated: signal(false), user: signal(null), canManageApplications: signal(false) } });
    TestBed.overrideProvider(TeamContextService, { useValue: { activeTeam: signal(null), teams: signal([]) } });
    TestBed.overrideProvider(SystemContextService, { useValue: { applications: signal([]), activeSystem: signal(null), select: vi.fn(), refresh: vi.fn() } });
    await TestBed.inject(Router).navigateByUrl('/login');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')).toBeNull();
    expect(compiled.querySelector('[data-testid="auth-unavailable"]')).toBeNull();
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

});
