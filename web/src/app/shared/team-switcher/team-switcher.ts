/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { TeamContextService } from '../../core/team/team-context.service';
import { ContextListbox } from '../context-listbox/context-listbox';

/**
 * Team-board switcher. It lists only boards returned in the authenticated
 * session and changes the requirement board without changing infrastructure.
 */
@Component({
  selector: 'factory-team-switcher',
  imports: [ContextListbox, TranslocoPipe],
  templateUrl: './team-switcher.html',
})
export class TeamSwitcher {
  protected readonly ctx = inject(TeamContextService);
  protected readonly hasTeam = computed(() => this.ctx.activeTeam() !== null);
  protected readonly hasMultipleTeams = computed(() => this.ctx.teams().length > 1);
  protected readonly options = computed(() => this.ctx.teams().map((team) => ({ value: team, label: this.pretty(team) })));

  protected pick(slug: string): void {
    this.ctx.setActiveTeam(slug);
  }
  /** Slug to display label (for example, "example-team" to "Example-Team"). */
  protected pretty(slug: string): string {
    return slug
      .split('-')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }
}
