/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { FactoryAuthService } from '../auth/service';
import { ForgejoClient, findTeam, toApplicationRefs, toCard } from '../forgejo/client';
import type { ChatQuestion, CoderClient } from '../integrations/coder';
import type {
  CoderService,
  ForgejoService,
  Identity,
  InterviewQuestion,
  ServerServices,
} from './types';
import type { ImplementationService } from '../implementation/service';
import type { ApplicationRegistry } from '../applications/registry';
import type { ApplicationOnboarding } from '../applications/onboarding';

function question(value: ChatQuestion | null): InterviewQuestion | null {
  if (!value) return null;
  return {
    id: value.id,
    header: value.header || null,
    prompt: value.prompt,
    type: value.options.length > 0 ? 'single' : 'text',
    options: value.options.map((option, index) => ({
      value: `option-${index}`,
      label: option.label,
      description: option.description || null,
    })),
    allowCustom: true,
    hint: null,
  };
}

function coderIdentity(identity: Identity) {
  if (!identity.email || !identity.username) throw new Error('Coder delegation requires email and username claims');
  return {
    issuer: identity.issuer,
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified ?? false,
    name: identity.name ?? identity.username,
    username: identity.username,
  };
}

export function adaptForgejo(
  client: ForgejoClient,
  defaultTeam: string,
  withRequirementWriteLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>,
): ForgejoService {
  const scoped = (scope: import('./types').RequestScope) => scope.repository
    ? client.forRepository(scope.repository.owner, scope.repository.name)
    : client;
  const access = async (number: number, scope: import('./types').RequestScope) => {
    const issue = await scoped(scope).getIssue(number, scope.signal);
    const team = findTeam(issue.body) ?? defaultTeam;
    if (!scope.teams?.includes(team) || (scope.team && team !== scope.team)) {
      throw Object.assign(new Error('requirement not found'), { status: 404 });
    }
    return issue;
  };
  const writeRequirement = <T>(number: number, scope: import('./types').RequestScope, action: () => Promise<T>) => {
    if (!withRequirementWriteLock) return action();
    const repository = scope.repository?.systemId ?? 'default';
    return withRequirementWriteLock(`requirement-write:${repository}:${number}`, action);
  };
  return {
    ready: (signal) => client.ready(signal),
    board: async (scope, cursor) => {
      const board = await scoped(scope).board(cursor, scope.signal);
      return {
        ...board,
        columns: Object.fromEntries(Object.entries(board.columns).map(([status, cards]) => [
          status,
          cards.filter((card) => (card.team ?? defaultTeam) === scope.team),
        ])),
      } as typeof board;
    },
    createRequirement: (input, scope) => scoped(scope).createRequirement(input.title, input.body, input.team, scope.signal),
    updateRequirement: (number, input, scope) => writeRequirement(number, scope, async () => {
      const current = await access(number, scope);
      const card = toCard(current);
      if ((card.acceptance || card.status === 'implementation' || card.status === 'done')
        && ((input.title !== undefined && input.title !== current.title)
          || (input.body !== undefined && input.body !== card.body))) {
        throw Object.assign(new Error('accepted requirements cannot be edited'), { status: 409 });
      }
      return scoped(scope).updateRequirement(
        number,
        input.title ?? current.title,
        input.body ?? '',
        input.applicationIds ?? toApplicationRefs(current.body).map((item) => item.id),
        input.assignee,
        input.expectedUpdatedAt,
        scope.signal,
      );
    }),
    closeRequirement: (number, scope) => writeRequirement(number, scope, async () => {
      const issue = await access(number, scope);
      const status = toCard(issue).status;
      if (status === 'implementation' || status === 'done') {
        throw Object.assign(new Error('requirements cannot be deleted after implementation starts'), { status: 409 });
      }
      return scoped(scope).closeRequirement(number, scope.signal);
    }),
    transition: (number, status, expectedUpdatedAt, scope) => writeRequirement(number, scope, async () => {
      const current = toCard(await access(number, scope)).status;
      const order = ['ideation', 'requirements', 'implementation', 'done'];
      if (order.indexOf(status) < order.indexOf(current)) {
        throw Object.assign(new Error('requirements cannot move backward'), { status: 409 });
      }
      return scoped(scope).transition(number, status, expectedUpdatedAt, scope.signal);
    }),
    accept: (number, actor, spec, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).accept(number, actor, spec, scope.signal);
    }),
    getProposal: async (number, scope) => { await access(number, scope); return scoped(scope).getProposal(number, scope.signal); },
    propose: (number, actor, spec, provenance, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).propose(number, actor, spec, provenance, scope.signal);
    }),
    getInterview: async (number, scope) => { await access(number, scope); return scoped(scope).getInterview(number, scope.signal); },
    reconcilableInterviews: async (repository, signal) => {
      const interviews = await client.forRepository(repository.owner, repository.name).reconcilableInterviews(signal);
      return interviews.filter(({ number, state }) => state.teamId === repository.team
        && state.repository === repository.systemId && state.requirementNumber === number);
    },
    beginInterview: (number, actor, retake, binding, pending, expectedVersion, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).beginInterview(number, actor, retake, binding, pending, expectedVersion, scope.signal);
    }),
    prepareInterviewAnswer: (number, actor, answer, payload, operationId, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).prepareInterviewAnswer(number, actor, answer, payload, operationId, scope.signal);
    }),
    setInterviewOperationPhase: (number, operationId, phase, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).setInterviewOperationPhase(number, operationId, phase, scope.signal);
    }),
    setInterviewOperationFailure: (number, operationId, failure, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).setInterviewOperationFailure(number, operationId, failure, scope.signal);
    }),
    completeInterviewAnswer: (number, operationId, next, done, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).completeInterviewAnswer(number, operationId, next, done, scope.signal);
    }),
    recordInterviewRefinement: (number, actor, note, next, expectedVersion, scope) => writeRequirement(number, scope, async () => {
      await access(number, scope);
      return scoped(scope).recordInterviewRefinement(number, actor, note, next, expectedVersion, scope.signal);
    }),
    getIssue: async (number, scope) => {
      const issue = await access(number, scope);
      const card = toCard(issue);
      return { title: issue.title, body: card.body, status: card.status, team: card.team, applications: card.applications };
    },
    events: async (number, scope) => { await access(number, scope); return scoped(scope).events(number, scope.signal); },
  };
}

