/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { Identity, ProposalProvenance, RequestScope, RequirementSpec, ServerServices } from './types';
import { capabilitiesFor } from '../auth/authorization';

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});
const MAX_TEXT_LENGTH = 10_000;
const MAX_LIST_ITEMS = 100;
const MAX_LIST_ITEM_LENGTH = 2_000;
const string = (description: string) => ({ type: 'string' as const, minLength: 1, maxLength: MAX_TEXT_LENGTH, description });
const stringArray = (description: string) => ({
  type: 'array' as const,
  maxItems: MAX_LIST_ITEMS,
  items: { type: 'string' as const, maxLength: MAX_LIST_ITEM_LENGTH },
  description,
});

const requirementSpecProperties = {
  goal: string('Desired business outcome.'),
  users: stringArray('People or roles who need the outcome.'),
  userStories: stringArray('User stories derived from the interview.'),
  acceptanceCriteria: stringArray('Observable acceptance criteria.'),
  nonFunctionalRequirements: stringArray('Security, accessibility, performance, availability, and compliance constraints.'),
  moscow: object(
    {
      must: stringArray('Must-have scope.'),
      should: stringArray('Should-have scope.'),
      could: stringArray('Could-have scope.'),
    },
    ['must', 'should', 'could'],
  ),
  openQuestions: stringArray('Facts still requiring human resolution.'),
  nonGoals: stringArray('Explicit exclusions.'),
};

const provenanceProperties = {
  teamId: string('Factory team ID bound to the interview run.'),
  repository: string('Requirements repository bound to the interview run.'),
  requirementNumber: { type: 'integer' as const, minimum: 1, maximum: 2_147_483_647 },
  runId: string('Factory interview run ID.'),
  chatId: string('Coder Chat ID bound to the run.'),
  proposalNonce: string('Single-run proposal nonce.'),
};

const tools = [
  {
    name: 'requirements_propose',
    description:
      'Submit a typed draft after the Plan-mode interview. This never accepts the requirement; a human reviews, edits, and confirms it in Agentic Software Factory.',
    inputSchema: object(
      { ...provenanceProperties, ...requirementSpecProperties },
      [...Object.keys(provenanceProperties), ...Object.keys(requirementSpecProperties)],
    ),
  },
] as const;

function actor(identity: Identity): string {
  return identity.subject;
}

function scope(authInfo: AuthInfo): RequestScope {
  const identity = authInfo.extra?.['identity'] as Identity | undefined;
  if (!identity) throw new Error('MCP identity is missing');
  const signal = authInfo.extra?.['signal'];
  return { identity, signal: signal instanceof AbortSignal ? signal : new AbortController().signal, teams: [] };
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: string[]): boolean {
  return required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key));
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_LIST_ITEMS
    && value.every((item) => typeof item === 'string' && item.length <= MAX_LIST_ITEM_LENGTH);
}

function parseSpec(input: Record<string, unknown>): RequirementSpec | null {
  const moscow = input['moscow'];
  if (!isObject(moscow) || !exactKeys(moscow, ['must', 'should', 'could'])) return null;
  const listKeys = [
    'users',
    'userStories',
    'acceptanceCriteria',
    'nonFunctionalRequirements',
    'openQuestions',
    'nonGoals',
  ] as const;
  const goal = input['goal'];
  const users = input['users'];
  const userStories = input['userStories'];
  const acceptanceCriteria = input['acceptanceCriteria'];
  const nonFunctionalRequirements = input['nonFunctionalRequirements'];
  const openQuestions = input['openQuestions'];
  const nonGoals = input['nonGoals'];
  if (typeof goal !== 'string' || !listKeys.every((key) => stringList(input[key]))) return null;
  if (!stringList(moscow['must']) || !stringList(moscow['should']) || !stringList(moscow['could'])) return null;
  if (
    !stringList(users) ||
    !stringList(userStories) ||
    !stringList(acceptanceCriteria) ||
    !stringList(nonFunctionalRequirements) ||
    !stringList(openQuestions) ||
    !stringList(nonGoals) ||
    !goal.trim() || goal.length > MAX_TEXT_LENGTH ||
    acceptanceCriteria.length === 0
  ) return null;
  return {
    goal,
    users,
    userStories,
    acceptanceCriteria,
    nonFunctionalRequirements,
    moscow: { must: moscow['must'], should: moscow['should'], could: moscow['could'] },
    openQuestions,
    nonGoals,
  };
}

export function createMcpServer(services: ServerServices): Server {
  const server = new Server(
    { name: 'agentic-software-factory', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const identityScope = scope(extra.authInfo as AuthInfo);
    const input = isObject(request.params.arguments) ? request.params.arguments : {};
    try {
      switch (request.params.name) {
        case 'requirements_propose': {
          const allowed = capabilitiesFor(identityScope.identity, {
            admin: services.tenant.adminGroup,
            business: services.tenant.businessGroup,
            developer: services.tenant.developerGroup,
          }).requirementsPropose;
          if (!allowed) return errorResult('business persona required');
          const expected = [...Object.keys(provenanceProperties), ...Object.keys(requirementSpecProperties)];
          if (!exactKeys(input, expected) || !Number.isSafeInteger(input['requirementNumber'])
            || (input['requirementNumber'] as number) < 1 || (input['requirementNumber'] as number) > 2_147_483_647
            || !['teamId', 'repository', 'runId', 'chatId', 'proposalNonce'].every((key) => typeof input[key] === 'string' && (input[key] as string).trim())) return errorResult('invalid arguments');
          const spec = parseSpec(input);
          if (!spec) return errorResult('invalid arguments');
          const provenance: ProposalProvenance = {
            source: 'coder-ai',
            teamId: input['teamId'] as string,
            repository: input['repository'] as string,
            requirementNumber: input['requirementNumber'] as number,
            runId: input['runId'] as string,
            chatId: input['chatId'] as string,
            proposalNonce: input['proposalNonce'] as string,
          };
          const admin = identityScope.identity.groups?.includes(services.tenant.adminGroup) ?? false;
          identityScope.teams = services.tenant.teams
            .filter((team) => admin || team.group === null || identityScope.identity.groups?.includes(team.group))
            .map((team) => team.slug);
          if (!identityScope.teams.includes(provenance.teamId)) return errorResult('team board not found');
          identityScope.team = provenance.teamId;
          const application = await (services.applications.getRegistration?.(provenance.repository)
            ?? services.applications.get(provenance.repository));
          if (!application || application.team !== provenance.teamId) return errorResult('System was not found on this team');
          identityScope.repository = {
            owner: application.repositoryOwner,
            name: application.repositoryName,
            systemId: provenance.repository,
          };
          return result(await services.forgejo.propose(provenance.requirementNumber, actor(identityScope.identity), spec, provenance, identityScope));
        }
        default:
          return errorResult(`unknown tool '${request.params.name}'`);
      }
    } catch (error) {
      const safe = typeof error === 'object' && error && 'status' in error
        && typeof error.status === 'number' && error.status >= 400 && error.status < 500;
      return errorResult(safe && error instanceof Error ? error.message : 'tool request failed');
    }
  });
  return server;
}
