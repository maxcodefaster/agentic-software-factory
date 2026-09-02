/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';
import { workspaceAppSchema } from './applications';

export const implementationPhaseSchema = z.enum([
  'unplanned',
  'provisioning',
  'agent-running',
  'agent-failed',
  'implementing',
  'checks-failing',
  'awaiting-review',
  'changes-requested',
  'ready-to-merge',
  'merging',
  'done',
]);

export const implementationCheckSchema = z.object({
  context: z.string(),
  state: z.enum(['pending', 'success', 'failure', 'error', 'warning']),
  description: z.string(),
  targetUrl: z.string().nullable(),
}).strict();

export const implementationReviewSchema = z.object({
  id: z.number(),
  state: z.enum(['approved', 'changes-requested', 'commented']),
  body: z.string(),
  reviewer: z.string(),
  commitSha: z.string(),
  submittedAt: z.string(),
}).strict();

export const implementationRunSchema = z.object({
  id: z.string(),
  requirementNumber: z.number(),
  applicationId: z.string(),
  applicationName: z.string(),
  acceptedDigest: z.string(),
  repository: z.string(),
  repositoryUrl: z.string(),
  branch: z.string(),
  pullNumber: z.number(),
  pullUrl: z.string(),
  headSha: z.string(),
  mergedSha: z.string().nullable(),
  phase: implementationPhaseSchema,
  agentStatus: z.enum(['not-started', 'running', 'completed', 'failed']),
  agentError: z.string().nullable(),
  agentStartedHeadSha: z.string().nullable(),
  checks: z.array(implementationCheckSchema),
  reviews: z.array(implementationReviewSchema),
  blockers: z.array(z.string()),
  nextAction: z.string(),
  workspaceUrl: z.string().nullable(),
  workspaceId: z.string().nullable().optional(),
  workspaceStatus: z.string().nullable().optional(),
  agentUrl: z.string().nullable(),
  ideUrl: z.string().nullable(),
  developmentApps: z.array(workspaceAppSchema),
  verificationApps: z.array(workspaceAppSchema),
  isContributor: z.boolean(),
  canContinueBranch: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
}).strict();

export type ImplementationPhase = z.infer<typeof implementationPhaseSchema>;
export type ImplementationCheck = z.infer<typeof implementationCheckSchema>;
export type ImplementationReview = z.infer<typeof implementationReviewSchema>;
export type ImplementationRun = z.infer<typeof implementationRunSchema>;

export const implementationRunsResponseSchema = z.object({ runs: z.array(implementationRunSchema) }).strict();
export type ImplementationRunsResponse = z.infer<typeof implementationRunsResponseSchema>;
