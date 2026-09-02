/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const workspaceKindSchema = z.enum(['developer', 'verification']);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

export const monitoringWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  template: z.string(),
  status: z.string(),
  transition: z.string(),
  healthy: z.boolean(),
  outdated: z.boolean(),
  lastUsedAt: z.string(),
  kind: workspaceKindSchema,
});
export type MonitoringWorkspace = z.infer<typeof monitoringWorkspaceSchema>;

export const monitoringResponseSchema = z.object({
  generatedAt: z.string(),
  workspaces: z.object({
    available: z.boolean(),
    count: z.number().int().nonnegative(),
    workspaces: z.array(monitoringWorkspaceSchema),
  }),
  capabilities: z.record(z.string(), z.string()),
});
export type MonitoringResponse = z.infer<typeof monitoringResponseSchema>;
