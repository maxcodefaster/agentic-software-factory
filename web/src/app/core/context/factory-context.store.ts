/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { computed, effect, Injectable, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import { ApplicationsClient } from '../api/applications.client';
import { AuthService } from '../auth/auth.service';

const STORAGE_KEY = 'factory.activeTeam';

export interface FactoryRequestContext {
  readonly team: string;
  readonly application: string | null;
}

@Injectable({ providedIn: 'root' })
export class FactoryContextStore {
  private readonly api = inject(ApplicationsClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly requestedTeam = signal<string | null>(this.teamFromUrl() ?? this.readStoredTeam());
  private readonly requestedApplication = signal<string | null>(this.applicationFromUrl(this.router.url));
  private readonly routeReady = signal(this.router.navigated || browserIsAtPlainRoot());
  private request = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly teams = this.auth.teams;
  readonly applications = signal<ApplicationSummary[]>([]);
  readonly loading = signal(true);
  private readonly applicationsResolved = signal(false);
  readonly activeTeam = computed(() => {
    const requested = this.requestedTeam();
    const teams = this.teams();
    return requested && teams.includes(requested) ? requested : teams[0] ?? null;
  });
  readonly hasMultipleTeams = computed(() => this.teams().length > 1);
  readonly activeApplication = computed(() => {
    const team = this.activeTeam();
    const requested = this.requestedApplication();
    const applications = this.applications().filter((application) => application.team === team);
    return applications.find((application) => application.id === requested) ?? applications[0] ?? null;
  });
  readonly requestContext = computed<FactoryRequestContext | null>(() => {
    const team = this.activeTeam();
    return team ? { team, application: this.activeApplication()?.id ?? null } : null;
  });

  constructor() {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      const tree = this.router.parseUrl(event.urlAfterRedirects);
      const team = tree.queryParamMap.get('team')?.trim() || null;
      this.requestedTeam.set(team ?? this.readStoredTeam());
      this.requestedApplication.set(tree.queryParamMap.get('application')?.trim() || null);
      this.routeReady.set(true);
    });

    effect(() => {
      if (!this.routeReady()) return;
      const team = this.activeTeam();
      const requested = this.requestedTeam();
      untracked(() => {
        this.clearPoll();
        if (team) this.writeStoredTeam(team);
        this.canonicalize(team, requested === team ? this.requestedApplication() : null, true);
        this.load(team, true);
      });
    });

    effect(() => {
      if (!this.routeReady()) return;
      const team = this.activeTeam();
      const application = this.activeApplication();
      const loading = this.loading();
      const resolved = this.applicationsResolved();
      if (loading || !resolved) return;
      untracked(() => this.canonicalize(team, application?.id ?? null, true));
    });
  }

  selectTeam(team: string): void {
    if (!this.teams().includes(team)) return;
    this.requestedTeam.set(team);
    this.requestedApplication.set(null);
    this.navigate(team, null, false);
  }

  selectApplication(application: string): void {
    const team = this.activeTeam();
    if (!team || !this.applications().some((candidate) => candidate.id === application)) return;
    this.requestedApplication.set(application);
    this.navigate(team, application, false);
  }

  refreshApplications(): void {
    this.load(this.activeTeam(), false);
  }

  private load(team: string | null, initial: boolean): void {
    const request = ++this.request;
    if (initial) {
      this.loading.set(true);
      this.applicationsResolved.set(false);
    }
    if (!team) {
      this.applications.set([]);
      this.loading.set(false);
      return;
    }
    this.api.list({ team, application: null }).subscribe({
      next: ({ applications }) => {
        if (request !== this.request || this.activeTeam() !== team) return;
        this.applications.set(applications.filter((application) => application.team === team));
        this.applicationsResolved.set(true);
        this.loading.set(false);
        this.schedulePoll(team);
      },
      error: () => {
        if (request !== this.request || this.activeTeam() !== team) return;
        if (initial) this.applications.set([]);
        this.loading.set(false);
        this.schedulePoll(team);
      },
    });
  }

  private schedulePoll(team: string): void {
    this.clearPoll();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (this.activeTeam() !== team) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.schedulePoll(team);
      else this.load(team, false);
    }, 15_000);
  }

  private clearPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private canonicalize(team: string | null, application: string | null, replaceUrl: boolean): void {
    const tree = this.router.parseUrl(this.router.url);
    const currentTeam = tree.queryParamMap.get('team')?.trim() || null;
    const currentApplication = tree.queryParamMap.get('application')?.trim() || null;
    if (currentTeam === team && currentApplication === application) return;
    this.navigate(team, application, replaceUrl);
  }

  private navigate(team: string | null, application: string | null, replaceUrl: boolean): void {
    const tree = this.router.parseUrl(this.router.url);
    tree.queryParams = { ...tree.queryParams };
    if (team) tree.queryParams['team'] = team;
    else delete tree.queryParams['team'];
    if (application) tree.queryParams['application'] = application;
    else delete tree.queryParams['application'];
    void this.router.navigateByUrl(tree, { replaceUrl });
  }

  private teamFromUrl(): string | null {
    return this.router.parseUrl(this.router.url).queryParamMap.get('team')?.trim() || null;
  }

  private applicationFromUrl(url: string): string | null {
    return this.router.parseUrl(url).queryParamMap.get('application')?.trim() || null;
  }

  private readStoredTeam(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private writeStoredTeam(team: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, team);
    } catch {
      // Storage is only a reload default.
    }
  }
}

function browserIsAtPlainRoot(): boolean {
  return typeof window === 'undefined'
    || (window.location.pathname === '/' && window.location.search === '' && window.location.hash === '');
}
