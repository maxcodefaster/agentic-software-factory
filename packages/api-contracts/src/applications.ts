/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const workspaceAppSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  url: z.string(),
  health: z.enum(['healthy', 'initializing', 'unhealthy', 'disabled']),
}).strict();

export type WorkspaceApp = z.infer<typeof workspaceAppSchema>;

export const applicationSummarySchema = z.object({
  id: z.string(),
  team: z.string(),
  name: z.string(),
  description: z.string().default(''),
  status: z.string(),
  stagingPhase: z.enum(['pending', 'provisioning', 'healthy', 'retry-wait', 'failed', 'deleting']).optional(),
  stagingAttempts: z.number().int().nonnegative().optional(),
  stagingUpdating: z.boolean().optional(),
  healthy: z.boolean(),
  workspaceId: z.string().nullable(),
  workspaceUrl: z.string().nullable(),
  chatUrl: z.string().nullable(),
  ideUrl: z.string().nullable(),
  terminalUrl: z.string().nullable(),
  servicesUrl: z.string().nullable(),
  apps: z.array(workspaceAppSchema),
  declaredApps: z.array(z.object({ slug: z.string(), displayName: z.string() }).strict()),
  repositoryUrl: z.string().nullable(),
  releasesUrl: z.string().nullable(),
  newAgentUrl: z.string().nullable(),
}).strict();

export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

export const applicationsResponseSchema = z.object({
  applications: z.array(applicationSummarySchema),
}).strict();

export type ApplicationsResponse = z.infer<typeof applicationsResponseSchema>;

export const developerWorkspaceSchema = z.object({
  workspaceId: z.string(),
  workspaceUrl: z.string().nullable(),
  ideUrl: z.string().nullable(),
  terminalUrl: z.string().nullable(),
  servicesUrl: z.string().nullable(),
  apps: z.array(workspaceAppSchema),
});
export type DeveloperWorkspace = z.infer<typeof developerWorkspaceSchema>;

export const onboardingRepositorySchema = z.object({
  name: z.string(),
  fullName: z.string(),
  description: z.string(),
  defaultBranch: z.string(),
  repositoryUrl: z.string(),
});
export type OnboardingRepository = z.infer<typeof onboardingRepositorySchema>;

export const onboardingRepositoriesResponseSchema = z.object({
  repositories: z.array(onboardingRepositorySchema),
});
export type OnboardingRepositoriesResponse = z.infer<typeof onboardingRepositoriesResponseSchema>;

export const compatibilityIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export const onboardingPhaseSchema = z.enum(['validating', 'applying-access', 'applying-policy', 'creating-staging', 'ready', 'retry-wait', 'repair', 'failed', 'reassigning', 'reassigning-access', 'unregistering', 'removed']);
export type OnboardingPhase = z.infer<typeof onboardingPhaseSchema>;

export const onboardingAttemptSchema = z.object({
  systemId: z.string(),
  team: z.string(),
  repositoryOwner: z.string(),
  repositoryName: z.string(),
  phase: onboardingPhaseSchema,
  targetSha: z.string().nullable(),
  contractVersion: z.number().int().nullable(),
  compatibilityIssues: z.array(compatibilityIssueSchema),
  policyPlan: z.record(z.string(), z.unknown()).nullable(),
  lastError: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type OnboardingAttempt = z.infer<typeof onboardingAttemptSchema>;

export const onboardingAttemptsResponseSchema = z.object({
  attempts: z.array(onboardingAttemptSchema),
  loadErrors: z.array(z.object({ systemId: z.string(), error: z.string() })).default([]),
});
export type OnboardingAttemptsResponse = z.infer<typeof onboardingAttemptsResponseSchema>;

export const registerApplicationRequestSchema = z.object({
  repository: z.string().min(1),
  team: z.string().min(1),
}).strict();
export type RegisterApplicationRequest = z.infer<typeof registerApplicationRequestSchema>;

export const onboardedApplicationSchema = z.object({
  id: z.string(),
  team: z.string(),
  name: z.string(),
  description: z.string(),
  repositoryUrl: z.string(),
});
export type OnboardedApplication = z.infer<typeof onboardedApplicationSchema>;

export const remediationResponseSchema = z.object({
  pullNumber: z.number().int().positive(),
  pullUrl: z.string(),
  branch: z.string(),
}).strict();
export type RemediationResponse = z.infer<typeof remediationResponseSchema>;

export const developmentToolsSchema = z.object({
  claimsReady: z.boolean(),
  coderIdentity: z.boolean(),
  forgejoConnected: z.boolean(),
  forgejoUsername: z.string().nullable(),
  connectUrl: z.string().nullable(),
  ready: z.boolean(),
});
export type DevelopmentTools = z.infer<typeof developmentToolsSchema>;
