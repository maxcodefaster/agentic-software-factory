/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { applicationsResponseSchema, type ApplicationSummary, type WorkspaceApp } from '../packages/api-contracts/src/applications';
import { implementationRunSchema, implementationRunsResponseSchema, type ImplementationPhase, type ImplementationRun } from '../packages/api-contracts/src/implementation';
import { requirementSpecSchema, type InterviewResponse, type InterviewState, type RequirementSpec } from '../packages/api-contracts/src/kanban';
import { establishCoderAccess } from './e2e-coder-sso';

const DEFAULT_FACTORY_URL = 'http://factory.localhost';
const DEFAULT_FORGEJO_URL = 'http://forgejo-factory.localhost';
const DEFAULT_SYSTEM_ID = 'factory/example';
const MAX_LIFECYCLE_MS = 30 * 60_000;
const POLL_MS = 3_000;
const REQUEST_MS = 120_000;

interface RequirementCard {
  number: number;
  updatedAt: string;
}

interface RequirementAcceptance {
  digest: string;
}

interface SessionProjection {
  teams: string[];
}

interface DevelopmentToolsProjection {
  coderIdentity: boolean;
  forgejoConnected: boolean;
  ready: boolean;
}

interface ForgejoPull {
  number: number;
  state: string;
  merged: boolean;
  merged_commit_id?: string | null;
  head: { ref: string; sha: string };
}

interface ForgejoStatus {
  context: string;
  status: string;
  target_url?: string;
}

interface ForgejoReview {
  state: string;
  commit_id: string;
}

class GateError extends Error {}

class FactorySession {
  private cookie = '';

  constructor(
    private readonly baseUrl: URL,
    private readonly origin: string,
    private readonly deadline: number,
  ) {}

  async login(email: string, password: string): Promise<void> {
    const loginDeadline = Math.min(this.deadline, Date.now() + 60_000);
    for (let attempt = 1; attempt <= 5 && Date.now() < loginDeadline; attempt += 1) {
      const response = await safeFetch(new URL('/sign-in/email', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: this.origin },
        body: JSON.stringify({ email, password }),
        redirect: 'manual',
      }, loginDeadline, 'Factory sign-in');
      if (response.status === 429) {
        const delay = retryAfterMs(response.headers.get('retry-after'));
        await response.body?.cancel();
        await boundedSleep(delay, loginDeadline, 'Factory sign-in remained rate limited');
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new GateError(`Factory sign-in returned HTTP ${response.status}`);
      }
      this.cookie = response.headers.getSetCookie().map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');
      await response.body?.cancel();
      if (!this.cookie) throw new GateError('Factory sign-in returned no session cookie');
      return;
    }
    throw new GateError('Factory sign-in remained rate limited after five attempts');
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.cookie) throw new GateError('Factory session is not authenticated');
    const method = init.method ?? 'GET';
    const attempts = method === 'GET' ? 5 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        response = await safeFetch(new URL(path, this.baseUrl), {
          ...init,
          headers: {
            cookie: this.cookie,
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...init.headers,
          },
          redirect: 'manual',
        }, this.deadline, `${method} ${routeName(path)}`);
      } catch (error) {
        if (attempt === attempts) throw error;
        await boundedSleep(POLL_MS, this.deadline, `${method} ${routeName(path)} remained unavailable`);
        continue;
      }
      if (response.ok) return response;
      const retryable = [502, 503, 504].includes(response.status);
      const status = response.status;
      await response.body?.cancel();
      if (!retryable || attempt === attempts) throw new GateError(`${method} ${routeName(path)} returned HTTP ${status}`);
      await boundedSleep(POLL_MS, this.deadline, `${method} ${routeName(path)} remained unavailable`);
    }
    throw new GateError(`${method} ${routeName(path)} remained unavailable`);
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    try {
      return await response.json() as T;
    } catch {
      throw new GateError(`${init.method ?? 'GET'} ${routeName(path)} returned invalid JSON`);
    }
  }
}

class ForgejoApi {
  constructor(
    private readonly baseUrl: URL,
    private readonly token: string,
    private readonly owner: string,
    private readonly repository: string,
    private readonly deadline: number,
  ) {}

