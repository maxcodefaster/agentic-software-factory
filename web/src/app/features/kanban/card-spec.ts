/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import type { RequirementSpec } from '../../core/api/kanban.types';
import { Icon } from '../../shared/icon/icon';

/**
 * Card spec — a calm, always-visible reference to the agreed requirement
 * (`card.meta.requirementSpec`), shown throughout implementation so the work
 * remains tied to what was agreed.
 */
@Component({
  selector: 'factory-card-spec',
  imports: [Icon, TranslocoPipe],
  templateUrl: './card-spec.html',
})
export class CardSpec {
  readonly spec = input.required<RequirementSpec>();
  /** Compact presentation for the Dossier reference rail (vs. the full-size
   *  "hero" rendering the freshly-clarified spec gets in the Stage). */
  readonly dense = input(false);
}
