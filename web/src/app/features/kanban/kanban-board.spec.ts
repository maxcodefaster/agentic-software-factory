/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, Subject, throwError } from 'rxjs';

import type { ApplicationSummary, DeveloperWorkspace } from '@agentic-software-factory/api-contracts/applications';
import type { KanbanColumnId } from '@agentic-software-factory/api-contracts/kanban';
import { ApplicationsClient } from '../../core/api/applications.client';
import { AuthService } from '../../core/auth/auth.service';
import { KanbanClient } from '../../core/api/kanban.client';
import type { KanbanBoardPage as KanbanBoardData, KanbanCard, KanbanColumn } from '../../core/api/kanban.types';
import { SystemContextService } from '../../core/system/system-context.service';
import { TeamContextService } from '../../core/team/team-context.service';
import { BoardStore } from './board.store';
import { KanbanBoard } from './kanban-board';

const auth = {
  teams: signal(['factory']),
  canCreateRequirements: signal(false),
  canManageRequirements: () => false,
  canMoveRequirements: () => false,
  canInterviewRequirements: () => false,
  canImplement: () => false,
  canReviewImplementation: () => false,
  canCreateDeveloperWorkspace: () => false,
  isAdmin: () => false,
  capabilities: () => ({ requirementsClose: false, requirementsPropose: false }),
};

const columnIds: KanbanColumnId[] = ['ideation', 'requirements', 'implementation', 'done'];

const system = {
  id: 'factory/orders', team: 'factory', name: 'Orders', description: 'Order service', repositoryUrl: 'https://git.example/orders',
  releasesUrl: 'https://git.example/orders/releases', status: 'ready', healthy: true, workspaceId: 'shared-main', workspaceUrl: null,
  chatUrl: null, ideUrl: null, terminalUrl: null, servicesUrl: null, apps: [], declaredApps: [], newAgentUrl: null,
} satisfies ApplicationSummary;

