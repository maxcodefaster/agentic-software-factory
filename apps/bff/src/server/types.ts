/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { MonitoringResponse, WorkspaceKind } from '@agentic-software-factory/api-contracts/monitoring';

export interface Identity {
  issuer: string;
  subject: string;
  email?: string;
  name?: string;
  username?: string;
  emailVerified?: boolean;
  groups?: string[];
}

export interface RequestScope {
  identity: Identity;
  signal: AbortSignal;
  team?: string;
  teams?: readonly string[];
  repository?: { owner: string; name: string; systemId: string };
}

export interface RequirementSpec {
  goal: string;
  users: string[];
  userStories: string[];
  acceptanceCriteria: string[];
  nonFunctionalRequirements: string[];
  moscow: { must: string[]; should: string[]; could: string[] };
  openQuestions: string[];
  nonGoals: string[];
}

export interface InterviewQuestion {
  id: string;
  header: string | null;
  prompt: string;
  type: 'single' | 'multi' | 'text';
  options: Array<{ value: string; label: string; description: string | null }>;
  allowCustom: boolean;
  hint: string | null;
}

export interface InterviewState {
  version: number;
  runId: string;
  chatId?: string | null;
  teamId?: string;
  repository?: string;
  requirementNumber?: number;
  proposalNonce?: string;
  turns: Array<{ question: InterviewQuestion; answer: InterviewAnswer }>;
  pending?: InterviewQuestion | null;
  pendingOperation?: PendingInterviewOperation | null;
  done: boolean;
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
  failure?: { message: string; retryable: boolean; failedAt: string };
}

export interface InterviewAnswer {
  questionId: string;
  expectedVersion: number;
  selected: string[];
  customText: string;
}

export interface Card {
  number: number;
  title: string;
  body: string;
  status: string;
  updatedAt: string;
  team?: string;
  applications?: Array<{ id: string; name: string }>;
  acceptedSpecification?: RequirementSpec;
}

export interface Board {
  repository: string;
  total: number | null;
  truncated: boolean;
  nextCursor: string | null;
  columns: Record<string, Card[]>;
}

export interface UserDirectoryQuery {
  groups?: readonly string[];
  limit: number;
}

export interface Workspace {
  id: string;
  name: string;
  owner?: string;
  template: string;
  status: string;
  transition?: string;
  healthy: boolean;
  outdated?: boolean;
  lastUsedAt: string;
  url?: string | null;
  chatUrl?: string | null;
  ideUrl?: string | null;
  terminalUrl?: string | null;
  apps: Array<{ slug: string; displayName: string; url: string; health: 'healthy' | 'initializing' | 'unhealthy' | 'disabled' }>;
  parameters: Record<string, string>;
}

export interface WorkspaceSummary {
  count: number;
  workspaces: Workspace[];
  available: boolean;
}

export type { MonitoringResponse, WorkspaceKind };

export interface ForgejoService {
  ready(signal: AbortSignal): Promise<void>;
  board(scope: RequestScope, cursor?: string): Promise<Board>;
  createRequirement(input: { title: string; body: string; team: string }, scope: RequestScope): Promise<Card>;
  updateRequirement(
    number: number,
    input: {
      title?: string;
      body?: string;
      assignee?: string | null;
      applicationIds?: string[];
      expectedUpdatedAt?: string;
    },
    scope: RequestScope,
  ): Promise<Card>;
  closeRequirement(number: number, scope: RequestScope): Promise<void>;
  transition(
    number: number,
    status: string,
    expectedUpdatedAt: string | undefined,
    scope: RequestScope,
  ): Promise<Card>;
  accept(number: number, actor: string, spec: RequirementSpec, scope: RequestScope): Promise<unknown>;
  getProposal(number: number, scope: RequestScope): Promise<unknown>;
  propose(number: number, actor: string, spec: RequirementSpec, provenance: ProposalProvenance | undefined, scope: RequestScope): Promise<unknown>;
  getInterview(number: number, scope: RequestScope): Promise<{ state: InterviewState; spec: RequirementSpec | null }>;
  reconcilableInterviews(
    repository: { team: string; owner: string; name: string; systemId: string },
    signal?: AbortSignal,
  ): Promise<Array<{ number: number; state: InterviewState }>>;
  beginInterview(
    number: number,
    actor: string,
    retake: boolean,
    binding: InterviewBinding,
    pending: InterviewQuestion,
    scope: RequestScope,
  ): Promise<InterviewState>;
  prepareInterviewAnswer(
    number: number,
    actor: string,
    answer: InterviewAnswer,
    payload: string,
    operationId: string,
    scope: RequestScope,
  ): Promise<InterviewState>;
  setInterviewOperationPhase(
    number: number,
    operationId: string,
    phase: 'answer' | 'proposal',
    scope: RequestScope,
  ): Promise<InterviewState>;
  setInterviewOperationFailure(
    number: number,
    operationId: string,
    failure: { message: string; retryable: boolean } | null,
    scope: RequestScope,
  ): Promise<InterviewState>;
  completeInterviewAnswer(
    number: number,
    operationId: string,
    next: InterviewQuestion | null,
    done: boolean,
    scope: RequestScope,
  ): Promise<InterviewState>;
  recordInterviewRefinement(
    number: number,
    actor: string,
    note: string,
    next: InterviewQuestion,
    scope: RequestScope,
  ): Promise<InterviewState>;
  getIssue(number: number, scope: RequestScope): Promise<{ title: string; body: string; status: string; team?: string; applications?: Array<{ id: string; name: string }> }>;
  events(number: number, scope: RequestScope): Promise<unknown[]>;
}

