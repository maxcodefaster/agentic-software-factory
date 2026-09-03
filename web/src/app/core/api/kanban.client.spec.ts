/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';

import { KanbanClient } from './kanban.client';

const controllerCard = {
  number: 6, title: 'Lifecycle proof', body: 'Context', url: '', status: 'requirements', labels: [], author: 'alice',
  applications: [{ id: 'factory/example-application', name: 'Example Application' }],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
} as const;

describe('KanbanClient', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HttpClientTestingModule] }));

  it('maps the Forgejo board into the four-stage Factory board', () => {
    const client = TestBed.inject(KanbanClient);
    let result: unknown;
    client.getBoard({ team: 'factory', application: 'app-1' }).subscribe((board) => { result = board; });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/board?team=factory&application=app-1').flush({
      repository: 'factory/requirements',
      total: 2,
      truncated: false,
      nextCursor: null,
      columns: {
        ideation: [{ number: 1, title: 'Idea', body: 'Outcome', url: '', status: 'ideation', labels: [], author: 'alice', applications: [{ id: 'app-1', name: 'Orders' }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
        requirements: [{ number: 2, title: 'Reviewed', body: 'Outcome', url: '', status: 'requirements', labels: ['spec/proposed'], author: 'alice', applications: [], proposal: { proposedBy: 'coder#alice', proposedAt: '2026-01-01T00:00:00Z', specification: { goal: 'Reduce onboarding time', users: ['Engineer'], userStories: [], acceptanceCriteria: ['Workspace is ready'], nonFunctionalRequirements: [], moscow: { must: ['Guided onboarding'], should: [], could: [] }, openQuestions: [], nonGoals: [] } }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }], implementation: [], done: [],
      },
    });
    expect((result as { columns: Array<{ id: string; cards: unknown[] }> }).columns.map((column) => column.id)).toEqual(['ideation', 'requirements', 'implementation', 'done']);
    expect((result as { columns: Array<{ cards: Array<{ applications: unknown[] }> }> }).columns[0].cards[0].applications).toHaveLength(1);
    expect((result as { columns: Array<{ cards: Array<{ meta: Record<string, unknown> }> }> }).columns[1].cards[0].meta['specificationState']).toBe('proposed');
    expect((result as { columns: Array<{ cards: Array<{ meta: Record<string, unknown> }> }> }).columns[1].cards[0].meta['requirementSpec']).toBeTruthy();
  });

  it('rejects a malformed board response before adapting it', () => {
    const client = TestBed.inject(KanbanClient);
    let error: unknown;

    client.getBoard({ team: 'factory', application: 'app-1' }).subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/board?team=factory&application=app-1').flush({
      repository: 'factory/requirements',
      total: 0,
      truncated: false,
      nextCursor: null,
      columns: { ideation: [], requirements: [], implementation: [], done: 'closed' },
    });

    expect(error).toBeTruthy();
  });

  it.each([
    ['proposal', (client: KanbanClient, context: any, card: any, spec: any) => client.saveProposal(context, card, spec), '/proposal'],
    ['acceptance', (client: KanbanClient, context: any, card: any, spec: any) => client.accept(context, card, spec), '/accept'],
  ])('rejects a malformed %s response', (_kind, request, suffix) => {
    const client = TestBed.inject(KanbanClient);
    const context = { team: 'factory', application: 'factory/example-application' };
    const card = { ...controllerCard, id: 'factory/example-application#6', systemId: 'factory/example-application' };
    const specification = { goal: 'Proof', users: [], userStories: [], acceptanceCriteria: ['Exists'], nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [] };
    let error: unknown;

    (request(client, context, card, specification) as Observable<unknown>).subscribe({ error: (failure: unknown) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne(`/api/v1/requirements/6${suffix}?team=factory&application=factory/example-application`).flush({ digest: 7 });

    expect(error).toBeTruthy();
  });

  it('retains the scoped System across update, move, and acceptance responses', () => {
    const client = TestBed.inject(KanbanClient);
    const http = TestBed.inject(HttpTestingController);
    const card = {
      id: 'factory/example-application#6', number: 6, systemId: 'factory/example-application', url: '', title: 'Lifecycle proof', description: 'Context',
      column: 'ideation' as const, teamSlug: 'factory', createdBy: 'alice', createdByEmail: 'alice', assignee: null, position: 0, meta: {},
      applications: [{ id: 'factory/example-application', name: 'Example Application' }], deliveryPhase: null, deliveryLabel: null, deliveryBlockers: [],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    let updated: typeof card | undefined;
    const context = { team: 'factory', application: 'factory/example-application' };
    client.updateCard(context, card, { title: card.title }).subscribe((value) => { updated = value as typeof card; });
    http.expectOne('/api/v1/requirements/6?team=factory&application=factory/example-application').flush(controllerCard);
    expect(updated?.systemId).toBe(card.systemId);

    let moved: typeof card | undefined;
    client.moveCard(context, updated!, 'requirements').subscribe((value) => { moved = value as typeof card; });
    http.expectOne('/api/v1/requirements/6/status?team=factory&application=factory/example-application').flush(controllerCard);
    expect(moved?.systemId).toBe(card.systemId);

    client.accept(context, moved!, { goal: 'Proof', users: [], userStories: [], acceptanceCriteria: ['Exists'], nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [] }).subscribe();
    http.expectOne('/api/v1/requirements/6/accept?team=factory&application=factory/example-application').flush({
      requirementId: 'factory/requirements#6', revision: 'revision-1', digest: 'sha256:accepted',
      path: 'requirements/6.json', commitSha: '0123456789abcdef0123456789abcdef01234567',
    });
  });

  it('does not retarget a card request when its context changes after dispatch', () => {
    const client = TestBed.inject(KanbanClient);
    const http = TestBed.inject(HttpTestingController);
    const context: { team: string; application: string | null } = { team: 'operations', application: 'operations/orders' };

    client.getBoard(context).subscribe();
    context.team = 'factory';
    context.application = 'factory/billing';

    http.expectNone('/api/v1/board?team=factory&application=factory/billing');
    http.expectOne('/api/v1/board?team=operations&application=operations/orders').flush({
      repository: 'operations/requirements',
      total: 0,
      truncated: false,
      nextCursor: null,
      columns: { ideation: [], requirements: [], implementation: [], done: [] },
    });
  });

  it('requests an explicit board cursor without changing mutation URLs', () => {
    const client = TestBed.inject(KanbanClient);
    const http = TestBed.inject(HttpTestingController);

    client.getBoard({ team: 'factory', application: 'app-1' }, '5').subscribe();

    http.expectOne('/api/v1/board?team=factory&application=app-1&cursor=5').flush({
      repository: 'factory/requirements', total: 205, truncated: false, nextCursor: null,
      columns: { ideation: [], requirements: [], implementation: [], done: [] },
    });
  });
});