  async json<T>(method: string, suffix: string, body?: unknown, deadline = this.deadline): Promise<T> {
    const response = await this.request(method, suffix, body, [200], deadline);
    try {
      return await response.json() as T;
    } catch {
      throw new GateError(`Forgejo ${method} ${routeName(suffix)} returned invalid JSON`);
    }
  }

  async request(method: string, suffix: string, body: unknown, expected: readonly number[], deadline = this.deadline): Promise<Response> {
    const path = `/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}${suffix}`;
    const response = await safeFetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `token ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }, deadline, `Forgejo ${method} ${routeName(suffix)}`);
    if (!expected.includes(response.status)) {
      await response.body?.cancel();
      throw new GateError(`Forgejo ${method} ${routeName(suffix)} returned HTTP ${response.status}`);
    }
    return response;
  }

  async bestEffort(method: string, suffix: string, body: unknown, expected: readonly number[]): Promise<void> {
    try {
      const response = await this.request(method, suffix, body, [...expected, 404], Date.now() + REQUEST_MS);
      await response.body?.cancel();
    } catch {
      // Cleanup must not replace the lifecycle failure.
    }
  }
}

async function runLifecycle(): Promise<void> {
  const adminPassword = requiredEnvironment('ADMIN_PASSWORD');
  const businessPassword = requiredEnvironment('BUSINESS_PASSWORD');
  const forgejoToken = requiredEnvironment('FORGEJO_TOKEN');
  const factoryUrl = checkedUrl(process.env.FACTORY_URL?.trim() || DEFAULT_FACTORY_URL, 'FACTORY_URL');
  const forgejoUrl = checkedUrl(process.env.FORGEJO_URL?.trim() || DEFAULT_FORGEJO_URL, 'FORGEJO_URL');
  const systemId = process.env.FACTORY_SYSTEM_ID?.trim() || DEFAULT_SYSTEM_ID;
  const { owner, repository } = systemParts(systemId);
  const deadline = Date.now() + MAX_LIFECYCLE_MS;
  const origin = process.env.FACTORY_ORIGIN?.trim() || factoryUrl.origin;
  const admin = new FactorySession(factoryUrl, origin, deadline);
  const business = new FactorySession(factoryUrl, origin, deadline);
  const forgejo = new ForgejoApi(forgejoUrl, forgejoToken, owner, repository, deadline);
  let requirementNumber: number | null = null;
  let run: ImplementationRun | null = null;
  let completed = false;

  try {
    await admin.login('developer@example.test', adminPassword);
    await business.login('business@example.test', businessPassword);

    await establishCoderAccess({ email: 'developer@example.test', password: adminPassword, forgejo: true });
    const tools = await admin.json<DevelopmentToolsProjection>('/api/v1/development-tools');
    if (!tools.coderIdentity || !tools.forgejoConnected || !tools.ready) {
      throw new GateError('Developer must authorize Forgejo in Coder before running the lifecycle gate');
    }

    const session = await admin.json<SessionProjection>('/api/v1/session');
    if (!Array.isArray(session.teams) || session.teams.some((team) => typeof team !== 'string' || !team)) {
      throw new GateError('Admin session returned invalid team scope');
    }
    let application: ApplicationSummary | undefined;
    for (const candidateTeam of session.teams) {
      const applications = applicationsResponseSchema.parse(await admin.json<unknown>(`/api/v1/applications?team=${encodeURIComponent(candidateTeam)}`));
      application = applications.applications.find((candidate) => candidate.id === systemId);
      if (application) break;
    }
    if (!application) throw new GateError(`System ${systemId} is not registered or visible`);
    const team = application.team;
    const scope = `team=${encodeURIComponent(team)}&application=${encodeURIComponent(systemId)}`;

    const nonce = crypto.randomUUID().slice(0, 12);
    const created = await admin.json<RequirementCard>(`/api/v1/requirements?${scope}`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Lifecycle documentation proof ${nonce}`,
        body: 'Add a small file at docs/lifecycle-proof.md containing the exact line "Lifecycle proof: complete". Do not change application behavior, architecture, dependencies, or existing source files.',
        team,
        applicationIds: [systemId],
      }),
    });
    assertRequirementCard(created);
    requirementNumber = created.number;
    emit({ stage: 'requirement', requirementNumber, systemId, status: 'created' });

    const moved = await admin.json<RequirementCard>(`/api/v1/requirements/${requirementNumber}/status?${scope}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'requirements', expectedUpdatedAt: created.updatedAt }),
    });
    assertRequirementCard(moved);

    const interviewPath = `/api/v1/requirements/${requirementNumber}/interview`;
    let interview = await admin.json<InterviewResponse>(`${interviewPath}/start?${scope}`, { method: 'POST', body: '{}' });
    assertInterview(interview, requirementNumber, team, systemId);
    const initialInterview = interview.state;
    const chatId = initialInterview.chatId!;

    for (let turn = 0; turn < 8 && !interview.state.done; turn += 1) {
      const question = interview.state.pending;
      if (!question || question.type !== 'single' || question.options.length < 2 || question.options.length > 4) {
        throw new GateError('Coder returned an invalid structured interview question');
      }
      const selected = question.options[0]?.value;
      if (!selected) throw new GateError('Coder interview question has no selectable option');
      const previousVersion = interview.state.version;
      await admin.request(`${interviewPath}?${scope}`, {
        method: 'POST',
        body: JSON.stringify({ questionId: question.id, expectedVersion: previousVersion, selected: [selected], customText: '' }),
      }).then((response) => response.body?.cancel());
      interview = await waitForInterviewTurn(admin, `${interviewPath}?${scope}`, previousVersion, deadline);
    }

    const specification = completedInterview(interview, initialInterview, requirementNumber, team, systemId);
    const interviewUrl = checkedAgentChatUrl(interview.agent?.chatUrl, chatId, 'interview Agent Chat URL');
    await probePublicUrl(interviewUrl, deadline, 'interview Agent Chat URL');
    const acceptance = await admin.json<RequirementAcceptance>(`/api/v1/requirements/${requirementNumber}/accept?${scope}`, {
      method: 'POST',
      body: JSON.stringify(specification),
    });
    if (!acceptance.digest) throw new GateError('Requirement acceptance returned no digest');
    emit({ stage: 'interview', requirementNumber, chatId, status: 'complete', hostname: interviewUrl.hostname });

    const startedResponse = await admin.request(`/api/v1/requirements/${requirementNumber}/implementation-runs?${scope}`, {
      method: 'POST',
      body: JSON.stringify({ applicationId: systemId }),
    });
    if (startedResponse.status !== 202) throw new GateError(`Implementation start returned HTTP ${startedResponse.status} instead of 202`);
    run = implementationRunSchema.parse(await startedResponse.json());
    assertInitialRun(run, requirementNumber, systemId, acceptance.digest);
    const initialHeadSha = run.headSha;
    run = await waitForReviewReady(admin, requirementNumber, scope, run, initialHeadSha, application, deadline);
    const contributorVerificationApps = run.verificationApps;
    const implementationChat = assertCoderHandoff(run.agentUrl, 'implementation Agent Chat URL');
    const ideTarget = assertCoderHandoff(run.ideUrl, 'ticket IDE URL');
    if (!`${ideTarget.hostname}${ideTarget.pathname}`.toLowerCase().includes('ticket-')) {
      throw new GateError('Contributor IDE URL is not bound to a ticket workspace');
    }
    emit({ stage: 'implementation', runId: run.id, phase: run.phase, headSha: run.headSha, hostname: implementationChat.hostname });

    let reviewerRun = await getRun(business, requirementNumber, scope, run.id);
    assertReviewerProjection(reviewerRun, contributorVerificationApps);
    reviewerRun = implementationRunSchema.parse(await business.json<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(run.id)}/review?${scope}`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', body: `Lifecycle gate approval for requirement ${requirementNumber}.` }),
    }));
    if (reviewerRun.phase !== 'ready-to-merge') throw new GateError(`Approval projected unexpected phase ${reviewerRun.phase}`);
    if (!reviewerRun.reviews.some((review) => review.state === 'approved' && review.commitSha === reviewerRun.headSha)) {
      throw new GateError('Approval is not bound to the reviewed head SHA');
    }
    emit({ stage: 'review', runId: reviewerRun.id, phase: reviewerRun.phase, status: 'approved' });

    const completionResponse = implementationRunSchema.parse(await business.json<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(run.id)}/complete?${scope}`, {
      method: 'POST',
      body: '{}',
    }));
    run = completionResponse.phase === 'done'
      ? completionResponse
      : await waitForDone(business, requirementNumber, scope, run.id, deadline);
    assertCompletedRun(run);
    await assertForgejoEvidence(forgejo, run);
    completed = true;
    emit({
      stage: 'lifecycle',
      requirementNumber,
      runId: run.id,
      pullNumber: run.pullNumber,
      phase: run.phase,
      mergedSha: run.mergedSha,
      status: 'complete',
      hostnames: uniqueHostnames([factoryUrl, forgejoUrl, interviewUrl, new URL(run.pullUrl)]),
    });
  } finally {
    if (requirementNumber !== null) {
      if (!completed) await cleanupFailedDelivery(forgejo, requirementNumber, run);
      await forgejo.bestEffort('PATCH', `/issues/${requirementNumber}`, { state: 'closed' }, [200, 201]);
    }
  }
}

async function waitForInterviewTurn(session: FactorySession, path: string, previousVersion: number, deadline: number): Promise<InterviewResponse> {
  while (Date.now() < deadline) {
    const interview = await session.json<InterviewResponse>(path);
    const failure = interview.state.pendingOperation?.failure;
    if (failure) throw new GateError(failure.retryable === false ? 'Coder interview reached a non-retryable blocker' : 'Coder interview operation failed');
    if (interview.state.done || (!interview.state.pendingOperation && interview.state.version > previousVersion)) return interview;
    await boundedSleep(1_000, deadline, 'Coder interview exceeded the lifecycle timeout');
  }
  throw new GateError('Coder interview exceeded the lifecycle timeout');
}

async function waitForReviewReady(
  session: FactorySession,
  requirementNumber: number,
  scope: string,
  initial: ImplementationRun,
  initialHeadSha: string,
  application: ApplicationSummary,
  deadline: number,
): Promise<ImplementationRun> {
  const seen = new Set<ImplementationPhase>([initial.phase]);
  let previousRank = phaseRank(initial.phase);
  let current = initial;
  while (Date.now() < deadline) {
    abortOnBlocker(current);
    const rank = phaseRank(current.phase);
    if (rank < previousRank) throw new GateError(`Implementation phase regressed from rank ${previousRank} to ${rank}`);
    previousRank = rank;
    seen.add(current.phase);
    if (current.phase === 'awaiting-review' && current.agentStatus === 'completed'
      && current.checks.every((check) => check.state === 'success')
      && current.verificationApps.every((app) => app.health === 'healthy')) break;
    await boundedSleep(POLL_MS, deadline, 'Implementation exceeded the lifecycle timeout');
    current = await getRun(session, requirementNumber, scope, initial.id);
  }
  if (current.phase !== 'awaiting-review') throw new GateError('Implementation did not reach review within 30 minutes');
  if (![...seen].some((phase) => phase === 'provisioning' || phase === 'agent-running') || seen.size < 2) {
    throw new GateError('Implementation did not expose a valid phase progression');
  }
  if (current.agentStartedHeadSha !== initialHeadSha || current.headSha === initialHeadSha) {
    throw new GateError('Implementation agent did not finish with a newly pushed head');
  }
  if (!current.agentUrl || !current.ideUrl) throw new GateError('Contributor projection is missing Agent Chat or IDE access');
  assertCoderHandoff(current.agentUrl, 'implementation Agent Chat URL');
  assertCoderHandoff(current.ideUrl, 'ticket IDE URL');
  if (application.declaredApps.length > 0 && current.developmentApps.length === 0) {
    throw new GateError('System declares URL apps but contributor projection has no development app');
  }
  const verification = current.checks.find((check) => check.context === 'factory/verification');
  if (!verification || verification.state !== 'success' || !verification.targetUrl) throw new GateError('Automatic verification check is not healthy for the pushed head');
  assertCoderHandoff(verification.targetUrl, 'verification check target');
  for (const app of current.verificationApps) assertHealthyWrappedApp(app, 'verification app');
  if (application.declaredApps.length > 0 && current.verificationApps.length === 0) {
    throw new GateError('System declares URL apps but automatic verification projection has no verification app');
  }
  return current;
}

async function waitForDone(session: FactorySession, requirementNumber: number, scope: string, runId: string, deadline: number): Promise<ImplementationRun> {
  while (Date.now() < deadline) {
    const current = await getRun(session, requirementNumber, scope, runId);
    abortOnBlocker(current);
    if (current.phase === 'done') return current;
    await boundedSleep(POLL_MS, deadline, 'Completion exceeded the lifecycle timeout');
  }
  throw new GateError('Completion did not finish within 30 minutes');
}

async function getRun(session: FactorySession, requirementNumber: number, scope: string, runId: string): Promise<ImplementationRun> {
  const response = implementationRunsResponseSchema.parse(await session.json<unknown>(`/api/v1/requirements/${requirementNumber}/implementation-runs?${scope}`));
  const run = response.runs.find((candidate) => candidate.id === runId);
  if (!run) throw new GateError(`Implementation run ${runId} is not visible`);
  return run;
}

function assertInitialRun(run: ImplementationRun, requirementNumber: number, systemId: string, acceptedDigest: string): void {
  if (run.requirementNumber !== requirementNumber || run.applicationId !== systemId || run.repository !== systemId) {
    throw new GateError('Initial implementation projection is bound to the wrong requirement or System');
  }
  if (run.acceptedDigest !== acceptedDigest) throw new GateError('Implementation run does not use the exact accepted specification');
  if (run.phase !== 'provisioning' && run.phase !== 'agent-running') {
    throw new GateError(`Initial 202 projection has unexpected phase ${run.phase}`);
  }
  if (!/^[0-9a-f]{40,64}$/.test(run.headSha) || run.pullNumber < 1) throw new GateError('Initial implementation projection has invalid Git evidence');
}

function assertReviewerProjection(run: ImplementationRun, contributorApps: readonly WorkspaceApp[]): void {
  if (run.isContributor) throw new GateError('Business reviewer is incorrectly marked as a contributor');
  if (run.workspaceUrl || run.agentUrl || run.ideUrl || run.developmentApps.length > 0) {
    throw new GateError('Business reviewer can see contributor-only development tools');
  }
  const expected = contributorApps.map((app) => `${app.slug}\n${app.url}`).sort();
  const actual = run.verificationApps.map((app) => `${app.slug}\n${app.url}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new GateError('Business reviewer cannot see the prepared verification apps');
  for (const app of run.verificationApps) assertHealthyWrappedApp(app, 'business verification app');
}