function card(id: string, title: string): KanbanCard {
  return {
    id,
    number: Number(id),
    url: '',
    title,
    description: '',
    column: 'ideation',
    teamSlug: 'factory',
    createdBy: 'alice',
    createdByEmail: 'alice@example.com',
    assignee: null,
    position: 0,
    meta: {},
    applications: [],
    deliveryPhase: null,
    deliveryLabel: null,
    deliveryBlockers: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function board(...cards: KanbanCard[]): KanbanBoardData {
  return {
    generatedAt: '2026-01-01T00:00:00Z',
    application: null,
    total: cards.length,
    truncated: false,
    nextCursor: null,
    columns: columnIds.map((id): KanbanColumn => ({
      id,
      label: id,
      hint: '',
      cards: cards.filter((item) => item.column === id),
    })),
  };
}

beforeEach(() => TestBed.configureTestingModule({ providers: [BoardStore] }));

describe('KanbanBoard persona controls', () => {
  it('keeps all four board columns visible when there are no requirements', async () => {
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }) } },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-board-column]')).toHaveLength(4);
    const boardRegion = (fixture.nativeElement as HTMLElement).querySelector('[role="region"][tabindex="0"]');
    expect(boardRegion?.getAttribute('aria-label')).not.toBeNull();
  });

  it('does not render status selects on ticket cards', async () => {
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canMoveRequirements: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board(card('1', 'Movable ticket'))) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }) } },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('article select')).toBeNull();
  });

  it('keeps the loaded board mounted when application polling returns the same System ID', async () => {
    const activeSystem = signal<ApplicationSummary | null>(system);
    const getBoard = vi.fn(() => of(board(card('1', 'Stable ticket'))));
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard } },
        { provide: ApplicationsClient, useValue: {} },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem, loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector('[role="region"]');

    activeSystem.set({ ...system, healthy: false, status: 'starting' });
    fixture.detectChanges();

    expect(getBoard).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="region"]')).toBe(region);
  });

  it('shows assignee, truncated context, and an active implementation spinner on closed cards', async () => {
    const implementing = { ...card('2', 'Remove tutorial'), column: 'implementation' as const, description: 'Remove the old tutorial from the customer flow because it blocks first-time users.', assignee: 'alex', deliveryPhase: 'agent-running' as const };
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: { factory: { assignedTo: 'Assigned to {{name}}', status: { 'agent-running': 'Agent running' } } } }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board(implementing)) } },
        { provide: ApplicationsClient, useValue: {} },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const article = (fixture.nativeElement as HTMLElement).querySelector('article')!;

    expect(article.textContent).toContain('Assigned to alex');
    expect(article.querySelector('.line-clamp-2')).not.toBeNull();
    expect(article.querySelector('factory-icon.animate-spin')).not.toBeNull();
  });

  it('shows requirement creation whenever the session grants its capability', async () => {
    const canCreate = signal(false);
    const personaAuth = {
      teams: signal(['factory']),
      canCreateRequirements: canCreate,
      canManageRequirements: canCreate,
      canMoveRequirements: canCreate,
      canInterviewRequirements: canCreate,
      canImplement: () => false,
      canReviewImplementation: () => false,
      canCreateDeveloperWorkspace: () => false,
      isAdmin: () => false,
      capabilities: () => ({ requirementsClose: canCreate(), requirementsPropose: canCreate() }),
    };
    await TestBed.configureTestingModule({
      imports: [
        KanbanBoard,
        TranslocoTestingModule.forRoot({
          langs: { en: { factory: { requirements: 'Requirements', applications: 'Applications', newRequirement: 'New requirement', noRequirements: 'No requirements', emptyRequirements: 'No requirements yet' }, authorization: { tenantReadOnly: 'Read-only tenant access' } } },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: personaAuth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('New requirement');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Read-only tenant access');
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toContain('Orders');
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).not.toContain('factory');

    canCreate.set(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('New requirement');
  });

  it('does not allow completed tickets to move backward', async () => {
    const moveCard = vi.fn();
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canMoveRequirements: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()), moveCard } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    const completed = { ...card('9', 'Completed'), column: 'done' as const };
    (fixture.componentInstance as unknown as { moveCard(card: KanbanCard, column: KanbanColumnId): void }).moveCard(completed, 'requirements');
    expect(moveCard).not.toHaveBeenCalled();
  });

  it('ignores a detail-requested backward move', async () => {
    const moved = { ...card('8', 'Clarified ticket'), column: 'requirements' as const };
    const moveCard = vi.fn(() => of({ ...moved, column: 'ideation' as const }));
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canMoveRequirements: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board(moved)), moveCard } },
        { provide: ApplicationsClient, useValue: {} },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    const component = fixture.componentInstance as unknown as {
      moveCard(card: KanbanCard, column: KanbanColumnId): void;
    };
    fixture.detectChanges();

    component.moveCard(moved, 'ideation');
    expect(moveCard).not.toHaveBeenCalled();
  });

  it('keeps the implementation detail action on the acceptance path', async () => {
    const requirement = { ...card('7', 'Specified ticket'), column: 'requirements' as const };
    const updated = { ...requirement, updatedAt: '2026-01-02T00:00:00Z' };
    const updateCard = vi.fn(() => of(updated));
    const accept = vi.fn(() => of({}));
    const moveCard = vi.fn();
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canMoveRequirements: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board(requirement)), updateCard, accept, moveCard } },
        { provide: ApplicationsClient, useValue: {} },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.componentRef.setInput('requirementId', requirement.id);
    fixture.detectChanges();
    const patch = { title: requirement.title, description: requirement.description, assignee: null };
    const specification = { goal: 'Ship safely', users: [], userStories: [], acceptanceCriteria: ['Accepted'], nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [] };

    (fixture.componentInstance as unknown as { onDetailAdvance(advance: unknown): void }).onDetailAdvance({
      patch,
      toColumn: 'implementation',
      specification,
    });

    const context = { team: 'factory', application: null };
    expect(updateCard).toHaveBeenCalledWith(context, requirement, patch);
    expect(accept).toHaveBeenCalledWith(context, updated, specification);
    expect(moveCard).not.toHaveBeenCalled();
  });

  it('moves a saved idea with the fresh update timestamp before releasing the detail lock', async () => {
    const idea = card('6', 'Lifecycle proof');
    const updated = { ...idea, updatedAt: '2026-01-02T00:00:00Z' };
    const updateCard = vi.fn(() => of(updated));
    const moveCard = vi.fn(() => of({ ...updated, column: 'requirements' as const }));
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canMoveRequirements: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board(idea)), updateCard, moveCard } },
        { provide: ApplicationsClient, useValue: {} },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.componentRef.setInput('requirementId', idea.id);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      onDetailAdvance(advance: unknown): void;
      selectedCard(): KanbanCard | null;
      savingDetail(): boolean;
    };

    component.onDetailAdvance({ patch: { title: idea.title, description: idea.description, assignee: null }, toColumn: 'requirements' });

    expect(moveCard).toHaveBeenCalledWith({ team: 'factory', application: null }, updated, 'requirements');
    expect(component.savingDetail()).toBe(false);
  });

  it('creates a personal System IDE even when shared staging has a workspace ID', async () => {
    const workspace = new Subject<DeveloperWorkspace>();
    const createWorkspace = vi.fn(() => workspace);
    const replace = vi.fn();
    const placeholder = { opener: window, location: { replace }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(placeholder);
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: { applications: { startOrOpenIde: 'Start or open System IDE' } } }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canCreateDeveloperWorkspace: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }), createWorkspace } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const action = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Start or open System IDE')) as HTMLButtonElement;

    expect(action).toBeDefined();
    action.click();
    expect(createWorkspace).toHaveBeenCalledWith({ team: 'factory', application: system.id }, system.id);
    expect(open).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    workspace.next({ workspaceId: 'personal-1', workspaceUrl: null, ideUrl: 'https://ide.example/personal-1', terminalUrl: null, servicesUrl: null, apps: [] });
    expect(replace).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    action.click();
    expect(createWorkspace).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://ide.example/personal-1', '_blank', 'noopener');
  });

  it('shows workspace errors without opening a tab', async () => {
    const workspace = new Subject<never>();
    const placeholder = { opener: window, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(placeholder);
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: { applications: { developerWorkspaceError: 'Workspace failed', authorizeForgejo: 'Coder needs repository access.', authorizeForgejoAction: 'Authorize Forgejo in Coder' } } }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canCreateDeveloperWorkspace: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }), createWorkspace: () => workspace, developmentTools: () => of({ claimsReady: true, coderIdentity: true, forgejoConnected: false, forgejoUsername: null, connectUrl: 'http://coder.localhost/external-auth/forgejo', ready: false }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);

    (fixture.componentInstance as unknown as { openSystemIde(system: ApplicationSummary): void }).openSystemIde(system);
    workspace.error(new Error('failed'));

    expect(placeholder.close).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Authorize Forgejo in Coder');
  });

  it('keys personal IDEs by System without opening placeholder tabs', async () => {
    const billing = { ...system, id: 'factory/billing', name: 'Billing' } satisfies ApplicationSummary;
    const activeSystem = signal<ApplicationSummary | null>(system);
    const workspaces = new Map<string, Subject<DeveloperWorkspace>>();
    const createWorkspace = vi.fn((_context: unknown, id: string) => {
      const request = new Subject<DeveloperWorkspace>();
      workspaces.set(id, request);
      return request;
    });
    const first = { opener: window, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    const second = { opener: window, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(first).mockReturnValueOnce(second);
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canCreateDeveloperWorkspace: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([system, billing]), activeSystem, loading: signal(false), refresh: vi.fn() } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: { createWorkspace } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { openSystemIde(system: ApplicationSummary): void };

    component.openSystemIde(system);
    expect(open).not.toHaveBeenCalled();
    workspaces.get(system.id)!.next({ workspaceId: 'orders-ide', workspaceUrl: null, ideUrl: 'https://ide.example/orders', terminalUrl: null, servicesUrl: null, apps: [] });
    activeSystem.set(billing);
    fixture.detectChanges();
    component.openSystemIde(billing);

    expect(createWorkspace.mock.calls.map(([, id]) => id)).toEqual([system.id, billing.id]);
    expect(open).not.toHaveBeenCalled();
    workspaces.get(billing.id)!.next({ workspaceId: 'billing-ide', workspaceUrl: null, ideUrl: 'https://ide.example/billing', terminalUrl: null, servicesUrl: null, apps: [] });
    expect(second.location.replace).not.toHaveBeenCalled();
  });

  it('does not reorder cards within a stage because the API has no manual order field', async () => {
    const moveCard = vi.fn();
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canMoveRequirements: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board(card('1', 'First'), card('2', 'Second'))), moveCard } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { columns(): KanbanColumn[]; onDrop(event: unknown): void };

    component.onDrop({
      previousContainer: { id: 'ideation' }, container: { id: 'ideation' }, previousIndex: 0, currentIndex: 1,
    });

    expect(component.columns()[0]?.cards.map((item) => item.id)).toEqual(['1', '2']);
    expect(moveCard).not.toHaveBeenCalled();
  });

  it('shows distinct staging health states and Coder-discovered app links', async () => {
    const staged = {
      ...system,
      declaredApps: [
        { slug: 'shop', displayName: 'Shop' },
        { slug: 'api', displayName: 'API' },
        { slug: 'admin', displayName: 'Admin' },
        { slug: 'legacy', displayName: 'Legacy' },
      ],
      apps: [
        { slug: 'shop', displayName: 'Shop', url: 'https://preview.example/shop', health: 'healthy' as const },
        { slug: 'api', displayName: 'API', url: 'https://preview.example/api', health: 'initializing' as const },
        { slug: 'admin', displayName: 'Admin', url: 'https://preview.example/admin', health: 'unhealthy' as const },
        { slug: 'legacy', displayName: 'Legacy', url: 'https://preview.example/legacy', health: 'disabled' as const },
      ],
    } satisfies ApplicationSummary;
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({
        langs: { en: { factory: { appHealth: { healthy: 'Ready', initializing: 'Starting', unhealthy: 'Unavailable', disabled: 'Disabled' }, systemApplications: 'Staging' } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([staged]), activeSystem: signal(staged), loading: signal(false), refresh: vi.fn() } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect([...root.querySelectorAll<HTMLElement>('[data-staging-health]')].map((item) => item.dataset['stagingHealth'])).toEqual(['healthy', 'initializing', 'unhealthy', 'disabled']);
    expect([...root.querySelectorAll('[data-staging-health]')].map((item) => item.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Ready'), expect.stringContaining('Starting'), expect.stringContaining('Unavailable'), expect.stringContaining('Disabled'),
    ]));
    expect(root.querySelector('a[href="https://preview.example/api"]')).not.toBeNull();
    expect(root.querySelector('a[href="https://preview.example/admin"]')).not.toBeNull();
    expect(root.querySelector('[data-staging-health="initializing"] factory-icon.animate-spin')).not.toBeNull();
    expect(root.querySelector('[data-system-header]')?.classList.contains('factory-card')).toBe(false);
    expect(root.querySelectorAll('[data-system-header-row]')).toHaveLength(2);
  });

  it('keeps exactly one IDE action after a personal workspace becomes ready', async () => {
    const workspace = new Subject<DeveloperWorkspace>();
    const placeholder = { opener: window, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(placeholder);
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({
        langs: { en: { applications: { startOrOpenIde: 'Start or open System IDE' } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { ...auth, canCreateDeveloperWorkspace: () => true } },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([system]), activeSystem: signal(system), loading: signal(false), refresh: vi.fn() } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: { createWorkspace: () => workspace } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();
    const action = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Start or open System IDE'))!;
    action.click();
    workspace.next({ workspaceId: 'personal-1', workspaceUrl: null, ideUrl: 'https://ide.example/personal-1', terminalUrl: null, servicesUrl: null, apps: [] });
    fixture.detectChanges();

    const ideActions = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('button, a')]
      .filter((element) => element.textContent?.includes('System IDE'));
    expect(ideActions).toHaveLength(1);
  });

  it('keeps terminal and process controls inside the browser IDE', async () => {
    const staged = { ...system, terminalUrl: 'https://coder.example/terminal', servicesUrl: 'https://coder.example/terminal?app=process-compose' } satisfies ApplicationSummary;
    await TestBed.configureTestingModule({
      imports: [KanbanBoard, TranslocoTestingModule.forRoot({
        langs: { en: { applications: { startOrOpenIde: 'Start or open System IDE' } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: SystemContextService, useValue: { applications: signal([staged]), activeSystem: signal(staged), loading: signal(false), refresh: vi.fn() } },
        { provide: KanbanClient, useValue: { getBoard: () => of(board()) } },
        { provide: ApplicationsClient, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanBoard);
    fixture.detectChanges();

    const hrefs = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')]
      .map((link) => link.getAttribute('href'));
    expect(hrefs).not.toContain(staged.servicesUrl);
    expect(hrefs).not.toContain(staged.terminalUrl);
  });
});

describe('KanbanBoard ticket routes', () => {
  async function create(getBoard: ReturnType<typeof vi.fn>, requirementId?: string) {
    await TestBed.configureTestingModule({
      imports: [
        KanbanBoard,
        TranslocoTestingModule.forRoot({
          langs: { en: { board: { errLoad: 'Board could not be loaded.', ticketNotFound: 'Ticket #{{number}} was not found.', ticketResolveError: 'Ticket #{{number}} could not be resolved.' } } },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        BoardStore,
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: TeamContextService, useValue: { activeTeam: signal('factory') } },
        { provide: KanbanClient, useValue: { getBoard } },
        { provide: ApplicationsClient, useValue: { list: () => of({ applications: [system] }) } },
      ],
    })
      .overrideComponent(KanbanBoard, {
        set: {
          template: `
            @if (loading()) { <span>Loading</span> }
            @else if (error(); as message) { <span>{{ message }}</span> }
            @else {
              @for (column of columns(); track column.id) {
                @for (card of column.cards; track card.id) { <span>Board {{ card.id }}</span> }
              }
            }
            @if (selectedCard(); as card) { <span>Selected {{ card.id }}</span> }
          `,
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(KanbanBoard);
    if (requirementId) fixture.componentRef.setInput('requirementId', requirementId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('loads requirements for the selected System', async () => {
    const getBoard = vi.fn(() => of(board(card('1', 'Team ticket'))));
    const fixture = await create(getBoard);

    expect(getBoard).toHaveBeenCalledTimes(1);
    expect(getBoard).toHaveBeenCalledWith({ team: 'factory', application: 'factory/orders' }, undefined);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Board 1');
  });

  it('opens a routed ticket from the filtered board without another request', async () => {
    const getBoard = vi.fn(() => of(board(card('42', 'Matching ticket'))));
    const fixture = await create(getBoard, '42');

    expect(getBoard).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Selected 42');
  });

  it('resolves a production-shaped composite ID and its human-readable number', async () => {
    const productionCard = { ...card('ignored', 'Production ticket'), id: 'factory/orders#8421', number: 8421 };
    const getBoard = vi.fn(() => of(board(productionCard)));

    const byNumber = await create(getBoard, '8421');
    expect((byNumber.nativeElement as HTMLElement).textContent).toContain('Selected factory/orders#8421');
    byNumber.destroy();

    TestBed.resetTestingModule();
    const byCompositeId = await create(getBoard, 'factory/orders#8421');
    expect((byCompositeId.nativeElement as HTMLElement).textContent).toContain('Selected factory/orders#8421');
  });

  it('opens and closes routed detail from loaded columns without refetching the board', async () => {
    const getBoard = vi.fn(() => of(board(card('42', 'Matching ticket'))));
    const fixture = await create(getBoard);

    fixture.componentRef.setInput('requirementId', '42');
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Selected 42');

    fixture.componentRef.setInput('requirementId', undefined);
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Selected 42');
    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it('shows a routed ticket from the team board', async () => {
    const getBoard = vi.fn(() => of(board(card('1', 'Team ticket'), card('42', 'Deep-linked ticket'))));
    const fixture = await create(getBoard, '42');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(getBoard.mock.calls).toEqual([[{ team: 'factory', application: 'factory/orders' }, undefined]]);
    expect(text).toContain('Board 1');
    expect(text).toContain('Board 42');
    expect(text).toContain('Selected 42');
  });

  it('shows not found when the ticket is absent from the team board', async () => {
    const getBoard = vi.fn(() => of(board(card('2', 'Another ticket'))));
    const fixture = await create(getBoard, '42');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('board.ticketNotFound');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Selected 42');
  });

  it('clears a stale not-found error when the ticket route is resolved or left', async () => {
    const getBoard = vi.fn(() => of(board(card('42', 'Matching ticket'))));
    const fixture = await create(getBoard, 'missing');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('board.ticketNotFound');

    fixture.componentRef.setInput('requirementId', undefined);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Board 42');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('board.ticketNotFound');

    fixture.componentRef.setInput('requirementId', 'missing');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('requirementId', '42');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Selected 42');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('board.ticketNotFound');
    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it('shows a load error when the team board request fails', async () => {
    const getBoard = vi.fn(() => throwError(() => new Error('network error')));
    const fixture = await create(getBoard, '42');

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('board.errLoad');
  });
});