export interface CoderService {
  summary(scope: RequestScope): Promise<WorkspaceSummary>;
  developerSummary(scope: RequestScope): Promise<WorkspaceSummary>;
  systemSummary(repositoryUrl: string, signal?: AbortSignal): Promise<WorkspaceSummary>;
  ensureDeveloperWorkspace(application: import('../applications/catalog').ApplicationDefinition, scope: RequestScope): Promise<Workspace>;
  developerWorkspaceById(application: import('../applications/catalog').ApplicationDefinition, workspaceId: string, scope: RequestScope): Promise<Workspace>;
  chatCapability(scope: RequestScope): Promise<{ available: boolean; reason?: string; chatUrl?: string }>;
  interviewReadiness(signal?: AbortSignal): Promise<{ available: boolean; reason?: string }>;
  startRequirementsChat(
    input: { number: number; title: string; description: string; applications: string[]; systemContext: string; workspaceId?: string } & Omit<InterviewBinding, 'chatId'>,
    scope: RequestScope,
  ): Promise<{ chatId: string; question: InterviewQuestion | null }>;
  answerRequirementsChat(
    chatId: string,
    previousQuestionId: string,
    answer: string,
    questionNumber: number,
    operationId: string,
    scope: RequestScope,
  ): Promise<InterviewQuestion | null>;
  sharpenRequirementsChat(
    chatId: string,
    note: string,
    previousQuestionId: string,
    scope: RequestScope,
  ): Promise<InterviewQuestion | null>;
  submitRequirementsProposal(binding: InterviewBinding, operationId: string, scope: RequestScope): Promise<void>;
  chatUrl(chatId: string): string;
  developmentTools(scope: RequestScope): Promise<{ coderIdentity: boolean; forgejoConnected: boolean; forgejoUsername: string | null; connectUrl: string }>;
}

export interface InterviewBinding {
  teamId: string;
  repository: string;
  requirementNumber: number;
  runId: string;
  chatId: string;
  proposalNonce: string;
}

export interface ProposalProvenance extends InterviewBinding {
  source: 'coder-ai';
}

export type AuthAction = 'logout';

export interface AuthService {
  readonly uiConfig: import('@agentic-software-factory/api-contracts/auth').AuthUiConfig;
  consentContext?(request: Request): Promise<import('@agentic-software-factory/api-contracts/auth').ConsentContext | null>;
  authenticate(request: Request): Promise<Identity | null>;
  authenticateMcp(request: Request): Promise<string | null>;
  handle(action: AuthAction, request: Request): Promise<Response>;
  ready?(): Promise<void>;
  handler?(request: Request): Promise<Response>;
  logoutBridgeRequest?(request: Request): Promise<Response>;
}

export interface ServerServices {
  forgejo: ForgejoService;
  coder: CoderService;
  auth: AuthService;
  authPublicOrigin: string;
  coderPublicUrl: string;
  allowedOrigins?: string[];
  trustedProxyCidrs?: string[];
  startedAt?: number;
  webRoot?: string;
  forgejoPublicUrl?: string;
  implementation?: import('../implementation/service').ImplementationService;
  applications: Pick<import('../applications/registry').ApplicationRegistry, 'list' | 'get'>
    & Partial<Pick<import('../applications/registry').ApplicationRegistry, 'listRegistrations' | 'getRegistration'>>;
  staging?: Pick<import('../applications/staging').StagingReconciler, 'snapshot' | 'reconcileById' | 'retry'>;
  listUsers(query: UserDirectoryQuery): Promise<import('@agentic-software-factory/api-contracts/users').UsersResponse>;
  applicationOnboarding?: {
    availableRepositories(teams?: readonly string[], signal?: AbortSignal): Promise<import('../applications/onboarding').OnboardingRepository[]>;
    attempts(): Promise<import('../applications/onboarding').OnboardingAttempt[]>;
    loadErrors(): Array<{ systemId: string; error: string }>;
    teamFor(repositoryIdentity: string): Promise<string | null>;
    canRegister(repositoryIdentity: string, teams: readonly string[], signal?: AbortSignal): Promise<boolean>;
    reconcileDue(signal?: AbortSignal): Promise<void>;
    register(repository: string, team: string, signal?: AbortSignal): Promise<import('../applications/catalog').ApplicationDefinition>;
    reassign(systemId: string, team: string, signal?: AbortSignal): Promise<import('../applications/catalog').ApplicationDefinition>;
    unregister(systemId: string, signal?: AbortSignal): Promise<void>;
    createRemediation(systemId: string, signal?: AbortSignal): Promise<{ pullNumber: number; pullUrl: string; branch: string }>;
  };
  tenant: { id: string; group: string; adminGroup: string; businessGroup: string; developerGroup: string; teams: Array<{ slug: string; displayName: string; group: string | null }> };
  identityByUserId?(factoryUserId: string): Promise<Identity | null>;
  databaseReady?(): Promise<void>;
  systemsReady?(): Promise<void>;
  systemsStatus?(): Promise<import('../applications/staging').SystemStatusSummary>;
  workspaceStartupSummary?(since: Date): Promise<Array<{ kind: string; cacheState: string; outcome: string; count: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }>>;
  measureWorkspaceStartup?<T>(input: { systemId: string; kind: 'developer' | 'ticket' | 'staging' | 'verification'; sha: string; contractVersion: number; cacheKey: string }, action: () => Promise<T>): Promise<T>;
  withInterviewOperationLock?(key: string, action: () => Promise<void>): Promise<void>;
  log?(entry: import('./boundary').RequestLog): void;
  rateLimits?: Partial<import('./boundary').RateLimitOptions>;
  trace?(span: import('../operations/tracing').HttpSpan): void;
}
