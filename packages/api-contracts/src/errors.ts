/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const applicationErrorCodeSchema = z.enum([
  'bad_request',
  'payload_too_large',
  'rate_limited',
  'authentication_required',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable_entity',
  'dependency_failure',
  'service_unavailable',
  'internal_error',
]);

export const errorIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
}).strict();

export const errorResponseSchema = z.object({
  error: z.string(),
  code: applicationErrorCodeSchema,
  issues: z.array(errorIssueSchema).optional(),
}).strict();

export const apiErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  413: errorResponseSchema,
  422: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
  502: errorResponseSchema,
  503: errorResponseSchema,
} as const;

export function applicationErrorCodeForStatus(status: number): ApplicationErrorCode {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 422) return 'unprocessable_entity';
  if (status === 429) return 'rate_limited';
  if (status === 502) return 'dependency_failure';
  if (status === 503) return 'service_unavailable';
  return 'internal_error';
}

export type ApplicationErrorCode = z.infer<typeof applicationErrorCodeSchema>;
export type ErrorIssue = z.infer<typeof errorIssueSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
