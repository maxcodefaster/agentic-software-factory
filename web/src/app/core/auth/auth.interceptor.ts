/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * HTTP interceptor placeholder.
 *
 * Authentication is cookie-based (set by the Factory BFF after its OIDC
 * authorization-code exchange), so we don't add an Authorization header here.
 * We do, however, ensure cookies are always sent with same-origin requests
 * and we attach an X-Requested-With header so the BFF can distinguish XHR
 * traffic from a browser top-level navigation (relevant for CSRF defence).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const cloned = req.clone({
    withCredentials: true,
    setHeaders: { 'X-Requested-With': 'agentic-software-factory-web' },
  });
  return next(cloned);
};