function assertCompletedRun(run: ImplementationRun): void {
  if (run.phase !== 'done' || !run.mergedSha || !/^[0-9a-f]{40,64}$/.test(run.mergedSha)) {
    throw new GateError('Completed projection has no durable merge SHA');
  }
  if (!run.completedAt || run.workspaceUrl || run.agentUrl || run.ideUrl || run.developmentApps.length || run.verificationApps.length) {
    throw new GateError('Completed projection retained a live workspace or app');
  }
  for (const context of ['factory/specification', 'factory/verification']) {
    if (!run.checks.some((check) => check.context === context && check.state === 'success')) {
      throw new GateError(`Completed projection is missing successful ${context} evidence`);
    }
  }
  if (!run.reviews.some((review) => review.state === 'approved' && review.commitSha === run.headSha)) {
    throw new GateError('Completed projection is missing exact-SHA approval evidence');
  }
}

async function assertForgejoEvidence(forgejo: ForgejoApi, run: ImplementationRun): Promise<void> {
  const pull = await forgejo.json<ForgejoPull>('GET', `/pulls/${run.pullNumber}`);
  if (!pull.merged || pull.head.sha !== run.headSha || (pull.merged_commit_id && pull.merged_commit_id !== run.mergedSha)) {
    throw new GateError('Forgejo pull request does not match completed merge evidence');
  }
  const statuses = await forgejo.json<ForgejoStatus[]>('GET', `/statuses/${encodeURIComponent(run.headSha)}?limit=100`);
  for (const context of ['factory/specification', 'factory/verification']) {
    if (!statuses.some((status) => status.context === context && status.status === 'success')) {
      throw new GateError(`Forgejo is missing successful ${context} evidence`);
    }
  }
  const reviews = await forgejo.json<ForgejoReview[]>('GET', `/pulls/${run.pullNumber}/reviews?limit=100`);
  if (!reviews.some((review) => review.state === 'APPROVED' && review.commit_id === run.headSha)) {
    throw new GateError('Forgejo is missing exact-SHA approval evidence');
  }
}

