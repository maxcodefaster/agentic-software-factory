/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, input, linkedSignal, output, untracked } from '@angular/core';

import type { RequirementSpec } from '@agentic-software-factory/api-contracts/kanban';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'factory-card-spec-editor',
  imports: [TranslocoPipe],
  templateUrl: './card-spec-editor.html',
})
export class CardSpecEditor {
  readonly spec = input.required<RequirementSpec>();
  readonly mode = input<'primary' | 'details' | 'all'>('all');
  readonly changed = output<RequirementSpec>();

  protected readonly goal = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.spec().goal) });
  protected readonly users = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().users)) });
  protected readonly stories = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().userStories)) });
  protected readonly criteria = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().acceptanceCriteria)) });
  protected readonly nonFunctional = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().nonFunctionalRequirements)) });
  protected readonly must = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().moscow.must)) });
  protected readonly should = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().moscow.should)) });
  protected readonly could = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().moscow.could)) });
  protected readonly questions = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().openQuestions)) });
  protected readonly nonGoals = linkedSignal({ source: () => JSON.stringify(this.spec()), computation: () => untracked(() => this.lines(this.spec().nonGoals)) });
  protected readonly preview = computed<RequirementSpec>(() => ({
    goal: this.goal(),
    users: this.values(this.users()),
    userStories: this.values(this.stories()),
    acceptanceCriteria: this.values(this.criteria()),
    nonFunctionalRequirements: this.values(this.nonFunctional()),
    moscow: { must: this.values(this.must()), should: this.values(this.should()), could: this.values(this.could()) },
    openQuestions: this.values(this.questions()),
    nonGoals: this.values(this.nonGoals()),
  }));

  protected emit(): void {
    this.changed.emit({ ...this.preview(), goal: this.goal().trim() });
  }

  private lines(values: string[]): string { return values.join('\n'); }
  private values(value: string): string[] { return value.split('\n').map((item) => item.trim()).filter(Boolean); }
}
