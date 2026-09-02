/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Injectable, inject } from '@angular/core';

import { FactoryContextStore } from '../context/factory-context.store';

/**
 * Active board context. A user may have access to several team boards.
 * This holds the board whose requirements are shown. Persisted across reloads; defaults
 * to the user's first team; `null` when the user has no team yet.
 */
@Injectable({ providedIn: 'root' })
export class TeamContextService {
  private readonly store = inject(FactoryContextStore);
  readonly teams = this.store.teams;
  readonly activeTeam = this.store.activeTeam;
  readonly hasMultiple = this.store.hasMultipleTeams;

  setActiveTeam(slug: string): void {
    this.store.selectTeam(slug);
  }
}