async function cleanupFailedDelivery(forgejo: ForgejoApi, requirementNumber: number, knownRun: ImplementationRun | null): Promise<void> {
  const prefix = `factory/requirement-${requirementNumber}-`;
  const cleanupDeadline = Date.now() + REQUEST_MS;
  let pulls: ForgejoPull[] = [];
  if (knownRun) {
    try {
      pulls = [await forgejo.json<ForgejoPull>('GET', `/pulls/${knownRun.pullNumber}`, undefined, cleanupDeadline)];
    } catch {
      pulls = [];
    }
  } else {
    try {
      pulls = (await forgejo.json<ForgejoPull[]>('GET', '/pulls?state=all&limit=50', undefined, cleanupDeadline)).filter((pull) => pull.head.ref.startsWith(prefix));
    } catch {
      return;
    }
  }
  for (const pull of pulls.filter((candidate) => candidate.head.ref.startsWith(prefix))) {
    if (!pull.merged && pull.state === 'open') await forgejo.bestEffort('PATCH', `/pulls/${pull.number}`, { state: 'closed' }, [200, 201]);
    if (!pull.merged) await forgejo.bestEffort('DELETE', `/branches/${encodeURIComponent(pull.head.ref)}`, undefined, [204]);
  }
}

function assertInterview(interview: InterviewResponse, number: number, team: string, repository: string): void {
  const state = interview.state;
  if (!state.runId || !state.chatId || !state.proposalNonce || state.requirementNumber !== number || state.teamId !== team || state.repository !== repository) {
    throw new GateError('Coder interview provenance is incomplete or incorrectly bound');
  }
  if (!state.pending || state.done) throw new GateError('Coder interview did not start with a question');
}

