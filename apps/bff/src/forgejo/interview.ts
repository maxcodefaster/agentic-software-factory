/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ForgejoClient, Issue, RequirementSpec } from "./client";
import {
  acceptedMarkerFragment,
  assigneeMarkerFragment,
  applicationIds,
  applicationMarker,
  findAccepted,
  findProposal,
  proposalMarkerFragment,
  teamMarkerFragment,
  visibleIssueBody,
} from "./client";
import { ApplicationError } from '../errors';

export interface InterviewOption {
  value: string;
  label: string;
  description: string | null;
}

export interface InterviewQuestion {
  id: string;
  header: string | null;
  prompt: string;
  type: 'single' | 'multi' | 'text';
  options: InterviewOption[];
  allowCustom: boolean;
  hint: string | null;
}

export interface InterviewAnswer {
  questionId: string;
  expectedVersion: number;
  selected: string[];
  customText: string;
}

export interface InterviewTurn {
  question: InterviewQuestion;
  answer: InterviewAnswer;
  answeredAt: string;
  answeredBy: string;
}

export interface PendingInterviewOperation {
  operationId: string;
  answer: InterviewAnswer;
  payload: string;
  previousQuestionId: string;
  expectedVersion: number;
  phase: 'answer' | 'proposal';
  createdAt: string;
  createdBy: string;
  failure?: InterviewOperationFailure;
}

export interface InterviewOperationFailure {
  message: string;
  retryable: boolean;
  failedAt: string;
}

export interface InterviewState {
  version: number;
  runId: string;
  chatId: string | null;
  teamId?: string;
  repository?: string;
  requirementNumber?: number;
  proposalNonce?: string;
  turns: InterviewTurn[];
  pending: InterviewQuestion | null;
  pendingOperation: PendingInterviewOperation | null;
  done: boolean;
  startedAt: string;
  startedBy: string;
  finishedAt?: string;
  finishedBy?: string;
  retakes: number;
}

export interface InterviewResponse {
  state: InterviewState;
  spec: RequirementSpec | null;
}

export const interviewMarker = "<!-- agentic-software-factory-interview:";

export async function getInterview(client: ForgejoClient, number: number, signal?: AbortSignal): Promise<InterviewResponse> {
  const issue = await client.getIssue(number, signal);
  let state: InterviewState;
  try {
    state = findInterview(issue.body);
  } catch {
    state = emptyInterviewState();
  }
  let spec: RequirementSpec | null = null;
  try {
    spec = findProposal(issue.body).specification;
  } catch {
    try {
      spec = findAccepted(issue.body).specification;
    } catch {}
  }
  if (spec !== null && state.pending === null && state.turns.length === 0) state.done = true;
  return { state, spec };
}

export async function beginInterview(
  client: ForgejoClient,
  number: number,
  actor: string,
  retake: boolean,
  binding: { runId: string; chatId: string; teamId: string; repository: string; proposalNonce: string },
  pending: InterviewQuestion,
  signal?: AbortSignal,
): Promise<InterviewState> {
  const issue = await client.getIssue(number, signal);
  let current = emptyInterviewState();
  try { current = findInterview(issue.body); } catch {}
  if (!retake && (current.pending !== null || current.done || current.turns.length > 0)) return current;
  validateAIQuestion(pending);
  if (!binding.runId.trim() || !binding.chatId.trim() || !binding.teamId.trim() || !binding.repository.trim() || !binding.proposalNonce.trim()) {
    throw workflowError("AI interview binding is incomplete");
  }
  const state: InterviewState = {
    version: 1,
    ...binding,
    requirementNumber: number,
    turns: [],
    pending,
    pendingOperation: null,
    done: false,
    startedAt: formatRFC3339(client.now()),
    startedBy: actor,
    retakes: current.retakes + (retake ? 1 : 0),
  };
  await storeInterview(client, issue, state, retake, signal);
  if (retake) await markSpecificationDraft(client, number, signal);
  await client.transition(number, "requirements", null, signal);
  return state;
}

