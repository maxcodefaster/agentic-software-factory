/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, Subject, of, throwError } from 'rxjs';

import type { ApplicationSummary, DeveloperWorkspace } from '@agentic-software-factory/api-contracts/applications';
import type { KanbanBoardPage, KanbanCard, KanbanColumn, KanbanColumnId } from '@agentic-software-factory/api-contracts/kanban';
import { ApplicationsClient } from '../../core/api/applications.client';
import { KanbanClient } from '../../core/api/kanban.client';
import { AuthService } from '../../core/auth/auth.service';
import { SystemContextService } from '../../core/system/system-context.service';
import { TeamContextService } from '../../core/team/team-context.service';
import { BoardStore } from './board.store';

const columnIds: KanbanColumnId[] = ['ideation', 'requirements', 'implementation', 'done'];
const orders = {
  id: 'orders', team: 'factory', name: 'Orders', description: '', repositoryUrl: null, releasesUrl: null,
  status: 'ready', healthy: true, workspaceId: null, workspaceUrl: null, chatUrl: null, ideUrl: null,
  terminalUrl: null, servicesUrl: null, apps: [], declaredApps: [], newAgentUrl: null,
} satisfies ApplicationSummary;

function card(number: number, column: KanbanColumnId = 'ideation'): KanbanCard {
  return {
    id: `orders#${number}`, number, systemId: 'orders', url: '', title: `Ticket ${number}`, description: '', column,
    teamSlug: 'factory', createdBy: 'alice', createdByEmail: 'alice@example.com', assignee: null, position: 0,
    meta: {}, applications: [], deliveryPhase: null, deliveryLabel: null, deliveryBlockers: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function board(...cards: KanbanCard[]): KanbanBoardPage {
  return {
    generatedAt: '2026-01-01T00:00:00Z', application: null,
    total: cards.length, truncated: false, nextCursor: null,
    columns: columnIds.map((id): KanbanColumn => ({ id, label: id, hint: '', cards: cards.filter((item) => item.column === id) })),
  };
}

describe('BoardStore', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels a stale board read when the route context changes', () => {
    const first = new Subject<KanbanBoardPage>();
    const second = new Subject<KanbanBoardPage>();
    const activeSystem = signal<ApplicationSummary | null>(orders);
    const getBoard = vi.fn((context: { application: string | null }) => context.application === 'orders' ? first : second);
    const store = configure({ getBoard }, {}, activeSystem);
    TestBed.flushEffects();

    activeSystem.set({ ...orders, id: 'billing', name: 'Billing' });
    TestBed.flushEffects();
    first.next(board(card(1)));
    expect(store.columns().flatMap((column) => column.cards)).toEqual([]);

    second.next(board(card(2)));
    expect(store.columns().flatMap((column) => column.cards).map((item) => item.number)).toEqual([2]);
  });

  it('cancels an in-flight later page when the route context changes', () => {
    const activeSystem = signal<ApplicationSummary | null>(orders);
    let laterPageCancelled = false;
    const laterPage = new Observable<KanbanBoardPage>(() => () => { laterPageCancelled = true; });
    const getBoard = vi.fn((context: { application: string | null }, cursor?: string) => {
      if (context.application === 'orders') {
        if (cursor) return laterPage;
        return of({ ...board(card(1)), total: 51, truncated: true, nextCursor: '2' });
      }
      return of(board({ ...card(2), systemId: 'billing' }));
    });
    const store = configure({ getBoard }, {}, activeSystem);
    TestBed.flushEffects();

    activeSystem.set({ ...orders, id: 'billing', name: 'Billing' });
    TestBed.flushEffects();

    expect(laterPageCancelled).toBe(true);
    expect(store.columns().flatMap((column) => column.cards).map((item) => item.number)).toEqual([2]);
  });

  it('rolls an optimistic move back when the command fails', () => {
    const original = board(card(1)).columns;
    const movedCard = card(1, 'requirements');
    const optimistic = board(movedCard).columns;
    const moveCard = vi.fn(() => throwError(() => ({ error: { error: 'Version conflict' } })));
    const store = configure({ getBoard: () => of({ ...board(), columns: original }), moveCard });
    TestBed.flushEffects();

    store.moveCard(card(1), 'requirements', optimistic);

    expect(store.columns()).toEqual(original);
    expect(store.notice()).toBe('Version conflict');
  });

  it('loads all cursor pages for a board with more than 200 cards', () => {
    const cards = Array.from({ length: 205 }, (_, index) => card(index + 1));
    const getBoard = vi.fn((_context: unknown, cursor?: string) => {
      const page = cursor ? Number(cursor) : 1;
      const start = (page - 1) * 50;
      const result = board(...cards.slice(start, start + 50));
      return of({
        ...result,
        total: cards.length,
        truncated: start + 50 < cards.length,
        nextCursor: start + 50 < cards.length ? String(page + 1) : null,
      });
    });

    const store = configure({ getBoard });
    TestBed.flushEffects();

    expect(store.columns().flatMap((column) => column.cards)).toHaveLength(205);
    expect(getBoard).toHaveBeenCalledTimes(5);
    expect(store.partialError()).toBeNull();
    expect(store.loadingMore()).toBe(false);
  });

  it('keeps loaded cards visible and retries the failed remainder', () => {
    let failSecondPage = true;
    const getBoard = vi.fn((_context: unknown, cursor?: string) => {
      if (cursor === '2' && failSecondPage) return throwError(() => new Error('upstream failed'));
      const result = board(...Array.from({ length: cursor ? 5 : 50 }, (_, index) => card((cursor ? 50 : 0) + index + 1)));
      return of({ ...result, total: 55, truncated: !cursor, nextCursor: cursor ? null : '2' });
    });
    const store = configure({ getBoard });
    TestBed.flushEffects();

    expect(store.columns().flatMap((column) => column.cards)).toHaveLength(50);
    expect(store.partialError()).toBe('board.partialError');

    failSecondPage = false;
    store.retry();

    expect(store.columns().flatMap((column) => column.cards)).toHaveLength(55);
    expect(getBoard).toHaveBeenLastCalledWith({ team: 'factory', application: 'orders' }, '2');
    expect(store.partialError()).toBeNull();
  });

  it('updates then moves the fresh card without overlapping detail commands', () => {
    const original = card(1);
    const updated = { ...original, updatedAt: '2026-01-02T00:00:00Z' };
    const updateResult = new Subject<KanbanCard>();
    const updateCard = vi.fn(() => updateResult);
    const moveCard = vi.fn(() => of({ ...updated, column: 'requirements' as const }));
    const store = configure({ getBoard: () => of(board(original)), updateCard, moveCard });
    TestBed.flushEffects();
    store.selectCard(original);

    const advance = { patch: { title: original.title, description: '', assignee: null }, toColumn: 'requirements' as const };
    store.advance(advance);
    store.advance(advance);
    expect(updateCard).toHaveBeenCalledOnce();
    expect(store.savingDetail()).toBe(true);

    updateResult.next(updated);
    updateResult.complete();
    expect(moveCard).toHaveBeenCalledWith({ team: 'factory', application: 'orders' }, updated, 'requirements');
    expect(store.savingDetail()).toBe(false);
  });

  it('updates then accepts an implementation specification without moving separately', () => {
    const original = card(1, 'requirements');
    const updated = { ...original, updatedAt: '2026-01-02T00:00:00Z' };
    const updateCard = vi.fn(() => of(updated));
    const accept = vi.fn(() => of({}));
    const moveCard = vi.fn();
    const store = configure({ getBoard: () => of(board(original)), updateCard, accept, moveCard });
    TestBed.flushEffects();
    store.selectCard(original);
    const specification = { goal: 'Ship', users: [], userStories: [], acceptanceCriteria: ['Works'], nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [] };

    store.advance({ patch: { title: original.title, description: '', assignee: null }, toColumn: 'implementation', specification });

    expect(accept).toHaveBeenCalledWith({ team: 'factory', application: 'orders' }, updated, specification);
    expect(moveCard).not.toHaveBeenCalled();
  });

  it('recovers the Forgejo authorization URL after workspace creation fails', () => {
    const createWorkspace = vi.fn(() => throwError(() => new Error('failed')));
    const developmentTools = vi.fn(() => of({ forgejoConnected: false, connectUrl: 'https://coder.example/connect' }));
    const store = configure({ getBoard: () => of(board()) }, { createWorkspace, developmentTools });
    TestBed.flushEffects();

    expect(store.openWorkspace(orders)).toBeNull();

    expect(store.workspaceBusy()).toBe(false);
    expect(store.workspaceError()).toBe('applications.developerWorkspaceError');
    expect(store.forgejoConnectUrl()).toBe('https://coder.example/connect');
  });
});