function completedInterview(interview: InterviewResponse, initial: InterviewState, number: number, team: string, repository: string): RequirementSpec {
  assertInterviewProvenance(interview.state, initial, number, team, repository);
  if (!interview.state.done || interview.state.pending || interview.state.pendingOperation || interview.state.turns.length < 1 || interview.state.turns.length > 8) {
    throw new GateError('Coder and MCP did not complete a bounded interview');
  }
  if (!interview.spec) throw new GateError('Completed interview returned no specification');
  requirementSpecSchema.parse(interview.spec);
  return interview.spec;
}

function assertInterviewProvenance(state: InterviewState, initial: InterviewState, number: number, team: string, repository: string): void {
  if (state.runId !== initial.runId || state.chatId !== initial.chatId || state.proposalNonce !== initial.proposalNonce
    || state.requirementNumber !== number || state.teamId !== team || state.repository !== repository) {
    throw new GateError('Completed interview lost its Coder and MCP provenance');
  }
}

function abortOnBlocker(run: ImplementationRun): void {
  if (run.phase === 'agent-failed' || run.agentStatus === 'failed') throw new GateError('Implementation agent reported failure');
  if (run.phase === 'checks-failing') throw new GateError('Implementation checks reported failure');
  if (run.blockers.some((blocker) => /repair|manual retry/i.test(blocker))) throw new GateError('Lifecycle reconciliation requires manual repair');
  if (run.phase === 'unplanned' || run.phase === 'changes-requested') throw new GateError(`Lifecycle entered blocked phase ${run.phase}`);
}

