/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  assignmentUsersResponseSchema,
  type AssignmentUser,
  type AssignmentUsersResponse,
} from '@agentic-software-factory/api-contracts/users';
import type { FactoryRequestContext } from '../context/factory-context.store';
import { AgenticSoftwareFactoryAPIService } from '../../generated/api/factory-api';

export type { AssignmentUser };

@Injectable({ providedIn: 'root' })
export class UsersClient {
  private readonly api = inject(AgenticSoftwareFactoryAPIService);
  list(context: FactoryRequestContext): Observable<AssignmentUsersResponse> {
    return this.api.getApiV1Users<unknown>({ team: context.team }).pipe(
      map((response) => assignmentUsersResponseSchema.parse(response)),
    );
  }
}
