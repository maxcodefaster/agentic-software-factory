/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { FactoryCapabilities, FactoryPersona } from '@agentic-software-factory/api-contracts/session';

import type { Identity } from '../server/types';

export type { FactoryCapabilities, FactoryPersona } from '@agentic-software-factory/api-contracts/session';

export interface PersonaGroups {
  admin: string;
  business: string;
  developer: string;
}

export function personasFor(identity: Identity, groups: PersonaGroups): FactoryPersona[] {
  const memberships = new Set(identity.groups ?? []);
  if (memberships.has(groups.admin)) return ['business', 'developer'];
  return (['business', 'developer'] as const).filter((persona) => memberships.has(groups[persona]));
}

export function capabilitiesFor(identity: Identity, groups: PersonaGroups): FactoryCapabilities {
  const personas = new Set(personasFor(identity, groups));
  const admin = new Set(identity.groups ?? []).has(groups.admin);
  const developer = admin || personas.has('developer');
  const business = admin || personas.has('business') || developer;
  return {
    boardRead: true,
    requirementsCreate: business,
    requirementsEdit: business,
    requirementsClose: business,
    requirementsMove: business,
    requirementsInterview: business,
    requirementsPropose: business,
    requirementsAccept: business,
    applicationsRead: true,
    developerWorkspaceCreate: developer,
    implementationRead: true,
    implementationStart: developer,
    implementationPrepare: business,
    implementationReview: business,
    implementationComplete: business,
    monitoringRead: true,
    applicationsManage: admin || developer,
  };
}