function phaseRank(phase: ImplementationPhase): number {
  const rank: Partial<Record<ImplementationPhase, number>> = {
    provisioning: 0,
    'agent-running': 1,
    implementing: 2,
    'awaiting-review': 3,
    'ready-to-merge': 4,
    merging: 5,
    done: 6,
  };
  return rank[phase] ?? -1;
}

function assertHealthyWrappedApp(app: WorkspaceApp, label: string): void {
  if (app.health !== 'healthy') throw new GateError(`${label} ${app.slug} is not healthy`);
  assertCoderHandoff(app.url, `${label} ${app.slug}`);
}

function assertCoderHandoff(value: string | null | undefined, label: string): URL {
  if (!value) throw new GateError(`${label} is missing`);
  const handoff = checkedUrl(value, label);
  if (handoff.pathname !== '/api/v2/users/oidc/callback') throw new GateError(`${label} is a raw app URL instead of a Coder handoff`);
  const redirect = handoff.searchParams.get('redirect');
  if (!redirect) throw new GateError(`${label} has no Coder redirect`);
  const target = new URL(redirect, handoff.origin);
  if (target.pathname === '/api/v2/applications/auth-redirect') {
    const application = target.searchParams.get('redirect_uri');
    if (!application) throw new GateError(`${label} has no wrapped application target`);
    return checkedUrl(application, `${label} target`);
  }
  return target;
}

