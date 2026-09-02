/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  boardCardSchema,
  boardResponseSchema,
  requirementAcceptanceSchema,
  requirementProposalSchema,
  type BoardCard,
  type CreateCardInput,
  type KanbanBoardPage,
  type KanbanCard,
  type KanbanColumnId,
  type RequirementAcceptance,
  type RequirementProposal,
  type RequirementSpec,
} from '@agentic-software-factory/api-contracts/kanban';
import type { FactoryRequestContext } from '../context/factory-context.store';

const columns: Array<{ id: KanbanColumnId; label: string; hint: string }> = [
  { id: 'ideation', label: 'Backlog', hint: 'Ideen vor der Klärung' },
  { id: 'requirements', label: 'Anforderungen', hint: 'Klärung und Bestätigung' },
  { id: 'implementation', label: 'Umsetzung', hint: 'Agent, Vorschau und Prüfung' },
  { id: 'done', label: 'Erledigt', hint: 'Geprüft und gemergt' },
];

@Injectable({ providedIn: 'root' })
export class KanbanClient {
  private readonly http = inject(HttpClient);

  getBoard(context: FactoryRequestContext, cursor?: string): Observable<KanbanBoardPage> {
    const params = new URLSearchParams();
    params.set('team', context.team);
    if (context.application) params.set('application', context.application);
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    return this.http.get<unknown>(`/api/v1/board${query ? `?${query}` : ''}`).pipe(
      map((response) => boardResponseSchema.parse(response)),
      map((board) => ({
        generatedAt: new Date().toISOString(),
        application: null,
        total: board.total,
        truncated: board.truncated,
        nextCursor: board.nextCursor,
        columns: columns.map((column) => ({
          ...column,
          cards: (board.columns[column.id] ?? []).map((card, position) => this.card(card, context, position)),
        })),
      })),
    );
  }

  createCard(context: FactoryRequestContext, input: CreateCardInput): Observable<KanbanCard> {
    const application = context.application ? `&application=${encodeURIComponent(context.application)}` : '';
    return this.http.post<unknown>(`/api/v1/requirements?team=${encodeURIComponent(context.team)}${application}`, {
      title: input.title,
      body: input.description ?? input.title,
      team: input.teamSlug,
      applicationIds: input.applicationIds ?? [],
      assignee: input.assignee ?? null,
    }).pipe(
      map((response) => boardCardSchema.parse(response)),
      map((card) => this.card(card, context, 0)),
    );
  }

  moveCard(context: FactoryRequestContext, card: KanbanCard, column: KanbanColumnId): Observable<KanbanCard> {
    return this.http.patch<unknown>(this.requirement(context, card, '/status'), {
      status: column,
      expectedUpdatedAt: card.updatedAt,
    }).pipe(
      map((response) => boardCardSchema.parse(response)),
      map((updated) => this.card({ ...updated, systemId: updated.systemId ?? card.systemId }, context, card.position)),
    );
  }

  updateCard(context: FactoryRequestContext, card: KanbanCard, patch: Partial<Pick<KanbanCard, 'title' | 'description' | 'assignee' | 'applications'>>): Observable<KanbanCard> {
    return this.http.patch<unknown>(this.requirement(context, card), {
      title: patch.title,
      body: patch.description,
      assignee: patch.assignee,
      applicationIds: patch.applications?.map((application) => application.id),
      expectedUpdatedAt: card.updatedAt,
    }).pipe(
      map((response) => boardCardSchema.parse(response)),
      map((updated) => this.card({ ...updated, systemId: updated.systemId ?? card.systemId }, context, card.position)),
    );
  }

  deleteCard(context: FactoryRequestContext, card: KanbanCard): Observable<void> {
    return this.http.delete<void>(this.requirement(context, card));
  }

  saveProposal(context: FactoryRequestContext, card: KanbanCard, specification: RequirementSpec): Observable<RequirementProposal> {
    return this.http.put<unknown>(this.requirement(context, card, '/proposal'), specification).pipe(
      map((response) => requirementProposalSchema.parse(response)),
    );
  }

  accept(context: FactoryRequestContext, card: KanbanCard, specification: RequirementSpec): Observable<RequirementAcceptance> {
    return this.http.post<unknown>(this.requirement(context, card, '/accept'), specification).pipe(
      map((response) => requirementAcceptanceSchema.parse(response)),
    );
  }

  private requirement(context: FactoryRequestContext, card: KanbanCard, suffix = ''): string {
    return `/api/v1/requirements/${card.number}${suffix}?team=${encodeURIComponent(context.team)}${context.application ? `&application=${encodeURIComponent(context.application)}` : ''}`;
  }

  private card(card: BoardCard, context: FactoryRequestContext, position = 0): KanbanCard {
    return {
      id: `${card.systemId ?? ''}#${card.number}`,
      number: card.number,
      systemId: card.systemId ?? context.application ?? '',
      url: card.url,
      title: card.title,
      description: card.body,
      column: card.status,
      teamSlug: context.team,
      createdBy: card.author,
      createdByEmail: card.author,
      assignee: card.assignee ?? null,
      position,
      meta: {
        ...(card.proposal ? { proposal: card.proposal } : {}),
        ...(card.acceptance ? { acceptance: card.acceptance } : {}),
        ...(card.interview ? { interview: card.interview } : {}),
        ...((card.proposal?.specification ?? card.acceptedSpecification)
          ? { requirementSpec: card.proposal?.specification ?? card.acceptedSpecification }
          : {}),
        specificationState: card.proposal ? 'proposed' : card.acceptedSpecification ? 'accepted' : 'draft',
      },
      applications: card.applications ?? [],
      deliveryPhase: card.deliveryPhase ?? null,
      deliveryLabel: card.deliveryLabel ?? null,
      deliveryBlockers: card.deliveryBlockers ?? [],
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }
}
