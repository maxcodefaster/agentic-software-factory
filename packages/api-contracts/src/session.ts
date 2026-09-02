/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const factoryPersonaSchema = z.enum(['business', 'developer']);

export const factoryCapabilitiesSchema = z.object({
  boardRead: z.boolean(),
  requirementsCreate: z.boolean(),
  requirementsEdit: z.boolean(),
  requirementsClose: z.boolean(),
  requirementsMove: z.boolean(),
  requirementsInterview: z.boolean(),
  requirementsPropose: z.boolean(),
  requirementsAccept: z.boolean(),
  applicationsRead: z.boolean(),
  developerWorkspaceCreate: z.boolean(),
  implementationRead: z.boolean(),
  implementationStart: z.boolean(),
  implementationPrepare: z.boolean(),
  implementationReview: z.boolean(),
  implementationComplete: z.boolean(),
  monitoringRead: z.boolean(),
  applicationsManage: z.boolean(),
}).strict();

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  initials: z.string(),
  teams: z.array(z.string()),
  ownerTeams: z.array(z.string()),
  admin: z.boolean(),
  personas: z.array(factoryPersonaSchema),
  capabilities: factoryCapabilitiesSchema,
}).strict();

export const sessionResponseSchema = sessionUserSchema.nullable();

export type FactoryPersona = z.infer<typeof factoryPersonaSchema>;
export type FactoryCapabilities = z.infer<typeof factoryCapabilitiesSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
