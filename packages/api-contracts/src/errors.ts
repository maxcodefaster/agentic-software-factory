/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const applicationErrorCodeSchema = z.enum([
  'bad_request',
  'authentication_required',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable_entity',
  'dependency_failure',
  'internal_error',
]);

export const errorIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
}).strict();

export const errorResponseSchema = z.object({
  error: z.string(),
  code: applicationErrorCodeSchema.optional(),
  issues: z.array(errorIssueSchema).optional(),
}).strict();

export type ApplicationErrorCode = z.infer<typeof applicationErrorCodeSchema>;
export type ErrorIssue = z.infer<typeof errorIssueSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
