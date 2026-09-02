/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type { MonitoringResponse } from '@agentic-software-factory/api-contracts/monitoring';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';
import { finalize } from 'rxjs';

import { MonitoringClient } from '../../core/api/monitoring.client';
import { LocaleService } from '../../core/i18n/locale';
import { ErrorState, LoadingState } from '../../shared/feedback/feedback';
import { Icon } from '../../shared/icon/icon';
import { Overlay } from '../../shared/overlay/overlay';

@Component({
  selector: 'factory-monitoring-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslocoPipe, HlmButton, ErrorState, Icon, LoadingState, Overlay],
  templateUrl: './monitoring-drawer.html',
})
export class MonitoringDrawer {
  private readonly monitoringClient = inject(MonitoringClient);
  protected readonly locale = inject(LocaleService);

  readonly open = input(false);
  readonly closed = output<void>();

  protected readonly monitoring = signal<MonitoringResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);

  constructor() {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.monitoringClient.getWorkspaceMonitoring().pipe(
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: (monitoring) => this.monitoring.set(monitoring),
      error: () => {
        this.monitoring.set(null);
        this.loadFailed.set(true);
      },
    });
  }

}
