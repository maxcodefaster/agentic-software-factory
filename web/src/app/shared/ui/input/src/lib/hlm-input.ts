/*
 * Spartan-derived portions of this file remain licensed under MIT.
 * Copyright (c) 2024 ROBIN GOETZ. See THIRD_PARTY_NOTICES.
 * Agentic Software Factory modifications: project-specific input styling.
 * Copyright 2026 Agentic Software Factory contributors; modifications are RPL-1.5.
 */

import { Directive } from '@angular/core';
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field';
import { BrnInput } from '@spartan-ng/brain/input';
import { classes } from '@spartan-ng/helm/utils';

@Directive({
  selector: '[hlmInput]',
  hostDirectives: [
    { directive: BrnInput, inputs: ['id', 'forceInvalid'] },
    BrnFieldControlDescribedBy,
  ],
})
export class HlmInput {
  constructor() {
    // The field look lives in the shared `.factory-input` class (styles.css):
    // 4dp radius, status-driven outline (resting 1px 42% → focus dark → invalid
    // danger → muted disabled). The brain hostDirectives above set
    // `data-matches-spartan-invalid`, which `.factory-input` styles.
    classes(() => 'factory-input h-9');
  }
}