function configure(
  kanban: Record<string, unknown>,
  applications: Record<string, unknown> = {},
  activeSystem = signal<ApplicationSummary | null>(orders),
): BoardStore {
  TestBed.resetTestingModule();
  const activeTeam = signal<string | null>('factory');
  TestBed.configureTestingModule({
    providers: [
      BoardStore,
      { provide: KanbanClient, useValue: { createCard: vi.fn(), updateCard: vi.fn(), saveProposal: vi.fn(), accept: vi.fn(), moveCard: vi.fn(), deleteCard: vi.fn(), ...kanban } },
      { provide: ApplicationsClient, useValue: { createWorkspace: vi.fn(() => new Subject<DeveloperWorkspace>()), developmentTools: vi.fn(() => of(null)), retryStaging: vi.fn(), ...applications } },
      { provide: AuthService, useValue: {
        canCreateRequirements: () => true, canManageRequirements: () => true, canMoveRequirements: () => true,
        canCreateDeveloperWorkspace: () => true, canManageApplications: () => true,
        capabilities: () => ({ requirementsClose: true, requirementsPropose: true }),
      } },
      { provide: TeamContextService, useValue: { activeTeam } },
      { provide: SystemContextService, useValue: { activeSystem, loading: signal(false), refresh: vi.fn() } },
      { provide: TranslocoService, useValue: { translate: (key: string) => key } },
    ],
  });
  return TestBed.inject(BoardStore);
}
