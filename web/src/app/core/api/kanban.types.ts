/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ImplementationPhase } from '@agentic-software-factory/api-contracts/implementation';
import type { ApplicationRef, KanbanColumnId } from '@agentic-software-factory/api-contracts/kanban';

export interface KanbanCard {
  id: string;
  number: number;
  systemId?: string;
  url: string;
  title: string;
  description: string;
  column: KanbanColumnId;
  teamSlug: string;
  createdBy: string;
  createdByEmail: string;
  assignee: string | null;
  position: number;
  meta: Record<string, unknown>;
  applications: ApplicationRef[];
  deliveryPhase: ImplementationPhase | null;
  deliveryLabel: string | null;
  deliveryBlockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: KanbanColumnId;
  label: string;
  hint: string;
  cards: KanbanCard[];
}

export interface KanbanBoard {
  generatedAt: string;
  columns: KanbanColumn[];
  application: ApplicationRef | null;
}

export interface KanbanBoardPage extends KanbanBoard {
  total: number | null;
  truncated: boolean;
  nextCursor: string | null;
}

export interface CreateCardInput {
  title: string;
  description?: string;
  column?: KanbanColumnId;
  teamSlug: string;
  applicationIds?: string[];
  assignee?: string | null;
}

export type * from '@agentic-software-factory/api-contracts/kanban';
