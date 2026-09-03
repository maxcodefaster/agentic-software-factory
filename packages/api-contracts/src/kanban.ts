/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';
import { identifierSchema, isoInstantSchema } from './common';
import { implementationPhaseSchema } from './implementation';

export const kanbanColumnIdSchema = z.enum(['ideation', 'requirements', 'implementation', 'done']);
export type KanbanColumnId = z.infer<typeof kanbanColumnIdSchema>;

export const createRequirementBodySchema = z.object({
  title: z.string().min(1).max(256),
  body: z.string().min(1).max(100_000),
  team: identifierSchema.optional(),
  applicationIds: z.array(identifierSchema).length(1).optional(),
  assignee: identifierSchema.nullable().optional(),
}).strict();

export const updateRequirementBodySchema = z.object({
  title: z.string().max(256).optional(),
  body: z.string().max(100_000).optional(),
  assignee: identifierSchema.nullable().optional(),
  applicationIds: z.array(identifierSchema).length(1).optional(),
  expectedUpdatedAt: isoInstantSchema.optional(),
}).strict();

export const transitionRequirementBodySchema = z.object({
  status: kanbanColumnIdSchema,
  expectedUpdatedAt: isoInstantSchema.optional(),
}).strict();

const requirementSpecListItemSchema = z.string().max(2_000);
const requirementSpecListSchema = z.array(requirementSpecListItemSchema).max(100);

export const requirementSpecBodySchema = z.object({
  goal: z.string().min(1).max(10_000),
  users: requirementSpecListSchema,
  userStories: requirementSpecListSchema,
  acceptanceCriteria: requirementSpecListSchema.min(1),
  nonFunctionalRequirements: requirementSpecListSchema,
  moscow: z.object({
    must: requirementSpecListSchema,
    should: requirementSpecListSchema,
    could: requirementSpecListSchema,
  }).strict(),
  openQuestions: requirementSpecListSchema,
  nonGoals: requirementSpecListSchema,
}).strict();

export const answerInterviewBodySchema = z.object({
  questionId: identifierSchema,
  expectedVersion: z.number().int().nonnegative(),
  selected: z.array(identifierSchema).max(50),
  customText: z.string().max(10_000),
}).strict();

export const sharpenInterviewBodySchema = z.object({
  note: z.string().min(1).max(10_000),
}).strict();

export const applicationRefSchema = z.object({ id: z.string(), name: z.string() }).strict();
export type ApplicationRef = z.infer<typeof applicationRefSchema>;

export const interviewQuestionSchema = z.object({
  id: z.string(),
  header: z.string().nullable(),
  prompt: z.string(),
  type: z.enum(['single', 'multi', 'text']),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
    description: z.string().nullable(),
  }).strict()).default([]),
  allowCustom: z.boolean().default(true),
  hint: z.string().nullable(),
}).strict();
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

export const interviewAnswerSchema = z.object({
  questionId: z.string(),
  expectedVersion: z.number().int().nonnegative(),
  selected: z.array(z.string()).default([]),
  customText: z.string().default(''),
}).strict();
export type InterviewAnswer = z.infer<typeof interviewAnswerSchema>;

export const interviewTurnSchema = z.object({
  question: interviewQuestionSchema,
  answer: interviewAnswerSchema,
  answeredAt: z.string(),
  answeredBy: z.string(),
}).strict();
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;

export const pendingInterviewOperationSchema = z.object({
  operationId: z.string(),
  answer: interviewAnswerSchema,
  payload: z.string(),
  previousQuestionId: z.string(),
  expectedVersion: z.number().int().nonnegative(),
  phase: z.enum(['answer', 'proposal']),
  createdAt: z.string(),
  createdBy: z.string(),
  failure: z.object({
    message: z.string(),
    retryable: z.boolean(),
    failedAt: z.string(),
  }).strict().optional(),
}).strict();
export type PendingInterviewOperation = z.infer<typeof pendingInterviewOperationSchema>;

