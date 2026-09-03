/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const identifierSchema = z.string().min(1).max(256);
export const issueNumberParamSchema = z.object({ number: z.string().regex(/^[1-9][0-9]*$/).max(10) }).strict();
export const runIdParamSchema = z.object({ id: identifierSchema }).strict();
export const applicationIdParamSchema = z.object({ id: identifierSchema }).strict();
export const applicationWorkspaceParamsSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
}).strict();
export const userIdParamSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9:_-]{1,255}$/) }).strict();

export const emptyBodySchema = z.object({}).strict();

export const requestContextQuerySchema = z.object({
  team: identifierSchema.optional(),
  application: identifierSchema.optional(),
}).strict();

export const boardQuerySchema = requestContextQuerySchema.extend({
  cursor: z.string().min(1).optional(),
}).strict();

export const isoInstantSchema = z.iso.datetime({ offset: true });

export type RequestContextQuery = z.infer<typeof requestContextQuerySchema>;
