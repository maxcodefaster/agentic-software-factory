/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import type { ConnectedPosition } from '@angular/cdk/overlay';
import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { isPublicAuthPath } from './core/auth/public-auth-route';
import { LocaleService } from './core/i18n/locale';
import { ThemeService } from './core/theme/theme.service';
import { SystemContextService } from './core/system/system-context.service';
import { TeamContextService } from './core/team/team-context.service';
import { OnboardingModal } from './features/applications/onboarding-modal';
import { MonitoringDrawer } from './features/monitoring/monitoring-drawer';
import { Avatar } from './shared/avatar/avatar';
import { Icon } from './shared/icon/icon';
import { TeamSwitcher } from './shared/team-switcher/team-switcher';
import { SystemSwitcher } from './shared/system-switcher/system-switcher';

@Component({
  selector: 'factory-root',
  imports: [RouterLink, RouterOutlet, CdkMenu, CdkMenuItem, CdkMenuTrigger, HlmButton, Icon, Avatar, OnboardingModal, MonitoringDrawer, TeamSwitcher, SystemSwitcher, TranslocoPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly locale = inject(LocaleService);
  private readonly router = inject(Router);
  protected readonly team = inject(TeamContextService);
  private readonly systems = inject(SystemContextService);
  protected readonly monitoringOpen = signal(false);
  protected readonly onboardingOpen = signal(false);
  protected readonly publicAuthRoute = signal(isPublicAuthPath(window.location.pathname) || isPublicAuthPath(this.router.url));
  protected readonly accountMenuPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];
  protected readonly brandQueryParams = computed(() => ({
    team: this.team.activeTeam(),
    application: this.systems.activeSystem()?.id ?? null,
  }));

  constructor() {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      this.publicAuthRoute.set(isPublicAuthPath(event.urlAfterRedirects));
    });
  }

  protected openMonitoring(): void {
    this.monitoringOpen.set(true);
  }

  protected onboardingChanged(): void {
    this.onboardingOpen.set(false);
    this.systems.refresh();
  }

  protected async retryAuth(): Promise<void> {
    const returnTo = this.auth.requestedUrl() ?? `${window.location.pathname}${window.location.search}`;
    await this.auth.hydrate();
    if (this.auth.state() === 'authenticated') await this.router.navigateByUrl(returnTo);
    if (this.auth.state() === 'anonymous') {
      await this.router.navigate(['/login'], { queryParams: { return_to: returnTo } });
    }
  }

}
