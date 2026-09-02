/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

/**
 * Lean browser contracts for the Factory API.
 *
 * Modules are pure Zod so model-facing structured values and browser payloads
 * have one runtime-validatable definition.
 *
 * Consume domains through their subpaths to keep the Board and Applications
 * contracts independent.
 */

export * as applications from './applications';
export * as kanban from './kanban';
export * as implementation from './implementation';
export * as monitoring from './monitoring';
export * as users from './users';
export * as session from './session';
export * as errors from './errors';
export * as auth from './auth';
