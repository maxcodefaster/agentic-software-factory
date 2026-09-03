/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const factoryUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
  initials: z.string(),
});

export const usersResponseSchema = z.object({ users: z.array(factoryUserSchema) });

export const assignmentUserSchema = factoryUserSchema.omit({ email: true }).strict();
export const assignmentUsersResponseSchema = z.object({ users: z.array(assignmentUserSchema) }).strict();

export const userDeprovisionResponseSchema = z.object({
  id: z.string(),
  status: z.literal('deprovisioned'),
  persisted: z.literal(true),
  coder: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('suspended'),
      revokedTokenCount: z.number().int().nonnegative().optional(),
    }).strict(),
    z.object({ status: z.literal('not-linked') }).strict(),
    z.object({ status: z.literal('pending') }).strict(),
  ]),
  forgejo: z.object({
    status: z.literal('requested'),
    immediate: z.boolean(),
  }).strict(),
}).strict();

export type FactoryUser = z.infer<typeof factoryUserSchema>;
export type UsersResponse = z.infer<typeof usersResponseSchema>;
export type AssignmentUser = z.infer<typeof assignmentUserSchema>;
export type AssignmentUsersResponse = z.infer<typeof assignmentUsersResponseSchema>;
export type UserDeprovisionResponse = z.infer<typeof userDeprovisionResponseSchema>;
