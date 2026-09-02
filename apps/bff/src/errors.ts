/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ApplicationErrorCode } from '@agentic-software-factory/api-contracts/errors';

export type { ApplicationErrorCode } from '@agentic-software-factory/api-contracts/errors';

export type SanitizedErrorCause =
  | { type: 'error'; name: string }
  | { type: 'upstream_http'; service: string; status: number; requestId?: string }
  | { type: 'upstream_timeout'; service: string; timeoutMs: number };

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    readonly status: number,
    message: string,
    readonly sanitizedCause?: SanitizedErrorCause,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationError';
  }
}
