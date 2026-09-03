/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of } from 'rxjs';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import type { ImplementationRun } from '@agentic-software-factory/api-contracts/implementation';
import type { RequirementSpec } from '@agentic-software-factory/api-contracts/kanban';
import { ImplementationClient } from '../../core/api/implementation.client';
import { KanbanInterviewClient } from '../../core/api/kanban-interview.client';
import type { KanbanCard } from '../../core/api/kanban.types';
import { UsersClient } from '../../core/api/users.client';
import { CardDetail } from './card-detail';

const specification: RequirementSpec = {
  goal: 'Make onboarding obvious.',
  users: ['New advisors'],
  userStories: ['As an advisor I understand the first task.'],
  acceptanceCriteria: ['The first task is visible.', 'The flow is keyboard accessible.'],
  nonFunctionalRequirements: ['WCAG 2.2 AA'],
  moscow: { must: ['Guided start'], should: ['Resume'], could: [] },
  openQuestions: ['Which analytics event is required?'],
  nonGoals: ['Admin onboarding'],
};

const application: ApplicationSummary = {
  id: 'factory/inventory', team: 'factory', name: 'Inventory Service', description: '', status: 'running', healthy: true,
  workspaceId: 'workspace-1', workspaceUrl: null, chatUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [], declaredApps: [], repositoryUrl: null, releasesUrl: null, newAgentUrl: null,
};

const doneRun: ImplementationRun = {
  id: 'run-1', requirementNumber: 1, applicationId: application.id, applicationName: application.name, acceptedDigest: 'sha256:accepted',
  repository: application.id, repositoryUrl: 'https://git.example/customer', branch: 'factory/requirement-1', pullNumber: 1,
  pullUrl: 'https://git.example/customer/pulls/1', headSha: 'abcdef1234567890', mergedSha: 'abcdef1234567890', phase: 'done',
  agentStatus: 'completed', agentError: null, agentStartedHeadSha: 'previous', checks: [{ context: 'factory/verification', state: 'success', description: 'Verification healthy', targetUrl: null }],
  reviews: [{ id: 1, state: 'approved', body: 'Approved', reviewer: 'reviewer', commitSha: 'abcdef1234567890', submittedAt: '2026-01-01T00:00:00Z' }],
  blockers: [], nextAction: '', workspaceUrl: null, agentUrl: null, ideUrl: null, developmentApps: [], verificationApps: [],
  isContributor: true, canContinueBranch: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T01:00:00Z',
};