export function adaptCoder(client: CoderClient, config: { template: string; workspaceNamespace: string }): CoderService {
  return {
    summary: (scope) => client.summaryForIdentity(coderIdentity(scope.identity), scope.signal),
    developerSummary: (scope) => client.summaryForIdentity(coderIdentity(scope.identity), scope.signal, true),
    ensureDeveloperWorkspace: (application, scope) => client.ensureDeveloperWorkspaceFor(coderIdentity(scope.identity), {
      repositoryUrl: application.cloneUrl,
      defaultBranch: application.defaultBranch,
      templateName: config.template,
      workspaceNamespace: config.workspaceNamespace,
    }, scope.signal),
    developerWorkspaceById: (application, workspaceId, scope) => client.developerWorkspaceByIdFor(coderIdentity(scope.identity), workspaceId, {
      repositoryUrl: application.cloneUrl,
      repositoryRef: application.defaultSha,
      templateName: config.template,
      workspaceNamespace: config.workspaceNamespace,
    }, scope.signal),
    chatCapability: (scope) => client.interviewCapabilityFor(coderIdentity(scope.identity), scope.signal),
    interviewReadiness: (signal) => client.chatCapability(signal),
    startRequirementsChat: async (input, scope) => {
      const result = await client.startRequirementsChatFor(coderIdentity(scope.identity), input, scope.signal);
      return { chatId: result.chatId, question: question(result.question) };
    },
    answerRequirementsChat: async (chatId, previousQuestionId, answer, questionNumber, operationId, scope) =>
      question(await client.answerRequirementsChatFor(coderIdentity(scope.identity), chatId, previousQuestionId, answer, questionNumber, operationId, scope.signal)),
    sharpenRequirementsChat: async (chatId, note, previousQuestionId, scope) =>
      question(await client.sharpenRequirementsChatFor(coderIdentity(scope.identity), chatId, note, previousQuestionId, scope.signal)),
    submitRequirementsProposal: (binding, operationId, scope) => client.submitRequirementsProposalFor(coderIdentity(scope.identity), binding, operationId, scope.signal),
    chatUrl: (chatId) => client.chatUrl(chatId),
    developmentTools: (scope) => client.developmentToolsFor(coderIdentity(scope.identity), scope.signal),
  };
}