export async function prepareInterviewAnswer(
  client: ForgejoClient,
  number: number,
  actor: string,
  answer: InterviewAnswer,
  payload: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<InterviewState> {
  const issue = await client.getIssue(number, signal);
  let state: InterviewState;
  try { state = findInterview(issue.body); } catch { throw new Error("no open interview question"); }
  assertAIInterview(state, number);
  if (state.pending === null) throw new Error("no open interview question");
  if (state.pendingOperation) {
    if (!sameAnswer(state.pendingOperation.answer, answer) || state.pendingOperation.payload !== payload) {
      throw workflowError("a different answer is already saved; retry the pending AI response");
    }
    return state;
  }
  if (answer.expectedVersion !== state.version || answer.questionId !== state.pending.id) {
    throw workflowError("interview changed; refresh before answering");
  }
  if (answer.selected.length === 0 && !answer.customText.trim()) throw new Error("an answer is required");
  validateAnswer(state.pending, answer);
  if (!operationId.trim() || !payload.trim()) throw new Error("interview operation is incomplete");
  state.pendingOperation = {
    operationId,
    answer,
    payload,
    previousQuestionId: state.pending.id,
    expectedVersion: state.version,
    phase: 'answer',
    createdAt: formatRFC3339(client.now()),
    createdBy: actor,
  };
  await storeInterview(client, issue, state, false, signal);
  return state;
}

export async function setInterviewOperationPhase(
  client: ForgejoClient,
  number: number,
  operationId: string,
  phase: PendingInterviewOperation['phase'],
  signal?: AbortSignal,
): Promise<InterviewState> {
  const issue = await client.getIssue(number, signal);
  let state: InterviewState;
  try { state = findInterview(issue.body); } catch { throw new Error("no pending interview operation"); }
  assertAIInterview(state, number);
  if (!state.pendingOperation || state.pendingOperation.operationId !== operationId) {
    throw workflowError("interview operation changed; refresh before retrying");
  }
  state.pendingOperation.phase = phase;
  await storeInterview(client, issue, state, false, signal);
  return state;
}

export async function setInterviewOperationFailure(
  client: ForgejoClient,
  number: number,
  operationId: string,
  failure: Omit<InterviewOperationFailure, 'failedAt'> | null,
  signal?: AbortSignal,
): Promise<InterviewState> {
  const issue = await client.getIssue(number, signal);
  let state: InterviewState;
  try { state = findInterview(issue.body); } catch { throw new Error("no pending interview operation"); }
  assertAIInterview(state, number);
  if (!state.pendingOperation || state.pendingOperation.operationId !== operationId) {
    throw workflowError("interview operation changed; refresh before retrying");
  }
  if (failure) state.pendingOperation.failure = { ...failure, failedAt: formatRFC3339(client.now()) };
  else delete state.pendingOperation.failure;
  await storeInterview(client, issue, state, false, signal);
  return state;
}

export async function completeInterviewAnswer(
  client: ForgejoClient,
  number: number,
  operationId: string,
  suppliedNext: InterviewQuestion | null,
  suppliedDone: boolean,
  signal?: AbortSignal,
): Promise<InterviewState> {
  const issue = await client.getIssue(number, signal);
  let state: InterviewState;
  try { state = findInterview(issue.body); } catch { throw new Error("no pending interview operation"); }
  assertAIInterview(state, number);
  const operation = state.pendingOperation;
  if (!operation || operation.operationId !== operationId || state.pending?.id !== operation.previousQuestionId
    || state.version !== operation.expectedVersion) {
    throw workflowError("interview operation changed; refresh before retrying");
  }
  if (suppliedNext) validateAIQuestion(suppliedNext);
  state.turns.push({ question: state.pending, answer: operation.answer, answeredAt: operation.createdAt, answeredBy: operation.createdBy });
  state.version += 1;
  state.pending = suppliedNext;
  state.done = suppliedDone;
  state.pendingOperation = null;
  if (state.done) {
    assertProposalMatchesRun(findProposal(issue.body), state, number);
    state.finishedAt = formatRFC3339(client.now());
    state.finishedBy = operation.createdBy;
  }
  await storeInterview(client, issue, state, false, signal);
  return state;
}

export async function recordInterviewRefinement(
  client: ForgejoClient,
  number: number,
  actor: string,
  note: string,
  next: InterviewQuestion | null,
  signal?: AbortSignal,
): Promise<InterviewState> {
  const issue = await client.getIssue(number, signal);
  let state: InterviewState;
  try { state = findInterview(issue.body); } catch { throw new Error("finish the interview before refining it"); }
  assertAIInterview(state, number);
  if (!state.done) throw workflowError("finish the AI interview before refining it");
  assertProposalMatchesRun(findProposal(issue.body), state, number);
  if (!note.trim()) throw new Error("a refinement note is required");
  if (!next) throw workflowError("Coder did not return a valid refinement question");
  validateAIQuestion(next);
  const refinement: InterviewQuestion = {
    id: `sharpen-note-${state.version}`,
    header: null,
    prompt: "What should be sharpened or extended?",
    type: "text",
    options: [],
    allowCustom: true,
    hint: null,
  };
  const answer: InterviewAnswer = { questionId: refinement.id, expectedVersion: state.version, selected: [], customText: note.trim() };
  state.turns.push({ question: refinement, answer, answeredAt: formatRFC3339(client.now()), answeredBy: actor });
  state.version += 1;
  state.pending = next;
  state.done = false;
  delete state.finishedAt;
  delete state.finishedBy;
  await storeInterview(client, issue, state, true, signal);
  await markSpecificationDraft(client, number, signal);
  return state;
}

export function findInterview(body: string): InterviewState {
  const start = body.lastIndexOf(interviewMarker);
  if (start < 0) throw new Error("interview not found");
  const remaining = body.slice(start + interviewMarker.length);
  const end = remaining.indexOf(" -->");
  if (end < 0) throw new Error("interview is malformed");
  try {
    const state = JSON.parse(base64UrlDecode(remaining.slice(0, end))) as InterviewState;
    if (!state || typeof state !== "object") throw new Error();
    if (!Array.isArray(state.turns)) state.turns = [];
    if (!state.pendingOperation) state.pendingOperation = null;
    return state;
  } catch {
    throw new Error("interview is malformed");
  }
}

export function interviewMarkerFragment(body: string): string {
  const start = body.lastIndexOf(`\n\n${interviewMarker}`);
  if (start < 0) return "";
  const end = body.indexOf(" -->", start);
  return end < 0 ? "" : body.slice(start, end + 4);
}

async function storeInterview(client: ForgejoClient, issue: Issue, state: InterviewState, clearProposal: boolean, signal?: AbortSignal): Promise<void> {
  const marker = `\n\n${interviewMarker}${base64UrlEncodeJson(state)} -->`;
  const proposal = clearProposal ? "" : proposalMarkerFragment(issue.body);
  const body = visibleIssueBody(issue.body) + teamMarkerFragment(issue.body) + applicationMarker(applicationIds(issue.body)) + assigneeMarkerFragment(issue.body) + marker + proposal + acceptedMarkerFragment(issue.body);
  await client.updateIssueBody(issue.number, body, signal);
}

async function markSpecificationDraft(client: ForgejoClient, number: number, signal?: AbortSignal): Promise<void> {
  const issue = await client.getIssue(number, signal);
  const labels = await client.ensureLabels(signal);
  const draft = labels.get("spec/draft");
  if (!draft) throw new Error('Forgejo did not return label "spec/draft"');
  const ids = (issue.labels ?? []).filter((label) => !label.name.startsWith("spec/")).map((label) => label.id);
  ids.push(draft.id);
  await client.replaceLabels(number, ids, signal);
}

function validateAnswer(questionValue: InterviewQuestion, answer: InterviewAnswer): void {
  const allowed = new Set(questionValue.options.map((candidate) => candidate.value));
  if (questionValue.type === "single" && answer.selected.length > 1) throw new Error("select only one answer");
  for (const selected of answer.selected) {
    if (!allowed.has(selected)) throw new Error(`unknown answer ${JSON.stringify(selected)}`);
  }
}

function sameAnswer(left: InterviewAnswer, right: InterviewAnswer): boolean {
  return left.questionId === right.questionId && left.expectedVersion === right.expectedVersion
    && left.customText === right.customText && left.selected.length === right.selected.length
    && left.selected.every((value, index) => value === right.selected[index]);
}

export function validateAIQuestion(value: InterviewQuestion): void {
  const options = value.options;
  if (!value.id.trim() || !value.prompt.trim() || value.type !== "single" || options.length < 2 || options.length > 4
    || options.some((candidate) => !candidate.value.trim() || !candidate.label.trim())
    || new Set(options.map((candidate) => candidate.value)).size !== options.length) {
    throw workflowError("Coder did not return a valid interview question");
  }
}

export function assertAIInterview(state: InterviewState, number: number): void {
  if (!state.runId?.trim() || !state.chatId?.trim() || !state.teamId?.trim() || !state.repository?.trim()
    || state.requirementNumber !== number || !state.proposalNonce?.trim()) {
    throw workflowError("a bound AI interview is required");
  }
}

export function assertProposalMatchesRun(
  proposal: { provenance?: { source?: string; teamId?: string; repository?: string; requirementNumber?: number; runId?: string; chatId?: string; proposalNonce?: string } },
  state: InterviewState,
  number: number,
): void {
  assertAIInterview(state, number);
  const provenance = proposal.provenance;
  if (provenance?.source !== "coder-ai" || provenance.teamId !== state.teamId || provenance.repository !== state.repository
    || provenance.requirementNumber !== number || provenance.runId !== state.runId || provenance.chatId !== state.chatId
    || provenance.proposalNonce !== state.proposalNonce) {
    throw workflowError("a proposal from the completed AI interview is required");
  }
}

function emptyInterviewState(): InterviewState {
  return { version: 0, runId: "", chatId: null, turns: [], pending: null, pendingOperation: null, done: false, startedAt: "", startedBy: "", retakes: 0 };
}

function workflowError(message: string): ApplicationError {
  return new ApplicationError('conflict', 409, message);
}

function formatRFC3339(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}

function base64UrlEncodeJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(standard);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