describe('CardDetail narrative', () => {
  const listUsers = vi.fn(() => of({ users: [] }));

  beforeEach(async () => {
    listUsers.mockClear();
    await TestBed.configureTestingModule({
      imports: [
        CardDetail,
        TranslocoTestingModule.forRoot({
          langs: { en: {
            factory: {
              stageTask: { ideation: 'Capture problem', requirements: 'Specify requirement', implementation: 'Track delivery', done: 'Review completion' },
              stageDescription: { ideation: 'Describe the request.', requirements: 'Review the complete specification.', implementation: 'Follow each system.', done: 'Evidence remains available.' },
              originalIdea: 'Original idea', affectedSystems: 'Affected systems', applications: 'Systems', application: 'System', ticketDossier: 'Ticket details', responsible: 'Responsible', unassigned: 'Unassigned', noLinkedApplication: 'No linked system', acceptedRevision: 'Accepted revision', history: 'History', searchPeople: 'Search people', noPeople: 'No people',
               specificationState: { proposed: 'Ready to confirm', accepted: 'Accepted', draft: 'Draft' }, reviewSpecification: 'Review specification', interviewRecord: 'Interview record', completionReceipt: 'Completion receipt', acceptedRequirement: 'Accepted requirement', confirmRequirement: 'Confirm requirement', saveBeforeConfirm: 'Save the proposal changes before confirming the requirement.', saveChanges: 'Save changes', startRequirementsEngineering: 'Start Requirements Engineering', allSaved: 'All saved', deleteRequirement: 'Delete', saving: 'Saving',
              implementation: 'Implementation', editSpecification: 'Edit requirement', refreshStatus: 'Refresh', deliveryLoading: 'Loading', phase: { done: 'Done' }, action: { done: 'Inspect completion' }, checksDetails: 'Checks', review: 'Review', reviewState: { approved: 'Approved' }, reviewHint: 'No review', openPr: 'Open PR', openRepository: 'Open repository', sourceControl: 'Source control', liveDevelopmentPreviews: 'Development previews', verificationApps: 'Verification apps', appHealth: { healthy: 'Ready' },
            },
            board: { colIdeation: 'Request', colRequirements: 'Requirements', colImplementation: 'Implementation', colDone: 'Done', status: { reqClarified: 'Specified' } },
            card: { requirement: 'Requirement', acceptance: 'Acceptance criteria', priority: 'Priority', must: 'Must', should: 'Should', could: 'Could', nonFunctional: 'Quality', showStories: '{{count}} stories', openQuestions: 'Open questions', applicationsHint: 'Select systems', saveApplications: 'Save systems', noApplications: 'No systems', blurbIdeation: '', blurbRequirements: '', blurbImplementation: '', blurbDone: '' },
            common: { close: 'Close', delete: 'Delete', cancel: 'Cancel' },
            authorization: { reviewerRequired: 'Reviewer required', developerRequired: 'Developer required' },
          } },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        { provide: UsersClient, useValue: { list: listUsers } },
        { provide: KanbanInterviewClient, useValue: { get: () => of({ state: { version: 1, runId: 'run', turns: [], pending: null, done: true, retakes: 0, startedAt: '', startedBy: '' }, spec: specification, agent: { available: true } }), getEvents: () => of({ events: [] }) } },
        { provide: ImplementationClient, useValue: { list: () => of({ runs: [doneRun] }) } },
      ],
    }).compileComponents();
  });

  it('makes Request a single capture task with a visible system gate', () => {
    const fixture = render(card('ideation'), true);
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).not.toContain('Capture problem');
    expect(text).toContain('Original idea');
    expect(text).toContain('Inventory Service');
    expect(text).toContain('Start Requirements Engineering');
  });

  it('shows the complete specification in the main Requirements review surface', () => {
    const fixture = render(card('requirements', { requirementSpec: specification, specificationState: 'proposed' }), true);
    const advanced = vi.fn();
    fixture.componentInstance.advance.subscribe(advanced);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Review specification');
    expect(root.textContent).toContain('Make onboarding obvious.');
    expect(root.querySelector('#spec-goal')).toBeNull();
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Edit requirement'))!.click();
    fixture.detectChanges();
    expect((root.querySelector('#spec-goal') as HTMLTextAreaElement).value).toBe('Make onboarding obvious.');
    expect((root.querySelector('#spec-users') as HTMLTextAreaElement).value).toBe('New advisors');
    expect((root.querySelector('#spec-constraints') as HTMLTextAreaElement).value).toBe('WCAG 2.2 AA');
    expect((root.querySelector('#spec-open-questions') as HTMLTextAreaElement).value).toBe('Which analytics event is required?');
    expect(fixture.nativeElement.textContent).toContain('Confirm requirement');

    const confirm = [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Confirm requirement'))!;
    confirm.click();
    expect(advanced).toHaveBeenCalledWith(expect.objectContaining({
      toColumn: 'implementation',
      specification,
    }));
  });

  it('does not offer backward movement from Requirements', () => {
    const fixture = render(card('requirements', { requirementSpec: specification, specificationState: 'proposed' }), true, true);
    const moved = vi.fn();
    fixture.componentInstance.moveBackward.subscribe(moved);

    const actions = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-move-back]');
    expect(actions).toHaveLength(0);
    expect(moved).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Confirm requirement');
  });

  it('keeps an accepted requirement formatted and immutable', () => {
    const fixture = render(card('requirements', { requirementSpec: specification, specificationState: 'accepted' }), true, true);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Make onboarding obvious.');
    expect(root.textContent).not.toContain('Edit requirement');
    expect(root.querySelector('#spec-goal')).toBeNull();
    expect(root.querySelector('[data-move-back]')).toBeNull();
  });

  it('requires proposal edits to be saved before confirmation', () => {
    const fixture = render(card('requirements', { requirementSpec: specification, specificationState: 'proposed' }), true);
    const root = fixture.nativeElement as HTMLElement;
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Edit requirement'))!.click();
    fixture.detectChanges();
    const goal = root.querySelector<HTMLTextAreaElement>('#spec-goal')!;
    goal.value = 'A changed goal';
    goal.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirm = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Confirm requirement'))!;
    expect(confirm.disabled).toBe(true);
    expect(root.textContent).toContain('Save the proposal changes before confirming the requirement.');
    expect(root.textContent).toContain('Save changes');
  });

  it('does not turn an existing finalized interview read into a board refresh', () => {
    const fixture = TestBed.createComponent(CardDetail);
    const changed = vi.fn();
    fixture.componentRef.setInput('card', card('requirements', { requirementSpec: specification, specificationState: 'proposed' }));
    fixture.componentRef.setInput('applications', [application]);
    fixture.componentInstance.requirementsChanged.subscribe(changed);
    fixture.detectChanges();

    expect(changed).not.toHaveBeenCalled();
  });

  it('renders Implementation as system delivery lanes', async () => {
    const fixture = render(card('implementation', { requirementSpec: specification, specificationState: 'accepted' }), false);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Accepted requirement');
    expect(root.textContent).toContain('Make onboarding obvious.');
    expect(root.querySelectorAll('[data-implementation-lane]').length).toBe(1);
    const implementationPosition = root.querySelector('factory-developer-mode')?.compareDocumentPosition(root.querySelector('#accepted-requirement-heading')!) ?? 0;
    expect(implementationPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.querySelector('.factory-overlay-panel')?.className).toContain('sm:h-[calc(100dvh-3rem)]');
    expect(root.querySelector('footer')).toBeNull();
    expect(root.querySelector('factory-ticket-dossier details')?.hasAttribute('open')).toBe(true);
    expect(root.textContent).not.toContain('Delete');
    expect([...root.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Close')).toHaveLength(0);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('does not offer backward movement after implementation starts', () => {
    const fixture = render(card('implementation', { requirementSpec: specification, specificationState: 'accepted' }), false, true);
    const moved = vi.fn();
    fixture.componentInstance.moveBackward.subscribe(moved);

    const actions = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-move-back]');
    expect(actions).toHaveLength(0);
    expect(moved).not.toHaveBeenCalled();
  });

  it('renders Done as an immutable completion receipt with retained delivery evidence', async () => {
    const fixture = render(card('done', { requirementSpec: specification, specificationState: 'accepted', acceptance: { digest: 'sha256:accepted' } }), true, true);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Accepted requirement');
    expect(root.textContent).toContain('Make onboarding obvious.');
    expect(root.textContent).toContain('Open PR');
    expect(root.textContent).toContain('Approved');
    const implementationPosition = root.querySelector('factory-developer-mode')?.compareDocumentPosition(root.querySelector('#accepted-requirement-heading')!) ?? 0;
    expect(implementationPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.querySelector('#requirement-title')).toBeNull();
    expect(root.textContent).not.toContain('Delete');
    expect(root.querySelector('#accepted-requirement-heading')?.closest('details')).toBeNull();
    expect(root.querySelector('footer')).toBeNull();
    expect(root.querySelector('[data-move-back]')).toBeNull();
  });
});

function card(column: KanbanCard['column'], meta: Record<string, unknown> = {}): KanbanCard {
  return {
    id: '1', number: 1, url: 'https://git.example/issues/1', title: 'Guided onboarding', description: 'New users need a clear first task.', column,
    teamSlug: 'factory', createdBy: 'business', createdByEmail: 'business@example.test', assignee: null, position: 0, meta,
    applications: [{ id: application.id, name: application.name }], deliveryPhase: column === 'done' ? 'done' : null, deliveryLabel: null, deliveryBlockers: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function render(value: KanbanCard, canManage: boolean, canMove = false) {
  const fixture = TestBed.createComponent(CardDetail);
  fixture.componentRef.setInput('card', value);
  fixture.componentRef.setInput('applications', [application]);
  fixture.componentRef.setInput('canManageRequirements', canManage);
  fixture.componentRef.setInput('canMoveRequirements', canMove);
  fixture.detectChanges();
  return fixture;
}
