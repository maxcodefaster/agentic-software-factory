/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { capabilitiesFor } from '../auth/authorization';
import { workspaceForApplication } from '../applications/catalog';
import { MAX_REQUIREMENTS_QUESTIONS } from '../integrations/coder/chat';
import {
  actor,
  errorResponse,
  listRegistrations,
  operationalLog,
  personaGroups,
  repositoryScope,
  systemId,
  visibleTeams,
} from './route-support';
import type { Identity, InterviewAnswer, InterviewBinding, InterviewQuestion, RequestScope, ServerServices } from './types';

function interviewAnswerText(question: InterviewQuestion, answer: InterviewAnswer): string {
  const values = answer.selected.map(
    (selected) => question.options.find((option) => option.value === selected)?.label ?? selected,
  );
  if (answer.customText.trim()) values.push(`Other: ${answer.customText.trim()}`);
  return values.join(', ');
}

async function interviewOperationId(state: import('./types').InterviewState, answer: InterviewAnswer): Promise<string> {
  const input = JSON.stringify([state.runId, state.version, state.pending?.id, answer]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return `turn_${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function startInterview(
  number: number,
  retake: boolean,
  request: Request,
  identity: Identity,
  services: ServerServices,
) {
  const scope = await repositoryScope(request, identity, services);
  const current = await services.forgejo.getInterview(number, scope).catch(() => null);
  if (!retake && current && (current.state.pending || current.state.done || current.state.turns.length > 0)) {
    try {
      interviewBinding(current.state, number);
    } catch {
      return errorResponse(409, 'legacy interview is read-only; start a new AI interview');
    }
    return { state: current.state };
  }
  const issue = await services.forgejo.getIssue(number, scope);
  const capability = await services.coder.chatCapability(scope);
  if (!capability.available) {
    operationalLog(services, { event: 'ai_interview_blocked', requirementNumber: number });
    return errorResponse(503, capability.reason || 'AI interview is unavailable');
  }
  const applicationId = issue.applications?.[0]?.id;
  const definitions = (await services.applications.list()).filter((item) => item.team === (issue.team ?? scope.team));
  const definition = definitions.find((item) => item.id === applicationId)
    ?? (definitions.length === 1 ? definitions[0] : undefined);
  const workspace = definition
    ? workspaceForApplication(definition, (await services.coder.summary(scope).catch(() => null))?.workspaces ?? [])
    : null;
  let chat: { chatId: string; question: InterviewQuestion | null };
  const binding = {
    teamId: issue.team ?? scope.team ?? '',
    repository: scope.repository?.systemId ?? '',
    requirementNumber: number,
    runId: `run_${crypto.randomUUID()}`,
    proposalNonce: crypto.randomUUID(),
  };
  if (!binding.teamId || !binding.repository) {
    operationalLog(services, { event: 'ai_interview_blocked', requirementNumber: number });
    return errorResponse(503, 'AI interview binding is not configured');
  }
  try {
    chat = await services.coder.startRequirementsChat(
      {
        number,
        title: issue.title,
        description: issue.body,
        applications: (issue.applications ?? []).map((application) => application.name),
        systemContext: definition?.systemContext ?? 'No application repository is selected.',
        ...binding,
        ...(workspace ? { workspaceId: workspace.id } : {}),
      },
      scope,
    );
    if (!chat.chatId.trim()) throw new Error('Coder returned an empty chat ID');
    if (!chat.question) throw new Error('Coder returned no interview question');
  } catch {
    operationalLog(services, { event: 'ai_interview_start_failed', requirementNumber: number });
    return errorResponse(503, 'AI interview could not be started');
  }
  return {
    state: await services.forgejo.beginInterview(
      number,
      actor(identity),
      retake,
      { ...binding, chatId: chat.chatId },
      chat.question,
      current?.state.version ?? 0,
      scope,
    ),
  };
}

export async function answerInterview(
  number: number,
  answer: InterviewAnswer,
  request: Request,
  identity: Identity,
  services: ServerServices,
  interviewOperations: InterviewOperationReconciler,
) {
  const scope = await repositoryScope(request, identity, services);
  const current = await services.forgejo.getInterview(number, scope).catch(() => null);
  if (!current?.state.chatId || !current.state.pending) {
    return errorResponse(409, 'a bound AI interview is required');
  }
  interviewBinding(current.state, number);
  const answerText = interviewAnswerText(current.state.pending, answer);
  const state = await services.forgejo.prepareInterviewAnswer(
    number,
    actor(identity),
    answer,
    answerText,
    current.state.pendingOperation?.operationId ?? await interviewOperationId(current.state, answer),
    scope,
  );
  const operation = state.pendingOperation;
  if (!operation) return errorResponse(409, 'interview operation changed; refresh before retrying');
  interviewOperations.schedule(number, state, scope.repository);
  return Response.json({ state }, { status: 202 });
}

export async function sharpenInterview(
  number: number,
  note: string,
  request: Request,
  identity: Identity,
  services: ServerServices,
) {
  const scope = await repositoryScope(request, identity, services);
  const current = await services.forgejo.getInterview(number, scope).catch(() => null);
  if (!current?.state.chatId || !current.state.done || !current.spec) return errorResponse(409, 'a completed AI interview proposal is required');
  interviewBinding(current.state, number);
  const previous = current.state.pending?.id ?? current.state.turns.at(-1)?.question.id ?? '';
  let next: InterviewQuestion | null;
  try {
    next = await services.coder.sharpenRequirementsChat(current.state.chatId, note, previous, scope);
  } catch {
    operationalLog(services, { event: 'ai_interview_sharpen_failed', requirementNumber: number });
    return errorResponse(503, 'AI refinement is unavailable');
  }
  if (!next) return errorResponse(503, 'AI refinement did not produce a question');
  return { state: await services.forgejo.recordInterviewRefinement(number, actor(identity), note, next, current.state.version, scope) };
}

function interviewBinding(state: import('./types').InterviewState, number: number): InterviewBinding {
  if (!state.teamId || !state.repository || state.requirementNumber !== number || !state.runId || !state.chatId || !state.proposalNonce) {
    throw Object.assign(new Error('a bound AI interview is required'), { status: 409 });
  }
  return {
    teamId: state.teamId,
    repository: state.repository,
    requirementNumber: number,
    runId: state.runId,
    chatId: state.chatId,
    proposalNonce: state.proposalNonce,
  };
}

export interface InterviewOperationReconciler {
  schedule(number: number, state: import('./types').InterviewState, repository?: RequestScope['repository']): void;
  reconcile(signal?: AbortSignal): Promise<void>;
}

const DEFAULT_REPOSITORIES_PER_CYCLE = 10;

export function createInterviewOperationReconciler(
  services: ServerServices,
  options: { repositoriesPerCycle?: number } = {},
): InterviewOperationReconciler {
  const workers = new Map<string, Promise<void>>();
  const repositoriesPerCycle = Math.max(1, options.repositoriesPerCycle ?? DEFAULT_REPOSITORIES_PER_CYCLE);
  let reconciling = false;
  let cursor: string | null = null;

  const schedule = (
    number: number,
    state: import('./types').InterviewState,
    repository?: RequestScope['repository'],
    signal?: AbortSignal,
  ): void => {
    const operation = state.pendingOperation;
    if (!operation) return;
    const key = `${number}:${operation.operationId}`;
    if (workers.has(key)) return;
    const process = () => processInterviewOperation(
      number,
      operation.operationId,
      operation.createdBy,
      state.teamId,
      state.repository,
      services,
      repository,
      signal,
    );
    const worker = (services.withInterviewOperationLock?.(key, process) ?? process())
      .catch(() => undefined)
      .finally(() => workers.delete(key));
    workers.set(key, worker);
  };

  return {
    schedule,
    async reconcile(signal) {
      if (reconciling) return;
      reconciling = true;
      try {
        const registrations = (await listRegistrations(services)).toSorted((left, right) =>
          systemId(left).localeCompare(systemId(right)));
        const previousCursor = cursor;
        const start = previousCursor === null ? 0 : Math.max(0, registrations.findIndex((registration) => systemId(registration) > previousCursor));
        const selected = Array.from({ length: Math.min(repositoriesPerCycle, registrations.length) }, (_, offset) =>
          registrations[(start + offset) % registrations.length]!);
        const scheduled: Promise<void>[] = [];
        for (const registration of selected) {
          if (signal?.aborted) return;
          cursor = systemId(registration);
          const repository = {
            team: registration.team,
            owner: registration.repositoryOwner,
            name: registration.repositoryName,
            systemId: systemId(registration),
          };
          try {
            for (const interview of await services.forgejo.reconcilableInterviews(repository, signal)) {
              schedule(interview.number, interview.state, repository, signal);
              const operationId = interview.state.pendingOperation?.operationId;
              const worker = operationId ? workers.get(`${interview.number}:${operationId}`) : undefined;
              if (worker) scheduled.push(worker);
            }
          } catch {
            operationalLog(services, { event: 'ai_interview_reconcile_failed' });
          }
        }
        await Promise.allSettled(scheduled);
      } finally {
        reconciling = false;
      }
    },
  };
}

async function processInterviewOperation(
  number: number,
  operationId: string,
  createdBy: string,
  savedTeam: string | undefined,
  savedRepository: string | undefined,
  services: ServerServices,
  repository?: RequestScope['repository'],
  signal?: AbortSignal,
): Promise<void> {
  let scope: RequestScope | undefined;
  let identity: Identity | null = null;
  try {
    identity = await services.identityByUserId?.(createdBy) ?? null;
    if (!identity || identity.subject !== createdBy || !identity.groups?.includes(services.tenant.group)) {
      throw Object.assign(new Error('the saved interview actor no longer has tenant access'), { retryable: false });
    }
    if (!capabilitiesFor(identity, personaGroups(services)).requirementsInterview) {
      throw Object.assign(new Error('business access is required to resume this interview'), { retryable: false });
    }
    const current = visibleTeams(identity, services);
    if (!savedTeam || !current.some((team) => team.slug === savedTeam)) {
      throw Object.assign(new Error('the saved interview actor no longer has access to this team'), { retryable: false });
    }
    if (!repository || savedRepository !== repository.systemId) {
      throw Object.assign(new Error('the saved interview repository is no longer registered'), { retryable: false });
    }
    scope = { identity, team: savedTeam, teams: current.map((team) => team.slug), signal: signal ?? new AbortController().signal, repository };
    const response = await services.forgejo.getInterview(number, scope);
    const operation = response.state.pendingOperation;
    if (!operation || operation.operationId !== operationId || operation.createdBy !== createdBy) return;
    const binding = interviewBinding(response.state, number);
    if (binding.teamId !== savedTeam || binding.repository !== savedRepository) {
      throw Object.assign(new Error('the saved interview repository is no longer registered'), { retryable: false });
    }
    const questionNumber = response.state.turns.length + 1;
    const next = operation.phase === 'proposal' ? null : await services.coder.answerRequirementsChat(
      binding.chatId, operation.previousQuestionId, operation.payload, questionNumber, operation.operationId, scope,
    );
    if (next !== null && questionNumber >= MAX_REQUIREMENTS_QUESTIONS) {
      throw Object.assign(new Error('Coder returned another interview question after the hard limit of eight'), { retryable: false });
    }
    const done = next === null;
    if (done) {
      if (operation.phase !== 'proposal') {
        await services.forgejo.setInterviewOperationPhase(number, operation.operationId, 'proposal', scope);
      }
      let submissionError: unknown;
      try {
        await services.coder.submitRequirementsProposal(binding, operation.operationId, scope);
      } catch (error) {
        submissionError = error;
      }
      try {
        await services.forgejo.getProposal(number, scope);
      } catch (error) {
        throw submissionError ?? error;
      }
    }
    await services.forgejo.completeInterviewAnswer(number, operation.operationId, done ? null : next, done, scope);
  } catch (error) {
    if (signal?.aborted) return;
    operationalLog(services, { event: 'ai_interview_answer_failed', requirementNumber: number });
    if (!scope) {
      if (!identity) return;
      const teams = visibleTeams(identity, services).map((team) => team.slug);
      scope = { identity, teams, signal: new AbortController().signal, ...(repository ? { repository } : {}) };
    }
    const retryable = !(typeof error === 'object' && error && 'retryable' in error && error.retryable === false);
    await services.forgejo.setInterviewOperationFailure(number, operationId, {
      message: retryable
        ? 'AI interview is blocked because Coder or MCP did not complete the turn'
        : error instanceof Error ? error.message : 'AI interview processing is blocked',
      retryable,
    }, scope).catch(() => undefined);
  }
}