export const interviewStateSchema = z.object({
  version: z.number().int().nonnegative(),
  runId: z.string(),
  chatId: z.string().nullable(),
  teamId: z.string().optional(),
  repository: z.string().optional(),
  requirementNumber: z.number().int().optional(),
  proposalNonce: z.string().optional(),
  turns: z.array(interviewTurnSchema),
  pending: interviewQuestionSchema.nullable(),
  pendingOperation: pendingInterviewOperationSchema.nullable(),
  done: z.boolean(),
  startedAt: z.string(),
  startedBy: z.string(),
  finishedAt: z.string().optional(),
  finishedBy: z.string().optional(),
  retakes: z.number().int().nonnegative(),
}).strict();
export type InterviewState = z.infer<typeof interviewStateSchema>;

export const requirementSpecSchema = z.object({
  goal: z.string(),
  users: z.array(z.string()).default([]),
  userStories: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  nonFunctionalRequirements: z.array(z.string()).default([]),
  moscow: z.object({
    must: z.array(z.string()).default([]),
    should: z.array(z.string()).default([]),
    could: z.array(z.string()).default([]),
  }).strict(),
  openQuestions: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).default([]),
}).strict();
export type RequirementSpec = z.infer<typeof requirementSpecSchema>;

export const requirementProposalSchema = z.object({
  specification: requirementSpecSchema,
  proposedBy: z.string(),
  proposedAt: z.string(),
  provenance: z.object({
    source: z.literal('coder-ai'),
    teamId: z.string(),
    repository: z.string(),
    requirementNumber: z.number().int(),
    runId: z.string(),
    chatId: z.string(),
    proposalNonce: z.string(),
  }).strict().optional(),
}).strict();
export type RequirementProposal = z.infer<typeof requirementProposalSchema>;

export const requirementAcceptanceSchema = z.object({
  requirementId: z.string(),
  revision: z.string(),
  digest: z.string(),
  path: z.string(),
  commitSha: z.string(),
}).strict();
export type RequirementAcceptance = z.infer<typeof requirementAcceptanceSchema>;

export const interviewResponseSchema = z.object({
  state: interviewStateSchema,
  spec: requirementSpecSchema.nullable(),
  agent: z.object({
    available: z.boolean(),
    reason: z.string().optional(),
    chatUrl: z.string().optional(),
  }).strict().optional(),
}).strict();
export type InterviewResponse = z.infer<typeof interviewResponseSchema>;

export const interviewStateResponseSchema = z.object({ state: interviewStateSchema }).strict();

export const boardCardSchema = z.object({
  number: z.number().int().positive(),
  systemId: z.string().optional(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  status: kanbanColumnIdSchema,
  labels: z.array(z.string()),
  author: z.string(),
  assignee: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  team: z.string().optional(),
  applications: z.array(applicationRefSchema).optional(),
  proposal: requirementProposalSchema.optional(),
  acceptedSpecification: requirementSpecSchema.optional(),
  acceptance: requirementAcceptanceSchema.extend({
    acceptedAt: z.string(),
    acceptedBy: z.string(),
    specification: requirementSpecSchema,
  }).strict().optional(),
  interview: interviewStateSchema.optional(),
  deliveryPhase: implementationPhaseSchema.nullable().optional(),
  deliveryLabel: z.string().nullable().optional(),
  deliveryBlockers: z.array(z.string()).optional(),
}).strict();
export type BoardCard = z.infer<typeof boardCardSchema>;

export const boardResponseSchema = z.object({
  repository: z.string(),
  total: z.number().int().nonnegative().nullable().describe('Total open Forgejo issues, or null when Forgejo omits the count'),
  truncated: z.boolean(),
  nextCursor: z.string().min(1).nullable(),
  columns: z.object({
    ideation: z.array(boardCardSchema),
    requirements: z.array(boardCardSchema),
    implementation: z.array(boardCardSchema),
    done: z.array(boardCardSchema),
  }).strict(),
}).strict().refine(
  (response) => response.truncated === (response.nextCursor !== null),
  { message: 'truncated and nextCursor must describe the same page boundary' },
);
export type BoardResponse = z.infer<typeof boardResponseSchema>;

export const cardEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actor: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type CardEvent = z.infer<typeof cardEventSchema>;

export const cardEventsResponseSchema = z.object({ events: z.array(cardEventSchema) }).strict();

export const noContentResponseSchema = z.void();
