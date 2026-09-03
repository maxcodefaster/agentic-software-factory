/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ImplementationRun } from '@agentic-software-factory/api-contracts/implementation';
import { of, Subject, throwError } from 'rxjs';

import { ApplicationsClient } from '../../core/api/applications.client';
import { ImplementationClient } from '../../core/api/implementation.client';
import type { KanbanCard } from '../../core/api/kanban.types';
import { DeveloperMode } from './developer-mode';

const run: ImplementationRun = {
  id: 'run-1', requirementNumber: 42, applicationId: 'app-1', applicationName: 'Orders', acceptedDigest: 'digest',
  repository: 'factory/orders', repositoryUrl: 'https://git.example/factory/orders', branch: 'requirement-42', pullNumber: 7,
  pullUrl: 'https://git.example/factory/orders/pulls/7', headSha: 'abcdef1234567890', mergedSha: null, phase: 'awaiting-review',
  agentStatus: 'completed', agentError: null, agentStartedHeadSha: 'previous-head',
  checks: [], reviews: [], blockers: [], nextAction: '', workspaceUrl: null, agentUrl: null, ideUrl: null,
  developmentApps: [{ slug: 'customer', displayName: 'Customer app', url: 'https://preview.example/customer', health: 'healthy' }],
  verificationApps: [{ slug: 'customer', displayName: 'Customer app', url: 'https://verification.example/customer', health: 'healthy' }],
  isContributor: true, canContinueBranch: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: null,
};

const requirement = {
  id: 'card-42', number: 42, url: '', title: 'Tune validation', description: '', column: 'implementation', teamSlug: 'factory',
  createdBy: 'alice', createdByEmail: 'alice@example.com', assignee: null, position: 0, meta: {}, applications: [],
  deliveryPhase: 'awaiting-review', deliveryLabel: null, deliveryBlockers: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
} satisfies KanbanCard;

