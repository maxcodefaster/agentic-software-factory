/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

export const authUiConfigSchema = z.object({
  localEmailPassword: z.boolean(),
  organizationSignIn: z.boolean(),
  postLoginRedirect: z.string().startsWith('/'),
}).strict();

export type AuthUiConfig = z.infer<typeof authUiConfigSchema>;

export const consentContextSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1),
  scope: z.string(),
}).strict();

export type ConsentContext = z.infer<typeof consentContextSchema>;

export const authRedirectResponseSchema = z.object({
  url: z.string().nullable().optional(),
  redirect: z.boolean().optional(),
}).passthrough();

export const consentRedirectResponseSchema = z.object({
  url: z.string(),
  redirect: z.boolean().optional(),
}).passthrough();