export function createServerServices(input: {
  auth: FactoryAuthService;
  authPublicOrigin: string;
  forgejo: ForgejoClient;
  coder: CoderClient;
  coderPublicUrl: string;
  coderTemplate: string;
  workspaceNamespace: string;
  allowedOrigins?: string[];
  trustedProxyCidrs?: string[];
  rateLimits?: ServerServices['rateLimits'];
  webRoot?: string;
  forgejoPublicUrl?: string;
  implementation?: ImplementationService;
  applications: ApplicationRegistry;
  staging?: import('../applications/staging').StagingReconciler;
  listUsers: (query: import('./types').UserDirectoryQuery) => Promise<import('@agentic-software-factory/api-contracts/users').UsersResponse>;
  deprovisionUser?: ServerServices['deprovisionUser'];
  applicationOnboarding?: ApplicationOnboarding;
  tenant: { id: string; group: string; adminGroup: string; businessGroup: string; developerGroup: string; teams: Array<{ slug: string; displayName: string; group: string | null }> };
  identityByUserId?: (factoryUserId: string) => Promise<Identity | null>;
  databaseReady?: () => Promise<void>;
  systemsReady?: () => Promise<void>;
  systemsStatus?: () => Promise<import('../applications/staging').SystemStatusSummary>;
  workspaceStartupSummary?: ServerServices['workspaceStartupSummary'];
  measureWorkspaceStartup?: ServerServices['measureWorkspaceStartup'];
  trace?: ServerServices['trace'];
  withInterviewOperationLock?: (key: string, action: () => Promise<void>) => Promise<void>;
  withRequirementWriteLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
}): ServerServices {
  return {
    auth: input.auth,
    authPublicOrigin: input.authPublicOrigin,
    forgejo: adaptForgejo(input.forgejo, input.tenant.id, input.withRequirementWriteLock),
    coder: adaptCoder(input.coder, { template: input.coderTemplate, workspaceNamespace: input.workspaceNamespace }),
    coderPublicUrl: input.coderPublicUrl,
    ...(input.allowedOrigins ? { allowedOrigins: input.allowedOrigins } : {}),
    ...(input.trustedProxyCidrs ? { trustedProxyCidrs: input.trustedProxyCidrs } : {}),
    ...(input.rateLimits ? { rateLimits: input.rateLimits } : {}),
    ...(input.webRoot ? { webRoot: input.webRoot } : {}),
    ...(input.forgejoPublicUrl ? { forgejoPublicUrl: input.forgejoPublicUrl } : {}),
    ...(input.implementation ? { implementation: input.implementation } : {}),
    applications: input.applications,
    ...(input.staging ? { staging: input.staging } : {}),
    listUsers: input.listUsers,
    ...(input.deprovisionUser ? { deprovisionUser: input.deprovisionUser } : {}),
    ...(input.applicationOnboarding ? { applicationOnboarding: input.applicationOnboarding } : {}),
    tenant: input.tenant,
    ...(input.identityByUserId ? { identityByUserId: input.identityByUserId } : {}),
    ...(input.databaseReady ? { databaseReady: input.databaseReady } : {}),
    ...(input.systemsReady ? { systemsReady: input.systemsReady } : {}),
    ...(input.systemsStatus ? { systemsStatus: input.systemsStatus } : {}),
    ...(input.workspaceStartupSummary ? { workspaceStartupSummary: input.workspaceStartupSummary } : {}),
    ...(input.measureWorkspaceStartup ? { measureWorkspaceStartup: input.measureWorkspaceStartup } : {}),
    ...(input.trace ? { trace: input.trace } : {}),
    ...(input.withInterviewOperationLock ? { withInterviewOperationLock: input.withInterviewOperationLock } : {}),
  };
}