describe('DeveloperMode', () => {
  const review = vi.fn();
  const prepareVerification = vi.fn();
  const complete = vi.fn();
  const start = vi.fn();
  const list = vi.fn();
  const developmentTools = vi.fn();

  beforeEach(async () => {
    review.mockReset();
    prepareVerification.mockReset();
    complete.mockReset();
    start.mockReset();
    list.mockReset();
    developmentTools.mockReset();
    list.mockReturnValue(of({ runs: [run] }));
    developmentTools.mockReturnValue(of({ claimsReady: true, coderIdentity: true, forgejoConnected: true, forgejoUsername: 'alice', connectUrl: null, ready: true }));
    await TestBed.configureTestingModule({
      imports: [
        DeveloperMode,
        TranslocoTestingModule.forRoot({
          langs: { en: { factory: {
            application: 'Application', openAgent: 'Agent Chat', continueIde: 'IDE', openWorkspace: 'Open workspace',
             liveDevelopmentPreviews: 'Live development previews', verificationApps: 'Verification apps', openDevelopmentPreview: 'Open {{name}} development preview', openVerificationApp: 'Open {{name}} verification app', verificationPreparing: 'Preparing the exact-SHA verification environment automatically.', appHealth: { healthy: 'Ready', initializing: 'Starting', unhealthy: 'Unavailable', disabled: 'Disabled' },
            verificationIterationHint: 'Verification remains pinned to {{sha}}; prepare it again after a new SHA.',
            contributorCannotApprove: 'Contributors cannot approve their own delivery.', implementation: 'Implementation', continueWork: 'Continue work',
            deliveryLoading: 'Loading', refreshStatus: 'Refresh status', nextAction: 'Next', openPr: 'Open PR', checksDetails: 'Checks', review: 'Review', reviewHint: 'Review hint', prepareVerification: 'Prepare verification',
            implementationStarting: 'Creating the branch, workspace, and agent', provisioningDetail: 'Workspace is starting. The agent will begin when it is healthy.', developmentTools: 'Development tools',
            retryAgent: 'Retry agent', retryMerge: 'Resume completion', continueBranch: 'Continue this branch', continueBranchHint: 'Factory opens your isolated workspace at the current branch head. No code is copied or lost.', watchAgent: 'Watch agent',
            decisionNote: 'Note', requestChanges: 'Request changes', approve: 'Approve', finish: 'Finish', finishHint: 'Finish hint', merge: 'Merge',
            phase: { 'agent-running': 'Agent coding', 'awaiting-review': 'Ready for review', 'ready-to-merge': 'Ready to merge', done: 'Done' }, action: { 'agent-running': 'Watch the coding agent', 'awaiting-review': 'Prepare review', 'review-ready': 'Review pinned previews', 'ready-to-merge': 'Complete delivery', done: 'Inspect completion' }, hint: { 'agent-running': 'Agent is coding', 'awaiting-review': 'Prepare review', 'review-ready': 'Review every preview', 'ready-to-merge': 'Ready', done: 'Merged' }, deliveryDetails: 'Delivery evidence', sourceControl: 'Source control', openRepository: 'Open repository',
           }, applications: { authorizeForgejo: 'Coder needs repository access.', authorizeForgejoAction: 'Authorize Forgejo in Coder' }, common: { cancel: 'Cancel', close: 'Close' } }, de: {} },
          translocoConfig: { availableLangs: ['en', 'de'], defaultLang: 'en' },
        }),
      ],
      providers: [
        { provide: ImplementationClient, useValue: { list, review, prepareVerification, complete, start } },
         { provide: ApplicationsClient, useValue: { developmentTools } },
      ],
    }).compileComponents();
  });

  it('exposes named development previews and verification links', () => {
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining(['https://preview.example/customer', 'https://verification.example/customer']));
  });

  it('renders every API run in an application lane', () => {
    list.mockReturnValue(of({ runs: [
      run,
      { ...run, id: 'run-2', applicationId: 'app-2', applicationName: 'Billing', repository: 'factory/billing', pullUrl: 'https://git.example/factory/billing/pulls/8', createdAt: '2026-01-02T00:00:00Z' },
      { ...run, id: 'run-3', phase: 'done', completedAt: '2026-01-03T00:00:00Z', createdAt: '2025-12-31T00:00:00Z' },
    ] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-implementation-lane]')).toHaveLength(2);
    expect(root.querySelectorAll('[data-run-id]')).toHaveLength(3);
    expect(root.textContent).toContain('Orders');
    expect(root.textContent).toContain('Billing');
  });

  it('shows one primary next action per actionable application lane', () => {
    list.mockReturnValue(of({ runs: [
      { ...run, phase: 'agent-failed', agentStatus: 'failed', agentError: 'Agent failed', agentUrl: 'https://agent.example/orders' },
      { ...run, id: 'run-2', applicationId: 'app-2', applicationName: 'Billing', phase: 'ready-to-merge', repository: 'factory/billing', isContributor: false, createdAt: '2026-01-02T00:00:00Z' },
      { ...run, id: 'run-old', phase: 'agent-running', agentStatus: 'running', agentUrl: 'https://agent.example/old', createdAt: '2025-12-01T00:00:00Z' },
    ] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    const lanes = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-implementation-lane]')];
    expect(lanes).toHaveLength(2);
    expect(lanes.every((lane) => lane.querySelectorAll('[data-primary-action]').length === 1)).toBe(true);
  });

  it('keeps durable checks, pull request, and latest review visible for a done run', () => {
    list.mockReturnValue(of({ runs: [{
      ...run,
      phase: 'done',
      completedAt: '2026-01-02T00:00:00Z',
      checks: [{ context: 'factory/verification', state: 'success', description: 'Verification ready', targetUrl: 'https://checks.example/verification' }],
      reviews: [
        { id: 1, state: 'commented', body: 'Earlier note', reviewer: 'alice', commitSha: run.headSha, submittedAt: '2026-01-01T01:00:00Z' },
        { id: 2, state: 'approved', body: 'Approved evidence', reviewer: 'bob', commitSha: run.headSha, submittedAt: '2026-01-01T02:00:00Z' },
      ],
    }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector(`a[href="${run.pullUrl}"]`)).not.toBeNull();
    expect(root.querySelector('a[href="https://checks.example/verification"]')).not.toBeNull();
    expect(root.querySelector(`a[href="${run.verificationApps[0]?.url}"]`)).toBeNull();
    expect(root.textContent).toContain('Approved evidence');
    expect(root.textContent).not.toContain('Earlier note');
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('[data-primary-action]')).toBeNull();
  });

  it('keeps workspace and IDE evidence visible while the agent runs', () => {
    list.mockReturnValue(of({ runs: [{ ...run, phase: 'agent-running', agentStatus: 'running', agentUrl: 'https://agent.example/orders', workspaceUrl: 'https://workspace.example', ideUrl: 'https://ide.example' }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    expect([...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].filter((link) => link.href === 'https://agent.example/orders')).toHaveLength(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('a[href="https://workspace.example"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('a[href="https://ide.example"]')).not.toBeNull();
  });

  it('shows Agent Chat and IDE as separate labeled buttons whenever both URLs exist', () => {
    list.mockReturnValue(of({ runs: [{ ...run, phase: 'implementing', agentUrl: 'https://agent.example/orders', ideUrl: 'https://ide.example/orders' }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    const tools = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('[data-development-tool]')];
    expect(tools.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Agent Chat', 'https://agent.example/orders'],
      ['IDE', 'https://ide.example/orders'],
    ]);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-primary-action]')).toBeNull();
  });

  it('hides development Agent Chat, IDE, workspace, and live preview links from reviewers', () => {
    list.mockReturnValue(of({ runs: [{ ...run, isContributor: false, agentUrl: 'https://agent.example/orders', ideUrl: 'https://ide.example/orders', workspaceUrl: 'https://workspace.example/orders' }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-development-tool]')).toBeNull();
    expect(root.querySelector('a[href="https://workspace.example/orders"]')).toBeNull();
    expect(root.querySelector('a[href="https://preview.example/customer"]')).toBeNull();
    expect(root.querySelector('a[href="https://verification.example/customer"]')).not.toBeNull();
    expect(root.querySelector(`a[href="${run.pullUrl}"]`)).not.toBeNull();
  });

  it('hides contributor tools when the current contributor lacks implementation capability', () => {
    list.mockReturnValue(of({ runs: [{ ...run, agentUrl: 'https://agent.example/orders', ideUrl: 'https://ide.example/orders', workspaceUrl: 'https://workspace.example/orders' }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-development-tool]')).toBeNull();
    expect(root.querySelector('a[href="https://workspace.example/orders"]')).toBeNull();
    expect(root.querySelector('a[href="https://preview.example/customer"]')).toBeNull();
    expect(root.querySelector('a[href="https://verification.example/customer"]')).not.toBeNull();
  });

  it('renders check descriptions so pending verification states remain distinguishable', () => {
    list.mockReturnValue(of({ runs: [{
      ...run,
      checks: [
        { context: 'factory/verification', state: 'pending', description: 'SHA-pinned verification has not been created yet.', targetUrl: null },
        { context: 'factory/verification', state: 'pending', description: 'Verification apps are starting.', targetUrl: 'https://checks.example/verification' },
      ],
    }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('SHA-pinned verification has not been created yet.');
    expect(text).toContain('Verification apps are starting.');
  });

  it('shows automatic verification preparation while the current SHA is pending', () => {
    list.mockReturnValue(of({ runs: [{
      ...run,
      phase: 'implementing',
      verificationApps: [],
      checks: [{ context: 'factory/verification', state: 'pending', description: 'Verification is being prepared.', targetUrl: null }],
    }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Preparing the exact-SHA verification environment automatically.');
  });

  it('keeps Coder-discovered initializing and unhealthy preview URLs clickable', () => {
    list.mockReturnValue(of({ runs: [{
      ...run,
      developmentApps: [
        run.developmentApps[0]!,
        { slug: 'api', displayName: 'API', url: 'https://preview.example/api', health: 'initializing' },
        { slug: 'admin', displayName: 'Admin', url: 'https://preview.example/admin', health: 'unhealthy' },
      ],
      verificationApps: [],
    }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('a[href="https://preview.example/customer"]')).not.toBeNull();
    expect(root.querySelector('a[href="https://preview.example/api"] factory-icon.animate-spin')).not.toBeNull();
    expect(root.querySelector('a[href="https://preview.example/admin"] factory-icon')).not.toBeNull();
    expect(root.textContent).not.toContain('Refresh status');
  });

  it('shows verification apps to read-only requirement viewers', () => {
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('a[href="https://verification.example/customer"]')).not.toBeNull();
  });

  it('relies on five-second polling instead of exposing a manual refresh button', () => {
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Refresh status"]')).toBeNull();
  });

  it('shows startup and provisioning progress', () => {
    const pending = new Subject<ImplementationRun>();
    start.mockReturnValue(pending.asObservable());
    list.mockReturnValue(of({ runs: [{ ...run, phase: 'agent-failed', agentStatus: 'failed', agentError: 'Workspace failed', verificationApps: [] }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    button(fixture.nativeElement, 'Retry agent').click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Creating the branch, workspace, and agent');

    pending.next({ ...run, phase: 'provisioning' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Workspace is starting. The agent will begin when it is healthy.');
  });

  it('renders merge once as the lane primary action', () => {
    list.mockReturnValue(of({ runs: [{ ...run, phase: 'ready-to-merge', isContributor: false }] }));
    complete.mockReturnValue(of({ ...run, phase: 'done', isContributor: false }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    const mergeControls = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button, a')]
      .filter((control) => control.textContent?.trim() === 'Merge');
    expect(mergeControls).toHaveLength(1);
    (mergeControls[0] as HTMLButtonElement).click();
    expect(complete).toHaveBeenCalledWith({ team: 'factory', application: null }, run.id);
  });

  it('hides review and merge controls from implementation contributors', () => {
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Approve');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Merge');
  });

  it('shows only persona-authorized implementation controls', () => {
    list.mockReturnValue(of({ runs: [{ ...run, isContributor: false }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    expect(() => button(fixture.nativeElement, 'Approve')).not.toThrow();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Fine-tune');
  });

  it('lets a business user prepare verification without developer controls', () => {
    list.mockReturnValue(of({ runs: [{ ...run, verificationApps: [], isContributor: false }] }));
    prepareVerification.mockReturnValue(of({ ...run, isContributor: false, verificationApps: [{ slug: 'customer', displayName: 'Customer app', url: 'https://verification.example/customer', health: 'healthy' }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canReview', true);
    fixture.detectChanges();

    button(fixture.nativeElement, 'Prepare verification').click();
    expect(prepareVerification).toHaveBeenCalledWith({ team: 'factory', application: null }, run.id);
  });

  it('keeps tenant-only implementation state read-only', () => {
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Approve');
    expect(text).not.toContain('Fine-tune');
    expect(review).not.toHaveBeenCalled();
  });

  it('makes retry the primary action after an agent failure', () => {
    list.mockReturnValue(of({ runs: [{ ...run, phase: 'agent-failed', agentStatus: 'failed', agentError: 'Provider authentication failed', verificationApps: [] }] }));
    start.mockReturnValue(of({ ...run, phase: 'provisioning' }));
    TestBed.overrideProvider(ImplementationClient, { useValue: { list, review, prepareVerification, start } });
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Provider authentication failed');
    button(fixture.nativeElement, 'Retry agent').click();
    expect(start).toHaveBeenCalledWith({ team: 'factory', application: null }, requirement.number, run.applicationId);
  });

  it('exposes the stock Coder Forgejo authorization link after a connection failure', () => {
    developmentTools.mockReturnValue(of({ claimsReady: true, coderIdentity: true, forgejoConnected: false, forgejoUsername: null, connectUrl: 'https://coder.example/external-auth/forgejo', ready: false }));
    list.mockReturnValue(of({ runs: [{ ...run, phase: 'agent-failed', agentStatus: 'failed', agentError: 'Connect Forgejo in Coder before creating a Developer workspace', verificationApps: [] }] }));
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a[href="https://coder.example/external-auth/forgejo"]');
    expect(link?.textContent).toContain('Authorize Forgejo in Coder');
    expect(developmentTools).toHaveBeenCalled();
  });

  it('offers branch continuation to another developer without implying a code copy', () => {
    list.mockReturnValue(of({ runs: [{ ...run, canContinueBranch: true, isContributor: false, verificationApps: [] }] }));
    start.mockReturnValue(of({ ...run, phase: 'provisioning', canContinueBranch: false, isContributor: true }));
    TestBed.overrideProvider(ImplementationClient, { useValue: { list, review, prepareVerification, start } });
    const fixture = TestBed.createComponent(DeveloperMode);
    fixture.componentRef.setInput('requirement', requirement);
    fixture.componentRef.setInput('canImplement', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No code is copied or lost');
    button(fixture.nativeElement, 'Continue this branch').click();
    expect(start).toHaveBeenCalledWith({ team: 'factory', application: null }, requirement.number, run.applicationId);
  });
});

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label));
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
