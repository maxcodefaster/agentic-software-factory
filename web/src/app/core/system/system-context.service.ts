/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Injectable, inject } from '@angular/core';

import { FactoryContextStore } from '../context/factory-context.store';

@Injectable({ providedIn: 'root' })
export class SystemContextService {
  private readonly store = inject(FactoryContextStore);
  readonly applications = this.store.applications;
  readonly loading = this.store.loading;
  readonly activeSystem = this.store.activeApplication;

  select(id: string): void {
    this.store.selectApplication(id);
  }

  refresh(): void {
    this.store.refreshApplications();
  }
}
