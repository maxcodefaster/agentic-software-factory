/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  boardCardSchema,
  boardResponseSchema,
  requirementAcceptanceSchema,
  requirementProposalSchema,
  type BoardCard,
  type KanbanColumnId,
  type RequirementAcceptance,
  type RequirementProposal,
  type RequirementSpec,
} from '@agentic-software-factory/api-contracts/kanban';
import type { FactoryRequestContext } from '../context/factory-context.store';
import { AgenticSoftwareFactoryAPIService } from '../../generated/api/factory-api';
import type { CreateCardInput, KanbanBoardPage, KanbanCard } from './kanban.types';

const columns: Array<{ id: KanbanColumnId; label: string; hint: string }> = [
  { id: 'ideation', label: 'Backlog', hint: 'Ideen vor der Klärung' },
  { id: 'requirements', label: 'Anforderungen', hint: 'Klärung und Bestätigung' },
  { id: 'implementation', label: 'Umsetzung', hint: 'Agent, Vorschau und Prüfung' },
  { id: 'done', label: 'Erledigt', hint: 'Geprüft und gemergt' },
];

@Injectable({ providedIn: 'root' })
export class KanbanClient {
  private readonly api = inject(AgenticSoftwareFactoryAPIService);

  getBoard(context: FactoryRequestContext, cursor?: string): Observable<KanbanBoardPage> {
    return this.api.getApiV1Board<unknown>({
      team: context.team,
      ...(context.application ? { application: context.application } : {}),
      ...(cursor ? { cursor } : {}),
    }).pipe(
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
    return this.api.postApiV1Requirements<unknown>({
      title: input.title,
      body: input.description ?? input.title,
      team: input.teamSlug,
      applicationIds: input.applicationIds ?? [],
      assignee: input.assignee ?? null,
    }, this.params(context)).pipe(
      map((response) => boardCardSchema.parse(response)),
      map((card) => this.card(card, context, 0)),
    );
  }

  moveCard(context: FactoryRequestContext, card: KanbanCard, column: KanbanColumnId): Observable<KanbanCard> {
    return this.api.patchApiV1RequirementsByNumberStatus<unknown>(encodeURIComponent(String(card.number)), {
      status: column,
      expectedUpdatedAt: card.updatedAt,
    }, this.params(context)).pipe(
      map((response) => boardCardSchema.parse(response)),
      map((updated) => this.card({ ...updated, systemId: updated.systemId ?? card.systemId }, context, card.position)),
    );
  }

  updateCard(context: FactoryRequestContext, card: KanbanCard, patch: Partial<Pick<KanbanCard, 'title' | 'description' | 'assignee' | 'applications'>>): Observable<KanbanCard> {
    return this.api.patchApiV1RequirementsByNumber<unknown>(encodeURIComponent(String(card.number)), {
      title: patch.title,
      body: patch.description,
      assignee: patch.assignee,
      applicationIds: patch.applications?.map((application) => application.id),
      expectedUpdatedAt: card.updatedAt,
    }, this.params(context)).pipe(
      map((response) => boardCardSchema.parse(response)),
      map((updated) => this.card({ ...updated, systemId: updated.systemId ?? card.systemId }, context, card.position)),
    );
  }

  deleteCard(context: FactoryRequestContext, card: KanbanCard): Observable<void> {
    return this.api.deleteApiV1RequirementsByNumber<void>(encodeURIComponent(String(card.number)), this.params(context));
  }

  saveProposal(context: FactoryRequestContext, card: KanbanCard, specification: RequirementSpec): Observable<RequirementProposal> {
    return this.api.putApiV1RequirementsByNumberProposal<unknown>(encodeURIComponent(String(card.number)), specification, this.params(context)).pipe(
      map((response) => requirementProposalSchema.parse(response)),
    );
  }

  accept(context: FactoryRequestContext, card: KanbanCard, specification: RequirementSpec): Observable<RequirementAcceptance> {
    return this.api.postApiV1RequirementsByNumberAccept<unknown>(encodeURIComponent(String(card.number)), specification, this.params(context)).pipe(
      map((response) => requirementAcceptanceSchema.parse(response)),
    );
  }

  private params(context: FactoryRequestContext): { team: string; application?: string } {
    return {
      team: context.team,
      ...(context.application ? { application: context.application } : {}),
    };
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
