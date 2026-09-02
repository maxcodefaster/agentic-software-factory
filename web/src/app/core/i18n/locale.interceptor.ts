/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { LocaleService } from './locale';

/**
 * Attach the active UI locale as `Accept-Language` so the BFF can localize
 * server-generated, user-facing strings (HTTP error messages) to the locale the
 * user actually picked in the app — overriding the browser default. Persisted,
 * re-rendered content is translated client-side from
 * keys instead, so it isn't affected by this header.
 */
export const localeInterceptor: HttpInterceptorFn = (req, next) => {
  const locale = inject(LocaleService).active();
  return next(req.clone({ setHeaders: { 'Accept-Language': locale } }));
};
