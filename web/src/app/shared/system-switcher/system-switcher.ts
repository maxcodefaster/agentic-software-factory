/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { AuthService } from '../../core/auth/auth.service';
import { SystemContextService } from '../../core/system/system-context.service';
import { ContextListbox } from '../context-listbox/context-listbox';
import { Icon } from '../icon/icon';

@Component({
  selector: 'factory-system-switcher',
  imports: [ContextListbox, Icon, TranslocoPipe],
  templateUrl: './system-switcher.html',
})
export class SystemSwitcher {
  protected readonly auth = inject(AuthService);
  protected readonly systems = inject(SystemContextService);
  readonly createRequested = output<void>();
  protected readonly showSelector = computed(() => this.systems.applications().length > 1 || this.auth.canManageApplications());
  protected readonly options = computed(() => this.systems.applications().map((system) => ({
    value: system.id,
    label: system.name,
    description: system.description || undefined,
  })));

  protected pick(id: string): void {
    this.systems.select(id);
  }
}