function checkedAgentChatUrl(value: string | undefined, chatId: string, label: string): URL {
  if (!value) throw new GateError(`${label} is missing`);
  const url = checkedUrl(value, label);
  if (url.pathname !== `/agents/${encodeURIComponent(chatId)}`) throw new GateError(`${label} is not bound to its Coder chat`);
  return url;
}

async function probePublicUrl(url: URL, deadline: number, label: string): Promise<void> {
  const response = await safeFetch(url, { redirect: 'manual' }, deadline, label);
  await response.body?.cancel();
  if (response.status === 404 || response.status >= 500) throw new GateError(`${label} is not reachable, HTTP ${response.status}`);
}

function assertRequirementCard(value: RequirementCard): void {
  if (!Number.isInteger(value.number) || value.number < 1 || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new GateError('Requirement response is missing its number or update timestamp');
  }
}

async function safeFetch(url: URL, init: RequestInit, deadline: number, label: string): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new GateError('Lifecycle exceeded the 30 minute timeout');
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(Math.min(REQUEST_MS, remaining)),
      tls: { rejectUnauthorized: false },
    });
  } catch {
    throw new GateError(`${label} failed without an HTTP response`);
  }
}

function retryAfterMs(value: string | null): number {
  if (!value) return 1_000;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  return Math.max(250, Math.min(10_000, Number.isFinite(parsed) ? parsed : 1_000));
}

async function boundedSleep(ms: number, deadline: number, message: string): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new GateError(message);
  await Bun.sleep(Math.min(ms, remaining));
}

function requiredEnvironment(name: 'ADMIN_PASSWORD' | 'BUSINESS_PASSWORD' | 'FORGEJO_TOKEN'): string {
  const value = process.env[name];
  if (!value) throw new GateError(`${name} is required`);
  return value;
}

function checkedUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GateError(`${label} is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new GateError(`${label} is not a safe HTTP URL`);
  return url;
}

function systemParts(systemId: string): { owner: string; repository: string } {
  const parts = systemId.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new GateError('FACTORY_SYSTEM_ID must use owner/repository form');
  }
  return { owner: parts[0], repository: parts[1] };
}

function routeName(path: string): string {
  return path.split('?', 1)[0]!;
}

function uniqueHostnames(urls: readonly URL[]): string[] {
  return [...new Set(urls.map((url) => url.hostname))].sort();
}

function emit(value: Record<string, unknown>): void {
  console.log(JSON.stringify(value));
}

function validateOnly(): void {
  systemParts(DEFAULT_SYSTEM_ID);
  checkedUrl(DEFAULT_FACTORY_URL, 'default Factory URL');
  checkedUrl(DEFAULT_FORGEJO_URL, 'default Forgejo URL');
  emit({ stage: 'validation', systemId: DEFAULT_SYSTEM_ID, status: 'ok' });
}

if (import.meta.main) {
  try {
    if (Bun.argv.slice(2).includes('--validate')) validateOnly();
    else await runLifecycle();
  } catch (error) {
    console.error(`Lifecycle gate failed: ${error instanceof GateError ? error.message : 'unexpected internal error'}`);
    process.exitCode = 1;
  }
}
