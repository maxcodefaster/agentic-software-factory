/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import {
  beginInterview,
  completeInterviewAnswer,
  findInterview,
  getInterview,
  interviewMarker,
  interviewMarkerFragment,
  prepareInterviewAnswer,
  recordInterviewRefinement,
  setInterviewOperationFailure,
  setInterviewOperationPhase,
  assertAIInterview,
  assertProposalMatchesRun,
  type InterviewAnswer,
  type InterviewQuestion,
  type InterviewResponse,
  type InterviewState,
} from "./interview";
import { events, type CardEvent } from "./events";
import { fetchUpstream, isUpstreamStatus, upstreamHttpError } from "../integrations/fetch";
import { GitBranchSynchronizer, type GitSynchronizationResult } from '../implementation/git-sync';
import { ApplicationError } from '../errors';
import { z } from 'zod';
import type {
  ApplicationRef,
  RequirementAcceptance as AcceptanceResult,
  RequirementProposal as Proposal,
  RequirementSpec,
} from '@agentic-software-factory/api-contracts/kanban';

export const statuses = ["ideation", "requirements", "implementation", "done"] as const;
export const BOARD_PAGE_SIZE = 50;
export type Status = (typeof statuses)[number];
export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface Label {
  id: number;
  name: string;
  color: string;
  description?: string;
  exclusive: boolean;
}

export interface User {
  login: string;
  full_name: string;
  avatar_url: string;
}

interface Team {
  id: number;
  name: string;
  permission?: string;
  includes_all_repositories?: boolean;
  can_create_org_repo?: boolean;
  units_map?: Record<string, string>;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  html_url: string;
  state: string;
  labels: Label[];
  assignee?: User | null;
  user: User;
  created_at: string;
  updated_at: string;
}

export type { ApplicationRef, AcceptanceResult, Proposal, RequirementSpec };
export type ProposalProvenance = NonNullable<Proposal['provenance']>;

export interface AcceptanceMetadata extends AcceptanceResult {
  acceptedAt: string;
  acceptedBy: string;
  specification: RequirementSpec;
}

export interface Card {
  number: number;
  title: string;
  body: string;
  url: string;
  status: Status;
  labels: string[];
  author: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  team?: string;
  applications: ApplicationRef[];
  proposal?: Proposal;
  acceptedSpecification?: RequirementSpec;
  acceptance?: AcceptanceMetadata;
  interview?: InterviewState;
}

export interface Board {
  repository: string;
  total: number | null;
  truncated: boolean;
  nextCursor: string | null;
  columns: Record<Status, Card[]>;
}

export interface PullRequest {
  number: number;
  state: string;
  title: string;
  body: string;
  html_url: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean;
  merged_commit_id?: string | null;
  merge_base?: string | null;
  head: { label: string; ref: string; sha: string };
  base: { label: string; ref: string; sha: string };
}

export interface CommitStatus {
  id: number;
  context: string;
  status: "pending" | "success" | "failure" | "error" | "warning";
  description: string;
  target_url: string;
  created_at: string;
}

export interface PullReview {
  id: number;
  state: string;
  body: string;
  commit_id: string;
  user: User;
  submitted_at: string;
}

export interface RepositoryCommit {
  sha: string;
  parents: Array<{ sha: string }>;
}

interface BranchProtection {
  status_check_contexts?: string[];
  required_approvals?: number;
  enable_push_whitelist?: boolean;
  push_whitelist_usernames?: string[];
  push_whitelist_teams?: string[];
  push_whitelist_deploy_keys?: boolean;
  enable_merge_whitelist?: boolean;
  merge_whitelist_usernames?: string[];
  merge_whitelist_teams?: string[];
  enable_approvals_whitelist?: boolean;
  approvals_whitelist_username?: string[];
  approvals_whitelist_teams?: string[];
}

export interface Repository {
  name: string;
  full_name: string;
  description: string;
  private: boolean;
  template: boolean;
  default_branch: string;
  html_url: string;
}

const repositorySchema = z.object({
  name: z.string(), full_name: z.string(), description: z.string(), private: z.boolean(), template: z.boolean(),
  default_branch: z.string(), html_url: z.string(),
}).passthrough();
const authenticatedUserSchema = z.object({ login: z.string() }).passthrough();

export interface ClientOptions {
  fetch?: Fetch;
  now?: () => Date;
  timeoutMs?: number;
}

function readTeamBody(name: string): object {
  return {
    name,
    description: "Agentic Software Factory team users with read access to this team's registered repositories",
    permission: "read",
    includes_all_repositories: false,
    can_create_org_repo: false,
    units: ["repo.code", "repo.issues", "repo.pulls", "repo.releases"],
  };
}

const acceptedProjectionMarker = "<!-- agentic-software-factory-accepted:";
const proposalMarker = "<!-- agentic-software-factory-proposal:";
const applicationsMarker = "<!-- agentic-software-factory-applications:";
const assigneeMarker = "<!-- agentic-software-factory-assignee:";
const teamMarkerPrefix = "<!-- agentic-software-factory-team:";

const wantedLabels: ReadonlyArray<Omit<Label, "id">> = [
  { name: "status/ideation", color: "9ca3af", description: "Backlog idea", exclusive: true },
  { name: "status/requirements", color: "f5b70a", description: "Requirements interview and review", exclusive: true },
  { name: "status/implementation", color: "3b82f6", description: "Implementation and review", exclusive: true },
  { name: "status/done", color: "16a34a", description: "Completed by policy", exclusive: true },
  { name: "spec/draft", color: "94a3b8", description: "Draft specification", exclusive: true },
  { name: "spec/proposed", color: "f5b70a", description: "Specification awaiting human confirmation", exclusive: true },
  { name: "spec/accepted", color: "16a34a", description: "Accepted specification", exclusive: true },
  { name: "delivery/unplanned", color: "cbd5e1", description: "Not scheduled", exclusive: true },
];

export class ForgejoClient {
  readonly now: () => Date;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly owner: string;
  private readonly repository: string;
  private readonly branch: string;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private branchProtectionActors?: { mergeActor: string; reviewActor: string };

  constructor(baseUrl: string, token: string, owner: string, repository: string, branch: string, options: ClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.owner = owner;
    this.repository = repository;
    this.branch = branch;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async board(cursor?: string, signal?: AbortSignal): Promise<Board> {
    const page = boardPage(cursor);
    const response = await this.response(
      "GET",
      `${this.repoPath("issues")}?state=open&type=issues&sort=recentupdate&limit=${BOARD_PAGE_SIZE}&page=${page}`,
      undefined,
      signal,
    );
    const issues = await response.json() as Issue[];
    const total = totalCount(response.headers.get('x-total-count'));
    const truncated = total === null ? issues.length === BOARD_PAGE_SIZE : page * BOARD_PAGE_SIZE < total;
    const columns: Record<Status, Card[]> = { ideation: [], requirements: [], implementation: [], done: [] };
    for (const issue of issues) {
      const card = toCard(issue);
      columns[card.status].push(card);
    }
    return {
      repository: `${this.owner}/${this.repository}`,
      total,
      truncated,
      nextCursor: truncated ? String(page + 1) : null,
      columns,
    };
  }

  getIssue(number: number, signal?: AbortSignal): Promise<Issue> {
    return this.request<Issue>("GET", this.repoPath("issues", String(number)), undefined, signal);
  }

  async ready(signal?: AbortSignal): Promise<void> {
    const user = await this.authenticatedUser(signal);
    if (!user.login) throw new Error("Forgejo identity is not ready");
  }

  async ensureProjectRepository(owner: string, repository: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.request("GET", this.projectPath(owner, repository), undefined, signal, false);
      return;
    } catch (error) {
      if (!isUpstreamStatus(error, "Forgejo", 404)) throw error;
    }
    await this.request("POST", `/api/v1/orgs/${encodeURIComponent(owner)}/repos`, {
      name: repository,
      description: "Application source and delivery evidence managed by Agentic Software Factory",
      private: true,
      auto_init: true,
      default_branch: "main",
    }, signal, false);
  }

  getProjectRepository(owner: string, repository: string, signal?: AbortSignal): Promise<Repository> {
    return this.request<unknown>("GET", this.projectPath(owner, repository), undefined, signal)
      .then((value) => parseUpstream(repositorySchema, value, 'repository'));
  }

  async listOwnerRepositories(owner: string, signal?: AbortSignal): Promise<Repository[]> {
    const repositories: Repository[] = [];
    for (let page = 1; ; page += 1) {
      const pageItems = await this.request<Repository[]>(
        "GET",
        `/api/v1/orgs/${encodeURIComponent(owner)}/repos?limit=50&page=${page}`,
        undefined,
        signal,
      );
      repositories.push(...pageItems);
      if (pageItems.length < 50) return repositories;
    }
  }

  async listTeamRepositories(owner: string, name: string, signal?: AbortSignal): Promise<Repository[]> {
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>('GET', `/api/v1/orgs/${encodeURIComponent(owner)}/teams?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const team = teams.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!team) return [];
    const repositories: Repository[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Repository[]>('GET', `/api/v1/teams/${team.id}/repos?limit=50&page=${page}`, undefined, signal);
      repositories.push(...items);
      if (items.length < 50) return repositories;
    }
  }

  async ensureReadTeam(owner: string, name: string, usernames: string[], repositories: string[], signal?: AbortSignal, reconcileRepositories = true): Promise<void> {
    const path = `/api/v1/orgs/${encodeURIComponent(owner)}/teams`;
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>("GET", `${path}?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const body = readTeamBody(name);
    const existing = teams.find((team) => team.name.toLowerCase() === name.toLowerCase());
    const team = existing
      ? await this.request<Team>("PATCH", `/api/v1/teams/${existing.id}`, body, signal)
      : await this.request<Team>("POST", path, body, signal);
    const members: User[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<User[]>("GET", `/api/v1/teams/${team.id}/members?limit=50&page=${page}`, undefined, signal);
      members.push(...items);
      if (items.length < 50) break;
    }
    const desired = new Map<string, string>();
    for (const username of usernames) {
      const login = username.trim();
      if (login) desired.set(login.toLowerCase(), login);
    }
    const current = new Map(members.map((member) => [member.login.toLowerCase(), member.login]));
    for (const [key, username] of desired) {
      if (!current.has(key)) {
        try {
          await this.request<User>("GET", `/api/v1/users/${encodeURIComponent(username)}`, undefined, signal);
        } catch (error) {
          if (isUpstreamStatus(error, "Forgejo", 404)) continue;
          throw error;
        }
        await this.request("PUT", `/api/v1/teams/${team.id}/members/${encodeURIComponent(username)}`, undefined, signal, false);
      }
    }
    for (const [key, username] of current) {
      if (!desired.has(key)) {
        await this.request("DELETE", `/api/v1/teams/${team.id}/members/${encodeURIComponent(username)}`, undefined, signal, false);
      }
    }

    if (!reconcileRepositories) return;
    const assignedRepositories: Repository[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Repository[]>("GET", `/api/v1/teams/${team.id}/repos?limit=50&page=${page}`, undefined, signal);
      assignedRepositories.push(...items);
      if (items.length < 50) break;
    }
    const desiredRepositories = new Map<string, string>();
    for (const repository of repositories) {
      const name = repository.trim();
      if (name) desiredRepositories.set(name.toLowerCase(), name);
    }
    const currentRepositories = new Map(assignedRepositories.map((repository) => [repository.name.toLowerCase(), repository.name]));
    for (const [key, repository] of desiredRepositories) {
      if (!currentRepositories.has(key)) {
        await this.request("PUT", `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, undefined, signal, false);
      }
    }
    for (const [key, repository] of currentRepositories) {
      if (!desiredRepositories.has(key)) {
        await this.request("DELETE", `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, undefined, signal, false);
      }
    }
  }

  async ensureTeamRepository(owner: string, name: string, repository: string, signal?: AbortSignal): Promise<void> {
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>("GET", `/api/v1/orgs/${encodeURIComponent(owner)}/teams?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const existing = teams.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing && !isLeastPrivilegeReadTeam(existing)) {
      throw Object.assign(new Error(`Forgejo team ${name} must already be read-only and repository-scoped`), { status: 409 });
    }
    const team = existing
      ?? await this.request<Team>("POST", `/api/v1/orgs/${encodeURIComponent(owner)}/teams`, readTeamBody(name), signal);
    await this.request("PUT", `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, undefined, signal, false);
  }

  async teamHasRepository(owner: string, name: string, repository: string, signal?: AbortSignal): Promise<boolean> {
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>("GET", `/api/v1/orgs/${encodeURIComponent(owner)}/teams?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const team = teams.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!team) return false;
    try {
      await this.request('GET', `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, undefined, signal, false);
      return true;
    } catch (error) {
      if (isUpstreamStatus(error, 'Forgejo', 404)) return false;
      throw error;
    }
  }

  async assertScopedReadTeam(owner: string, name: string, signal?: AbortSignal): Promise<void> {
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>('GET', `/api/v1/orgs/${encodeURIComponent(owner)}/teams?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const team = teams.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!team || !isLeastPrivilegeReadTeam(team)) {
      throw Object.assign(new Error(`Forgejo team ${name} must be read-only and repository-scoped`), { status: 409 });
    }
  }

  async scopedReadTeamExists(owner: string, name: string, signal?: AbortSignal): Promise<boolean> {
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>('GET', `/api/v1/orgs/${encodeURIComponent(owner)}/teams?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const team = teams.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!team) return false;
    if (!isLeastPrivilegeReadTeam(team)) throw Object.assign(new Error(`Forgejo team ${name} must be read-only and repository-scoped`), { status: 409 });
    return true;
  }

  async removeTeamRepository(owner: string, name: string, repository: string, signal?: AbortSignal): Promise<void> {
    const teams: Team[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<Team[]>('GET', `/api/v1/orgs/${encodeURIComponent(owner)}/teams?limit=50&page=${page}`, undefined, signal);
      teams.push(...items);
      if (items.length < 50) break;
    }
    const team = teams.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!team) return;
    try {
      await this.request('DELETE', `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, undefined, signal, false);
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
    }
  }

  async setDefaultBranch(owner: string, repository: string, branch: string, signal?: AbortSignal): Promise<void> {
    await this.request("PATCH", this.projectPath(owner, repository), { default_branch: branch }, signal, false);
  }

  async ensureCollaborator(owner: string, repository: string, username: string, permission = "write", signal?: AbortSignal): Promise<void> {
    await this.request(
      "PUT",
      this.projectPath(owner, repository, "collaborators", encodeURIComponent(username)),
      { permission },
      signal,
      false,
    );
  }

  async collaboratorPermission(owner: string, repository: string, username: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const value = await this.request<{ permission?: string }>('GET', this.projectPath(owner, repository, 'collaborators', encodeURIComponent(username), 'permission'), undefined, signal);
      return typeof value.permission === 'string' && value.permission ? value.permission : null;
    } catch (error) {
      if (isUpstreamStatus(error, 'Forgejo', 404)) return null;
      throw error;
    }
  }

  async directCollaborators(owner: string, repository: string, signal?: AbortSignal): Promise<string[]> {
    const collaborators: string[] = [];
    for (let page = 1; ; page += 1) {
      const items = await this.request<User[]>('GET', `${this.projectPath(owner, repository, 'collaborators')}?limit=50&page=${page}`, undefined, signal);
      collaborators.push(...items.map((user) => user.login));
      if (items.length < 50) return collaborators;
    }
  }

  async removeCollaborator(owner: string, repository: string, username: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.request('DELETE', this.projectPath(owner, repository, 'collaborators', encodeURIComponent(username)), undefined, signal, false);
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
    }
  }

  async revokeImplementationContributorBranch(
    owner: string,
    repository: string,
    branch: string,
    contributor: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const path = this.projectPath(owner, repository, 'branch_protections', encodeURIComponent(branch));
    let current: BranchProtection;
    try {
      current = await this.request<BranchProtection>('GET', path, undefined, signal);
    } catch (error) {
      if (isUpstreamStatus(error, 'Forgejo', 404)) return;
      throw error;
    }
    if (!current.push_whitelist_usernames?.includes(contributor)) return;
    await this.request('PATCH', path, {
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: current.push_whitelist_usernames.filter((username) => username !== contributor),
      push_whitelist_teams: current.push_whitelist_teams ?? [],
      push_whitelist_deploy_keys: current.push_whitelist_deploy_keys ?? false,
      apply_to_admins: true,
    }, signal, false);
  }

  authenticatedUser(signal?: AbortSignal): Promise<{ login: string }> {
    return this.request<unknown>('GET', '/api/v1/user', undefined, signal)
      .then((value) => parseUpstream(authenticatedUserSchema, value, 'authenticated user'));
  }

  async assertAuthenticatedLogin(expectedLogin: string, signal?: AbortSignal): Promise<string> {
    const { login } = await this.authenticatedUser(signal);
    if (login !== expectedLogin) {
      throw new Error(`Forgejo token authenticated as ${login}; expected ${expectedLogin}`);
    }
    return login;
  }

  configureBranchProtectionActors(mergeActor: string, reviewActor: string): this {
    this.branchProtectionActors = { mergeActor, reviewActor };
    return this;
  }

  withPullReviewActor(reviewClient: ForgejoClient): ForgejoClient {
    const reviewMethods = new Set<PropertyKey>(['listPullReviews', 'createPullReview', 'submitPullReview']);
    return new Proxy(this, {
      get(target, property) {
        const owner = reviewMethods.has(property) ? reviewClient : target;
        const value = Reflect.get(owner, property, owner) as unknown;
        return typeof value === 'function' ? value.bind(owner) : value;
      },
    });
  }

  forRepository(owner: string, repository: string): ForgejoClient {
    const scoped = new ForgejoClient(this.baseUrl, this.token, owner, repository, this.branch, {
      fetch: this.fetch,
      now: this.now,
      timeoutMs: this.timeoutMs,
    });
    if (this.branchProtectionActors) scoped.branchProtectionActors = this.branchProtectionActors;
    return scoped;
  }

  async ensureMainBranchProtection(
    owner: string,
    repository: string,
    branch: string,
    actorsOrSignal?: { mergeActor: string; reviewActor: string } | AbortSignal,
    signal?: AbortSignal,
  ): Promise<{ created: boolean; addedStatusChecks: string[]; preservedStatusChecks: string[] }> {
    const actors = actorsOrSignal instanceof AbortSignal ? this.branchProtectionActors : actorsOrSignal ?? this.branchProtectionActors;
    const operationSignal = actorsOrSignal instanceof AbortSignal ? actorsOrSignal : signal;
    if (!actors) throw new Error('Forgejo branch protection actors are not configured');
    const path = this.projectPath(owner, repository, "branch_protections", encodeURIComponent(branch));
    const existing = await this.mainBranchProtection(owner, repository, branch, operationSignal);
    const factoryChecks = ["factory/specification", "factory/verification"];
    const preservedStatusChecks = [...new Set(existing?.status_check_contexts ?? [])];
    const statusChecks = [...new Set([...preservedStatusChecks, ...factoryChecks])];
    if (existing) assertCompatibleMainProtection(existing, actors);
    const body = {
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: existing?.push_whitelist_usernames ?? [actors.mergeActor],
      push_whitelist_teams: existing?.push_whitelist_teams ?? [],
      push_whitelist_deploy_keys: existing?.push_whitelist_deploy_keys ?? false,
      enable_merge_whitelist: true,
      merge_whitelist_usernames: existing?.merge_whitelist_usernames ?? [actors.mergeActor],
      merge_whitelist_teams: existing?.merge_whitelist_teams ?? [],
      enable_status_check: true,
      status_check_contexts: statusChecks,
      required_approvals: Math.max(1, existing?.required_approvals ?? 0),
      enable_approvals_whitelist: true,
      approvals_whitelist_username: existing?.approvals_whitelist_username ?? [actors.reviewActor],
      approvals_whitelist_teams: existing?.approvals_whitelist_teams ?? [],
      block_on_rejected_reviews: true,
      dismiss_stale_approvals: true,
      block_on_outdated_branch: true,
      apply_to_admins: true,
    };
    if (existing) {
      await this.request("PATCH", path, body, operationSignal, false);
    } else {
      await this.request("POST", this.projectPath(owner, repository, "branch_protections"), { rule_name: branch, ...body }, operationSignal, false);
    }
    return {
      created: existing === null,
      addedStatusChecks: factoryChecks.filter((check) => !preservedStatusChecks.includes(check)),
      preservedStatusChecks: preservedStatusChecks.filter((check) => !factoryChecks.includes(check)),
    };
  }

  async planMainBranchProtection(owner: string, repository: string, branch: string, signal?: AbortSignal): Promise<{ created: boolean; addedStatusChecks: string[]; preservedStatusChecks: string[] }> {
    const existing = await this.mainBranchProtection(owner, repository, branch, signal);
    const factoryChecks = ["factory/specification", "factory/verification"];
    const preserved = [...new Set(existing?.status_check_contexts ?? [])];
    return {
      created: existing === null,
      addedStatusChecks: factoryChecks.filter((check) => !preserved.includes(check)),
      preservedStatusChecks: preserved.filter((check) => !factoryChecks.includes(check)),
    };
  }

  async branchProtectionNeedsAdding(owner: string, repository: string, rule: string, signal?: AbortSignal): Promise<boolean> {
    return (await this.branchProtection(owner, repository, rule, signal)) === null;
  }

  async removeFactoryMainBranchProtection(
    owner: string,
    repository: string,
    branch: string,
    plan: { created: boolean; addedStatusChecks: string[] },
    signal?: AbortSignal,
  ): Promise<void> {
    const path = this.projectPath(owner, repository, 'branch_protections', encodeURIComponent(branch));
    if (plan.created) {
      const existing = await this.branchProtection(owner, repository, branch, signal);
      if (existing && this.branchProtectionActors && isFactoryMainProtection(existing, this.branchProtectionActors)) {
        await this.removeBranchProtection(owner, repository, branch, signal);
      }
      return;
    }
    const existing = await this.branchProtection(owner, repository, branch, signal);
    if (!existing || plan.addedStatusChecks.length === 0) return;
    const statusChecks = (Array.isArray(existing.status_check_contexts) ? existing.status_check_contexts : [])
      .filter((check): check is string => typeof check === 'string' && !plan.addedStatusChecks.includes(check));
    await this.request('PATCH', path, { status_check_contexts: statusChecks, enable_status_check: statusChecks.length > 0 }, signal, false);
  }

  async removeBranchProtection(owner: string, repository: string, rule: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.request('DELETE', this.projectPath(owner, repository, 'branch_protections', encodeURIComponent(rule)), undefined, signal, false);
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
    }
  }

  async removeFactoryImplementationBranchProtection(
    owner: string,
    repository: string,
    implementationUser: string,
    createdByFactory: boolean | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    if (createdByFactory === false) return;
    const rule = 'factory/requirement-*';
    const existing = await this.branchProtection(owner, repository, rule, signal);
    if (!existing || !isFactoryImplementationProtection(existing, implementationUser)) return;
    await this.removeBranchProtection(owner, repository, rule, signal);
  }

  private async mainBranchProtection(owner: string, repository: string, branch: string, signal?: AbortSignal): Promise<BranchProtection | null> {
    return this.branchProtection(owner, repository, branch, signal) as Promise<BranchProtection | null>;
  }

  private async branchProtection(owner: string, repository: string, rule: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    try {
      return await this.request("GET", this.projectPath(owner, repository, "branch_protections", encodeURIComponent(rule)), undefined, signal);
    } catch (error) {
      if (!isUpstreamStatus(error, "Forgejo", 404)) throw error;
      return null;
    }
  }

  async ensureImplementationBranchProtection(owner: string, repository: string, implementationUser: string, signal?: AbortSignal): Promise<void> {
    await this.ensureImplementationPushRule(owner, repository, 'factory/requirement-*', [implementationUser], signal, true);
  }

  async ensureImplementationContributorAccess(
    owner: string,
    repository: string,
    branch: string,
    implementationUser: string,
    contributor: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.ensureCollaborator(owner, repository, contributor, 'write', signal);
    const path = this.projectPath(owner, repository, 'branch_protections', encodeURIComponent(branch));
    let existing: { push_whitelist_usernames?: string[] } | null = null;
    try {
      existing = await this.request('GET', path, undefined, signal);
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
    }
    await this.ensureImplementationPushRule(
      owner,
      repository,
      branch,
      [...new Set([implementationUser, contributor, ...(existing?.push_whitelist_usernames ?? [])])],
      signal,
    );
  }

  async releaseImplementationContributorAccess(
    owner: string,
    repository: string,
    branch: string,
    implementationUser: string,
    contributor: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const path = this.projectPath(owner, repository, 'branch_protections', encodeURIComponent(branch));
    let current: { push_whitelist_usernames?: string[] } | null = null;
    try {
      current = await this.request('GET', path, undefined, signal);
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
    }
    if (current) {
      const usernames = [...new Set([implementationUser, ...(current.push_whitelist_usernames ?? []).filter((username) => username !== contributor)])];
      await this.ensureImplementationPushRule(owner, repository, branch, usernames, signal);
    }
    const protections = await this.request<Array<{ rule_name: string; push_whitelist_usernames?: string[] }>>(
      'GET', this.projectPath(owner, repository, 'branch_protections'), undefined, signal,
    );
    const stillActive = protections.some((protection) => protection.rule_name.startsWith('factory/requirement-')
      && protection.rule_name !== 'factory/requirement-*'
      && protection.rule_name !== branch
      && protection.push_whitelist_usernames?.includes(contributor));
    if (!stillActive) await this.ensureCollaborator(owner, repository, contributor, 'read', signal);
  }

  private async ensureImplementationPushRule(
    owner: string,
    repository: string,
    rule: string,
    usernames: string[],
    signal?: AbortSignal,
    preserveExistingUsers = false,
  ): Promise<void> {
    const path = this.projectPath(owner, repository, 'branch_protections', encodeURIComponent(rule));
    const createBody = {
      enable_push: true,
      enable_push_whitelist: true,
      push_whitelist_usernames: usernames,
      push_whitelist_teams: [],
      push_whitelist_deploy_keys: false,
      enable_merge_whitelist: false,
      enable_status_check: false,
      required_approvals: 0,
      enable_approvals_whitelist: false,
      block_on_rejected_reviews: false,
      block_on_official_review_requests: false,
      block_on_outdated_branch: false,
      dismiss_stale_approvals: false,
      ignore_stale_approvals: false,
      require_signed_commits: false,
      protected_file_patterns: '',
      unprotected_file_patterns: '',
      apply_to_admins: true,
    };
    try {
      const existing = await this.request<BranchProtection>('GET', path, undefined, signal);
      await this.request('PATCH', path, {
        enable_push: true,
        enable_push_whitelist: true,
        push_whitelist_usernames: [...new Set([...(preserveExistingUsers ? existing.push_whitelist_usernames ?? [] : []), ...usernames])],
        push_whitelist_teams: existing.push_whitelist_teams ?? [],
        push_whitelist_deploy_keys: existing.push_whitelist_deploy_keys ?? false,
        apply_to_admins: true,
      }, signal, false);
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
      await this.request('POST', this.projectPath(owner, repository, 'branch_protections'), { rule_name: rule, ...createBody }, signal, false);
    }
  }

  async ensureBranch(owner: string, repository: string, branch: string, baseBranch: string, signal?: AbortSignal, verifyOrigin = false): Promise<void> {
    try {
      await this.request("POST", this.projectPath(owner, repository, "branches"), {
        new_branch_name: branch,
        old_branch_name: baseBranch,
      }, signal, false);
    } catch (error) {
      if (!isUpstreamStatus(error, "Forgejo", 409)) throw error;
      if (!verifyOrigin) return;
      const [existing, origin] = await Promise.all([
        this.getProjectBranchHead(owner, repository, branch, signal),
        this.getProjectBranchHead(owner, repository, baseBranch, signal),
      ]);
      if (existing !== origin) throw Object.assign(new Error('existing implementation branch has an unexpected origin'), { status: 409 });
    }
  }

  async writeProjectFile(
    owner: string,
    repository: string,
    branch: string,
    filePath: string,
    content: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.request<{ commit: { sha: string } }>(
      "POST",
      `${this.projectPath(owner, repository, "contents")}/${cleanPath(filePath)}`,
      { branch, content: base64Encode(new TextEncoder().encode(content)), message },
      signal,
    );
    return response.commit.sha;
  }

  async upsertProjectFile(
    owner: string,
    repository: string,
    branch: string,
    filePath: string,
    content: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const endpoint = `${this.projectPath(owner, repository, "contents")}/${cleanPath(filePath)}`;
    let sha: string | undefined;
    try {
      const existing = await this.request<{ sha: string }>('GET', `${endpoint}?ref=${encodeURIComponent(branch)}`, undefined, signal);
      sha = existing.sha;
    } catch (error) {
      if (!isUpstreamStatus(error, 'Forgejo', 404)) throw error;
    }
    const response = await this.request<{ commit: { sha: string } }>(sha ? 'PUT' : 'POST', endpoint, {
      branch, content: base64Encode(new TextEncoder().encode(content)), message, ...(sha ? { sha } : {}),
    }, signal);
    return response.commit.sha;
  }

  async readProjectFile(
    owner: string,
    repository: string,
    branch: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return new TextDecoder().decode(await this.readProjectFileBytes(owner, repository, branch, filePath, signal));
  }

  async readProjectFileBytes(
    owner: string,
    repository: string,
    branch: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await this.request<{ content: string }>(
      "GET",
      `${this.projectPath(owner, repository, "contents")}/${cleanPath(filePath)}?ref=${encodeURIComponent(branch)}`,
      undefined,
      signal,
    );
    const binary = atob(response.content.replaceAll("\n", ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async findPullRequest(owner: string, repository: string, branch: string, signal?: AbortSignal): Promise<PullRequest | null> {
    const pulls = await this.request<PullRequest[]>(
      "GET",
      `${this.projectPath(owner, repository, "pulls")}?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&limit=50`,
      undefined,
      signal,
    );
    return pulls.find((pull) => pull.head.ref === branch) ?? null;
  }

  async findPullRequestByBranch(owner: string, repository: string, branch: string, signal?: AbortSignal): Promise<PullRequest | null> {
    const pulls = await this.request<PullRequest[]>(
      "GET",
      `${this.projectPath(owner, repository, "pulls")}?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&limit=50`,
      undefined,
      signal,
    );
    return pulls.filter((pull) => pull.head.ref === branch).sort((left, right) => right.number - left.number)[0] ?? null;
  }

  createPullRequest(
    owner: string,
    repository: string,
    title: string,
    body: string,
    branch: string,
    baseBranch: string,
    signal?: AbortSignal,
  ): Promise<PullRequest> {
    return this.request<PullRequest>("POST", this.projectPath(owner, repository, "pulls"), {
      title,
      body,
      head: branch,
      base: baseBranch,
    }, signal);
  }

  getPullRequest(owner: string, repository: string, number: number, signal?: AbortSignal): Promise<PullRequest> {
    return this.request<PullRequest>("GET", this.projectPath(owner, repository, "pulls", String(number)), undefined, signal);
  }

  async listPullCommitShas(owner: string, repository: string, number: number, signal?: AbortSignal): Promise<string[]> {
    const shas: string[] = [];
    for (let page = 1; ; page += 1) {
      const commits = await this.request<Array<{ sha: string }>>(
        "GET", `${this.projectPath(owner, repository, "pulls", String(number), "commits")}?limit=50&page=${page}`, undefined, signal,
      );
      shas.push(...commits.map((commit) => commit.sha));
      if (commits.length < 50) return shas;
    }
  }

  async getProjectBranchHead(owner: string, repository: string, branch: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request<{ commit: { id: string } }>(
      "GET", this.projectPath(owner, repository, "branches", encodeURIComponent(branch)), undefined, signal,
    );
    return response.commit.id;
  }

  getProjectCommit(owner: string, repository: string, sha: string, signal?: AbortSignal): Promise<RepositoryCommit> {
    return this.request<RepositoryCommit>(
      'GET',
      `${this.projectPath(owner, repository, 'git', 'commits', encodeURIComponent(sha))}?stat=false&verification=false&files=false`,
      undefined,
      signal,
    );
  }

  synchronizeProjectBranch(input: {
    owner: string;
    repository: string;
    branch: string;
    defaultBranch: string;
    headSha: string;
    defaultSha: string;
    cloneUrl: string;
    signal?: AbortSignal;
  }): Promise<GitSynchronizationResult> {
    const cloneUrl = `${this.baseUrl}/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}.git`;
    return new GitBranchSynchronizer().synchronize({ ...input, cloneUrl, token: this.token });
  }

  listCommitStatuses(owner: string, repository: string, sha: string, signal?: AbortSignal): Promise<CommitStatus[]> {
    return this.paginated<CommitStatus>(this.projectPath(owner, repository, "statuses", encodeURIComponent(sha)), signal);
  }

  createCommitStatus(
    owner: string,
    repository: string,
    sha: string,
    status: CommitStatus["status"],
    context: string,
    description: string,
    targetUrl: string,
    signal?: AbortSignal,
  ): Promise<CommitStatus> {
    return this.request<CommitStatus>("POST", this.projectPath(owner, repository, "statuses", encodeURIComponent(sha)), {
      state: status,
      context,
      description,
      target_url: targetUrl,
    }, signal);
  }

  listPullReviews(owner: string, repository: string, number: number, signal?: AbortSignal): Promise<PullReview[]> {
    return this.paginated<PullReview>(this.projectPath(owner, repository, "pulls", String(number), "reviews"), signal);
  }

  async createPullReview(
    owner: string,
    repository: string,
    number: number,
    commitSha: string,
    decision: "APPROVED" | "REQUEST_CHANGES",
    body: string,
    signal?: AbortSignal,
  ): Promise<PullReview> {
    const review = await this.request<PullReview>("POST", this.projectPath(owner, repository, "pulls", String(number), "reviews"), {
      body,
      commit_id: commitSha,
      event: decision,
    }, signal);
    if (review.state !== "PENDING") return review;
    return this.request<PullReview>(
      "POST",
      this.projectPath(owner, repository, "pulls", String(number), "reviews", String(review.id)),
      { body, event: decision },
      signal,
    );
  }

  submitPullReview(
    owner: string,
    repository: string,
    number: number,
    reviewId: number,
    decision: "APPROVED" | "REQUEST_CHANGES",
    body: string,
    signal?: AbortSignal,
  ): Promise<PullReview> {
    return this.request<PullReview>(
      "POST",
      this.projectPath(owner, repository, "pulls", String(number), "reviews", String(reviewId)),
      { body, event: decision },
      signal,
    );
  }

  async mergePullRequest(
    owner: string,
    repository: string,
    number: number,
    expectedHeadSha: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request("POST", this.projectPath(owner, repository, "pulls", String(number), "merge"), {
      Do: "merge",
      head_commit_id: expectedHeadSha,
      merge_message_field: "body",
    }, signal, false);
  }

  async createRequirement(title: string, body: string, team: string, signal?: AbortSignal): Promise<Card> {
    if (!title.trim() || !body.trim()) throw new Error("title and body are required");
    if (!teamSlug(team)) throw new Error("a valid team is required");
    const labels = await this.ensureLabels(signal);
    const issue = await this.request<Issue>("POST", this.repoPath("issues"), {
      title,
      body: body.trim() + teamMarker(team),
      labels: [requiredLabel(labels, "status/ideation").id, requiredLabel(labels, "spec/draft").id],
    }, signal);
    return toCard(issue);
  }

  async updateRequirement(
    number: number,
    title: string,
    body: string,
    applicationIds: string[],
    assignee?: string | null,
    expectedUpdatedAt?: string | Date | null,
    signal?: AbortSignal,
  ): Promise<Card> {
    const issue = await this.getIssue(number, signal);
    if (expectedUpdatedAt != null && !sameInstant(issue.updated_at, expectedUpdatedAt)) {
      throw new ApplicationError('conflict', 409, "requirement changed; refresh before editing it");
    }
    if (!title.trim()) title = issue.title;
    if (body === "") body = visibleIssueBody(issue.body);
    const current = toCard(issue);
    if ((current.acceptance || current.status === 'implementation' || current.status === 'done')
      && (title !== issue.title || visibleIssueBody(body) !== current.body)) {
      throw workflowError('accepted requirements cannot be edited');
    }
    const selectedAssignee = assignee === undefined ? findAssignee(issue.body) : assignee?.trim() || null;
    const updatedBody = visibleIssueBody(body).trim() + teamMarkerFragment(issue.body) + applicationMarker(applicationIds) + factoryAssigneeMarker(selectedAssignee) + interviewMarkerFragment(issue.body)
      + proposalMarkerFragment(issue.body) + acceptedMarkerFragment(issue.body);
    const request: { title: string; body: string; assignees?: string[] } = { title, body: updatedBody };
    if (assignee !== undefined) request.assignees = [];
    return toCard(await this.request<Issue>("PATCH", this.repoPath("issues", String(number)), request, signal));
  }

  async closeRequirement(number: number, signal?: AbortSignal): Promise<void> {
    await this.request<void>("PATCH", this.repoPath("issues", String(number)), { state: "closed" }, signal, false);
  }

  async transition(number: number, status: string, expectedUpdatedAt?: string | Date | null, signal?: AbortSignal): Promise<Card> {
    if (!isStatus(status)) throw new Error(`unknown status ${JSON.stringify(status)}`);
    const issue = await this.getIssue(number, signal);
    if (expectedUpdatedAt != null && !sameInstant(issue.updated_at, expectedUpdatedAt)) {
      throw new ApplicationError('conflict', 409, "requirement changed; refresh before moving it");
    }
    const labels = await this.ensureLabels(signal);
    const ids = (issue.labels ?? []).filter((label) => !label.name.startsWith("status/")).map((label) => label.id);
    ids.push(requiredLabel(labels, `status/${status}`).id);
    await this.replaceLabels(number, ids, signal);
    return toCard(await this.getIssue(number, signal));
  }

  async propose(number: number, actor: string, specification: RequirementSpec, provenance?: ProposalProvenance, signal?: AbortSignal): Promise<Proposal> {
    validateSpecification(specification);
    let issue = await this.getIssue(number, signal);
    const statusLabels = (issue.labels ?? []).filter((label) => label.name.startsWith("status/"));
    if (
      statusLabels.length !== 1
      || !["status/ideation", "status/requirements"].includes(statusLabels[0]!.name)
      || issue.labels.some((label) => label.name === "spec/accepted")
    ) {
      throw new Error("requirements may only be proposed in ideation or requirements");
    }
    let state: InterviewState;
    try { state = findInterview(issue.body); } catch { throw workflowError("a bound AI interview is required"); }
    assertAIInterview(state, number);
    let acceptedProvenance = provenance;
    if (acceptedProvenance) {
      if (state.done) throw workflowError("the AI interview run is no longer active");
      assertProposalMatchesRun({ provenance: acceptedProvenance }, state, number);
    } else {
      if (!state.done) throw workflowError("finish the AI interview before editing its proposal");
      const current = findProposal(issue.body);
      assertProposalMatchesRun(current, state, number);
      acceptedProvenance = current.provenance;
    }
    let currentProposal: Proposal | null = null;
    try { currentProposal = findProposal(issue.body); } catch {}
    const proposal: Proposal = currentProposal && sameSpecification(currentProposal.specification, specification)
      && JSON.stringify(currentProposal.provenance) === JSON.stringify(acceptedProvenance)
      ? currentProposal
      : { specification, proposedBy: actor, proposedAt: formatRFC3339(this.now()), provenance: acceptedProvenance };
    const marker = `\n\n${proposalMarker}${base64UrlEncodeJson(proposal)} -->`;
    const body = visibleIssueBody(issue.body) + teamMarkerFragment(issue.body) + applicationMarker(applicationIds(issue.body)) + assigneeMarkerFragment(issue.body)
      + interviewMarkerFragment(issue.body) + marker + acceptedMarkerFragment(issue.body);
    if (issue.body !== body) {
      await this.assertIssueUnchanged(issue, "requirement changed; refresh before saving the proposal", signal);
      await this.updateIssueBody(number, body, signal);
      issue = await this.getIssue(number, signal);
    }
    const labels = await this.ensureLabels(signal);
    issue = await this.getIssue(number, signal);
    const ids = (issue.labels ?? []).filter((label) => !label.name.startsWith("spec/") && !label.name.startsWith("status/")).map((label) => label.id);
    ids.push(requiredLabel(labels, "spec/proposed").id, requiredLabel(labels, "status/requirements").id);
    if (!sameLabelIds(issue.labels, ids)) {
      await this.assertIssueUnchanged(issue, "requirement changed; refresh before saving the proposal", signal);
      await this.replaceLabels(number, ids, signal);
    }
    const reconciled = await this.getIssue(number, signal);
    if (!sameSpecification(findProposal(reconciled.body).specification, specification)
      || !hasLabels(reconciled, "spec/proposed", "status/requirements")) {
      throw workflowError("proposal state could not be reconciled");
    }
    return proposal;
  }

  async getProposal(number: number, signal?: AbortSignal): Promise<Proposal> {
    return findProposal((await this.getIssue(number, signal)).body);
  }

  async accept(number: number, actor: string, specification: RequirementSpec, signal?: AbortSignal): Promise<AcceptanceResult> {
    validateSpecification(specification);
    let issue = await this.getIssue(number, signal);
    let existing: AcceptanceMetadata | null = null;
    try { existing = findAccepted(issue.body); } catch {}
    if (existing) {
      const verified = await this.verifyAcceptance(issue, existing, signal);
      if (!sameSpecification(verified.specification, specification)) {
        throw workflowError("accepted specification differs from this request");
      }
      await this.reconcileAcceptance(number, issue, verified, signal);
      return acceptanceResult(verified);
    }
    let state: InterviewState;
    try { state = findInterview(issue.body); } catch { throw workflowError("a completed AI interview proposal is required"); }
    if (!state.done) throw workflowError("finish the AI interview before accepting its proposal");
    const proposal = findProposal(issue.body);
    assertProposalMatchesRun(proposal, state, number);
    if (!sameSpecification(proposal.specification, specification)) {
      throw workflowError("save the AI proposal before accepting it");
    }
    const requirementId = findRequirementId(issue.body) || await this.stableRequirementId(number);
    const proposedAt = new Date(proposal.proposedAt);
    if (!Number.isFinite(proposedAt.getTime())) throw workflowError("requirement proposal is malformed");
    const revision = formatRevision(proposedAt);
    let projection = await this.findAcceptanceArtifact(issue, requirementId, revision, specification, signal);
    if (projection) {
      await this.assertIssueUnchanged(issue, "requirement changed while acceptance was being recovered", signal);
      await this.reconcileAcceptance(number, issue, projection, signal);
      return acceptanceResult(projection);
    }
    const acceptedAt = formatRFC3339(this.now());
    const contents = encodeSnapshotYaml({
      schema_version: 1,
      requirement_id: requirementId,
      revision,
      title: issue.title,
      status: "accepted",
      accepted_at: acceptedAt,
      accepted_by: actor,
      issue: issue.html_url,
      specification,
    });
    const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", contents.buffer as ArrayBuffer));
    const digestHex = bytesToHex(digestBytes);
    const digest = `sha256:${digestHex}`;
    const filePath = `requirements/${requirementId}/revisions/${revision}-${digestHex.slice(0, 12)}.yaml`;
    const commitSha = await this.createFile(filePath, contents, `accept ${requirementId} revision ${revision}`, signal);
    const result: AcceptanceResult = { requirementId, revision, digest, path: filePath, commitSha };
    projection = { ...result, acceptedAt, acceptedBy: actor, specification };
    await this.assertIssueUnchanged(issue, "requirement changed while it was being accepted", signal);
    await this.reconcileAcceptance(number, issue, projection, signal);
    return result;
  }

  private async reconcileAcceptance(number: number, source: Issue, projection: AcceptanceMetadata, signal?: AbortSignal): Promise<void> {
    let issue = await this.getIssue(number, signal);
    if (!sameIssueVersion(source, issue)) throw workflowError("requirement changed while it was being accepted");
    const body = visibleIssueBody(issue.body) + teamMarkerFragment(issue.body) + applicationMarker(applicationIds(issue.body)) + assigneeMarkerFragment(issue.body)
      + interviewMarkerFragment(issue.body) + acceptedMarker(projection);
    if (issue.body !== body) {
      await this.assertIssueUnchanged(issue, "requirement changed while it was being accepted", signal);
      await this.updateIssueBody(number, body, signal);
    }
    const labels = await this.ensureLabels(signal);
    issue = await this.getIssue(number, signal);
    const ids = (issue.labels ?? [])
      .filter((label) => !label.name.startsWith("spec/") && !label.name.startsWith("delivery/") && !label.name.startsWith("status/"))
      .map((label) => label.id);
    ids.push(requiredLabel(labels, "status/implementation").id, requiredLabel(labels, "spec/accepted").id, requiredLabel(labels, "delivery/unplanned").id);
    if (!sameLabelIds(issue.labels, ids)) {
      await this.assertIssueUnchanged(issue, "requirement changed while it was being accepted", signal);
      await this.replaceLabels(number, ids, signal);
    }
    issue = await this.getIssue(number, signal);
    const accepted = findAccepted(issue.body);
    if (accepted.digest !== projection.digest || !hasLabels(issue, "status/implementation", "spec/accepted", "delivery/unplanned")) {
      throw workflowError("acceptance state could not be reconciled");
    }
  }

  private async findAcceptanceArtifact(
    issue: Issue,
    requirementId: string,
    revision: string,
    specification: RequirementSpec,
    signal?: AbortSignal,
  ): Promise<AcceptanceMetadata | null> {
    const directory = `requirements/${requirementId}/revisions`;
    let entries: Array<{ name: string; path: string; type: string }>;
    try {
      entries = await this.request("GET", `${this.repoPath("contents")}/${directory}?ref=${encodeURIComponent(this.branch)}`, undefined, signal);
    } catch (error) {
      if (isUpstreamStatus(error, "Forgejo", 404)) return null;
      throw error;
    }
    for (const entry of entries) {
      if (entry.type !== "file" || !entry.name.startsWith(`${revision}-`) || !entry.name.endsWith(".yaml")) continue;
      const bytes = await this.readProjectFileBytes(this.owner, this.repository, this.branch, entry.path, signal);
      let snapshot: AcceptedSnapshot;
      try { snapshot = acceptedSnapshotSchema.parse(Bun.YAML.parse(new TextDecoder().decode(bytes))); } catch { continue; }
      const found = fromSnapshotSpecification(snapshot.specification);
      if (snapshot.requirement_id !== requirementId || snapshot.revision !== revision || snapshot.issue !== issue.html_url
        || snapshot.title !== issue.title || !sameSpecification(found, specification)) continue;
      const digest = `sha256:${bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)))}`;
      const digestHex = digest.slice("sha256:".length);
      if (entry.path !== `${directory}/${revision}-${digestHex.slice(0, 12)}.yaml`) continue;
      const commitSha = await this.getProjectBranchHead(this.owner, this.repository, this.branch, signal);
      return {
        requirementId, revision, digest, path: entry.path, commitSha,
        acceptedAt: snapshot.accepted_at, acceptedBy: snapshot.accepted_by, specification: found,
      };
    }
    return null;
  }

  private async stableRequirementId(number: number): Promise<string> {
    const identity = new TextEncoder().encode(`${this.owner}/${this.repository}#${number}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", identity));
    return `req_${bytesToHex(digest).slice(0, 32)}`;
  }

  private async assertIssueUnchanged(issue: Issue, message: string, signal?: AbortSignal): Promise<void> {
    const current = await this.getIssue(issue.number, signal);
    if (!sameIssueVersion(issue, current)) throw workflowError(message);
  }

  async verifyAcceptance(issue: Pick<Issue, "number" | "html_url">, acceptance: AcceptanceMetadata, signal?: AbortSignal): Promise<AcceptanceMetadata> {
    if ([acceptance.requirementId, acceptance.revision, acceptance.digest, acceptance.path, acceptance.commitSha]
      .some((value) => typeof value !== "string")) throw workflowError("accepted specification reference is invalid");
    const digestMatch = /^sha256:([a-f0-9]{64})$/.exec(acceptance.digest);
    const immutableCommit = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(acceptance.commitSha);
    const requirementIdentity = /^req_[a-f0-9]{32}$/.test(acceptance.requirementId)
      && /^\d{8}T\d{6}\.\d{9}Z$/.test(acceptance.revision);
    const expectedPath = digestMatch
      ? `requirements/${acceptance.requirementId}/revisions/${acceptance.revision}-${digestMatch[1]!.slice(0, 12)}.yaml`
      : "";
    if (!digestMatch || !immutableCommit || !requirementIdentity
      || acceptance.path !== expectedPath || cleanPath(acceptance.path) !== acceptance.path) {
      throw workflowError("accepted specification reference is invalid");
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.readProjectFileBytes(this.owner, this.repository, acceptance.commitSha, acceptance.path, signal);
    } catch (error) {
      if (isUpstreamStatus(error, "Forgejo", 404)) throw workflowError("accepted specification artifact was not found");
      throw error;
    }
    const actualDigest = `sha256:${bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)))}`;
    if (actualDigest !== acceptance.digest) throw workflowError("accepted specification artifact digest does not match");
    let snapshot: AcceptedSnapshot;
    try {
      snapshot = acceptedSnapshotSchema.parse(Bun.YAML.parse(new TextDecoder().decode(bytes)));
    } catch {
      throw workflowError("accepted specification artifact is malformed");
    }
    if (snapshot.requirement_id !== acceptance.requirementId || snapshot.revision !== acceptance.revision
      || snapshot.issue !== issue.html_url) {
      throw workflowError("accepted specification artifact has the wrong requirement identity");
    }
    const specification = fromSnapshotSpecification(snapshot.specification);
    validateSpecification(specification);
    return { ...acceptance, specification };
  }

  async ensureLabels(signal?: AbortSignal): Promise<Map<string, Label>> {
    const existing = await this.paginated<Label>(this.repoPath("labels"), signal);
    const result = new Map(existing.map((label) => [label.name, label]));
    for (const wanted of wantedLabels) {
      if (result.has(wanted.name)) continue;
      const created = await this.request<Label>("POST", this.repoPath("labels"), wanted, signal);
      result.set(created.name, created);
    }
    return result;
  }

  getInterview(number: number, signal?: AbortSignal): Promise<InterviewResponse> {
    return getInterview(this, number, signal);
  }

  async reconcilableInterviews(signal?: AbortSignal): Promise<Array<{ number: number; state: InterviewState }>> {
    return (await this.listIssues(signal, Number.POSITIVE_INFINITY, ['status/requirements'])).flatMap((issue) => {
      try {
        const state = findInterview(issue.body);
        return state.pendingOperation && !state.pendingOperation.failure ? [{ number: issue.number, state }] : [];
      } catch {
        return [];
      }
    });
  }

  beginInterview(number: number, actor: string, retake: boolean, binding: { runId: string; chatId: string; teamId: string; repository: string; proposalNonce: string }, pending: InterviewQuestion, expectedVersion: number, signal?: AbortSignal): Promise<InterviewState> {
    return beginInterview(this, number, actor, retake, binding, pending, expectedVersion, signal);
  }

  prepareInterviewAnswer(number: number, actor: string, answer: InterviewAnswer, payload: string, operationId: string, signal?: AbortSignal): Promise<InterviewState> {
    return prepareInterviewAnswer(this, number, actor, answer, payload, operationId, signal);
  }

  setInterviewOperationPhase(number: number, operationId: string, phase: 'answer' | 'proposal', signal?: AbortSignal): Promise<InterviewState> {
    return setInterviewOperationPhase(this, number, operationId, phase, signal);
  }

  setInterviewOperationFailure(number: number, operationId: string, failure: { message: string; retryable: boolean } | null, signal?: AbortSignal): Promise<InterviewState> {
    return setInterviewOperationFailure(this, number, operationId, failure, signal);
  }

  completeInterviewAnswer(number: number, operationId: string, next: InterviewQuestion | null, done: boolean, signal?: AbortSignal): Promise<InterviewState> {
    return completeInterviewAnswer(this, number, operationId, next, done, signal);
  }

  recordInterviewRefinement(number: number, actor: string, note: string, next: InterviewQuestion | null, expectedVersion: number, signal?: AbortSignal): Promise<InterviewState> {
    return recordInterviewRefinement(this, number, actor, note, next, expectedVersion, signal);
  }

  events(number: number, signal?: AbortSignal): Promise<CardEvent[]> {
    return events(this, number, signal);
  }

  async updateIssueBody(number: number, body: string, signal?: AbortSignal): Promise<void> {
    await this.request<void>("PATCH", this.repoPath("issues", String(number)), { body }, signal, false);
  }

  async replaceLabels(number: number, labels: number[], signal?: AbortSignal): Promise<void> {
    await this.request<void>("PUT", this.repoPath("issues", String(number), "labels"), { labels }, signal, false);
  }

  private async listIssues(signal?: AbortSignal, maximum = Number.POSITIVE_INFINITY, labels: string[] = []): Promise<Issue[]> {
    const all: Issue[] = [];
    for (let page = 1; ; page += 1) {
      const limit = Math.min(50, maximum - all.length);
      if (limit <= 0) break;
      const query = new URLSearchParams({ state: 'open', type: 'issues', limit: String(limit), page: String(page) });
      if (labels.length) query.set('labels', labels.join(','));
      const issues = await this.request<Issue[]>("GET", `${this.repoPath("issues")}?${query}`, undefined, signal);
      all.push(...issues.slice(0, limit));
      if (issues.length < limit) break;
    }
    return all.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }

  private async createFile(filePath: string, content: Uint8Array, message: string, signal?: AbortSignal): Promise<string> {
    const endpoint = `${this.repoPath("contents")}/${cleanPath(filePath)}`;
    try {
      const response = await this.request<{ commit: { sha: string } }>("POST", endpoint, {
        branch: this.branch,
        content: base64Encode(content),
        message,
      }, signal);
      return response.commit.sha;
    } catch (error) {
      if (!isUpstreamStatus(error, "Forgejo", 409) && !isUpstreamStatus(error, "Forgejo", 422)) throw error;
      const existing = await this.readProjectFileBytes(this.owner, this.repository, this.branch, filePath, signal);
      if (!equalBytes(existing, content)) throw workflowError("accepted specification artifact path already contains different content");
      return this.getProjectBranchHead(this.owner, this.repository, this.branch, signal);
    }
  }

  private repoPath(...parts: string[]): string {
    if (!this.repository) throw new Error('Forgejo repository scope is required');
    return `/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}${parts.length ? `/${parts.join("/")}` : ""}`;
  }

  private projectPath(owner: string, repository: string, ...parts: string[]): string {
    return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${parts.length ? `/${parts.join("/")}` : ""}`;
  }

  private async request<T>(method: string, endpoint: string, body?: unknown, signal?: AbortSignal, expectJson = true): Promise<T> {
    const response = await this.response(method, endpoint, body, signal);
    if (!expectJson || response.status === 204 || response.body === null) return undefined as T;
    return await response.json() as T;
  }

  private async paginated<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const limit = 50;
    const all: T[] = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.response('GET', `${path}${separator}limit=${limit}&page=${page}`, undefined, signal);
      const values = await response.json() as T[];
      all.push(...values);
      const total = totalCount(response.headers.get('x-total-count'));
      const link = response.headers.get('link');
      if (total !== null ? all.length >= total : link !== null ? !hasNextLink(link) : values.length < limit) return all;
    }
  }

  private async response(method: string, endpoint: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const headers = new Headers({ Accept: "application/json", Authorization: `token ${this.token}` });
    const init: RequestInit = { method, headers };
    if (signal !== undefined) init.signal = signal;
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(body);
    }
    const response = await fetchUpstream(this.fetch, `${this.baseUrl}${endpoint}`, init, {
      service: "Forgejo",
      timeoutMs: this.timeoutMs,
      retryTransient: true,
    });
    if (!response.ok) {
      throw await upstreamHttpError("Forgejo", response);
    }
    return response;
  }
}

function isFactoryImplementationProtection(protection: Record<string, unknown>, implementationUser: string): boolean {
  const signature: Record<string, unknown> = {
    enable_push: true,
    enable_push_whitelist: true,
    push_whitelist_usernames: [implementationUser],
    push_whitelist_teams: [],
    push_whitelist_deploy_keys: false,
    enable_merge_whitelist: false,
    enable_status_check: false,
    required_approvals: 0,
    enable_approvals_whitelist: false,
    block_on_rejected_reviews: false,
    block_on_official_review_requests: false,
    block_on_outdated_branch: false,
    dismiss_stale_approvals: false,
    ignore_stale_approvals: false,
    require_signed_commits: false,
    protected_file_patterns: '',
    unprotected_file_patterns: '',
    apply_to_admins: true,
  };
  return Object.entries(signature).every(([key, expected]) => {
    const actual = protection[key];
    return Array.isArray(expected)
      ? Array.isArray(actual) && actual.length === expected.length && expected.every((value) => actual.includes(value))
      : actual === expected;
  });
}

function assertCompatibleMainProtection(protection: BranchProtection, actors: { mergeActor: string; reviewActor: string }): void {
  const pushUsers = protection.push_whitelist_usernames ?? [];
  const mergeUsers = protection.merge_whitelist_usernames ?? [];
  const approvalUsers = protection.approvals_whitelist_username ?? [];
  if (protection.enable_push_whitelist === false || protection.enable_merge_whitelist === false
    || protection.enable_approvals_whitelist === false
    || (protection.push_whitelist_usernames !== undefined && !pushUsers.includes(actors.mergeActor))
    || (protection.merge_whitelist_usernames !== undefined && !mergeUsers.includes(actors.mergeActor))
    || (protection.approvals_whitelist_username !== undefined && !approvalUsers.includes(actors.reviewActor))) {
    throw workflowError('existing main branch protection is incompatible with Factory actors');
  }
}

function isLeastPrivilegeReadTeam(team: Team): boolean {
  if (team.permission !== 'read' || team.includes_all_repositories !== false || team.can_create_org_repo !== false) return false;
  const expected = new Set(['repo.code', 'repo.issues', 'repo.pulls', 'repo.releases']);
  const units = team.units_map;
  if (!units) return false;
  return Object.entries(units).every(([unit, permission]) => expected.has(unit) ? permission === 'read' : permission === 'none')
    && [...expected].every((unit) => units[unit] === 'read');
}

function isFactoryMainProtection(protection: Record<string, unknown>, actors: { mergeActor: string; reviewActor: string }): boolean {
  const signature: Record<string, unknown> = {
    enable_push: true,
    enable_push_whitelist: true,
    push_whitelist_usernames: [actors.mergeActor],
    push_whitelist_teams: [],
    push_whitelist_deploy_keys: false,
    enable_merge_whitelist: true,
    merge_whitelist_usernames: [actors.mergeActor],
    enable_status_check: true,
    status_check_contexts: ['factory/specification', 'factory/verification'],
    required_approvals: 1,
    enable_approvals_whitelist: true,
    approvals_whitelist_username: [actors.reviewActor],
    block_on_rejected_reviews: true,
    dismiss_stale_approvals: true,
    block_on_outdated_branch: true,
    apply_to_admins: true,
  };
  return Object.entries(signature).every(([key, expected]) => {
    const actual = protection[key];
    return Array.isArray(expected)
      ? Array.isArray(actual) && actual.length === expected.length && expected.every((value) => actual.includes(value))
      : actual === expected;
  });
}

function parseUpstream<T>(schema: z.ZodType<T>, value: unknown, contract: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Error(`Forgejo ${contract} API is incompatible: ${issue?.path.join('.') || 'response'} ${issue?.message || 'is invalid'}`);
}

function boardPage(cursor?: string): number {
  if (cursor === undefined) return 1;
  if (!/^[1-9]\d*$/.test(cursor)) throw new ApplicationError('bad_request', 400, 'invalid board cursor');
  const page = Number(cursor);
  if (!Number.isSafeInteger(page)) throw new ApplicationError('bad_request', 400, 'invalid board cursor');
  return page;
}

function totalCount(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const total = Number(value);
  return Number.isSafeInteger(total) ? total : null;
}

function hasNextLink(value: string): boolean {
  return value.split(',').some((part) => /;\s*rel="?next"?\s*$/.test(part.trim()));
}

export function validateSpecification(specification: RequirementSpec): void {
  if (!specification.goal.trim() || specification.acceptanceCriteria.length === 0) {
    throw new Error("goal and at least one acceptance criterion are required");
  }
}

export function toCard(issue: Issue): Card {
  let status: Status = "ideation";
  let acceptedActive = false;
  const labels = (issue.labels ?? []).map((label) => {
    if (label.name === "spec/accepted") acceptedActive = true;
    const candidate = label.name.startsWith("status/") ? label.name.slice("status/".length) : "";
    if (isStatus(candidate)) status = candidate;
    return label.name;
  });
  const card: Card = {
    number: issue.number,
    title: issue.title,
    body: visibleIssueBody(issue.body),
    url: issue.html_url,
    status,
    labels,
    author: issue.user.login,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    ...(findTeam(issue.body) ? { team: findTeam(issue.body)! } : {}),
    applications: findApplications(issue.body),
  };
  const factoryAssignee = findAssignee(issue.body);
  if (factoryAssignee) card.assignee = factoryAssignee;
  else if (issue.assignee) card.assignee = issue.assignee.login;
  try { card.proposal = findProposal(issue.body); } catch {}
  try {
    card.acceptance = findAccepted(issue.body);
    if (acceptedActive) card.acceptedSpecification = card.acceptance.specification;
  } catch {}
  try { card.interview = findInterview(issue.body); } catch {}
  return card;
}

export function visibleIssueBody(body: string): string {
  let cut = body.length;
  for (const marker of [`\n\n${interviewMarker}`, `\n\n${proposalMarker}`, "\n\n---\nCurrent accepted requirement: `", `\n\n${teamMarkerPrefix}`, `\n\n${applicationsMarker}`, `\n\n${assigneeMarker}`]) {
    const index = body.indexOf(marker);
    if (index >= 0 && index < cut) cut = index;
  }
  return body.slice(0, cut).trim();
}

export function toApplicationRefs(body: string): ApplicationRef[] {
  return findApplications(body);
}

export function applicationMarker(ids: string[]): string {
  return ids.length === 0 ? "" : `\n\n${applicationsMarker}${base64UrlEncodeJson(ids)} -->`;
}

export function teamMarker(team: string): string {
  if (!teamSlug(team)) throw new Error("a valid team is required");
  return `\n\n${teamMarkerPrefix}${base64UrlEncodeJson(team)} -->`;
}

export function findTeam(body: string): string | null {
  if (!body.includes(teamMarkerPrefix)) return null;
  const team = decodeMarker<unknown>(body, teamMarkerPrefix, "team");
  if (typeof team !== "string" || !teamSlug(team)) throw new Error("team is malformed");
  return team;
}

export function teamMarkerFragment(body: string): string {
  return markerFragment(body, `\n\n${teamMarkerPrefix}`);
}

export function factoryAssigneeMarker(username: string | null): string {
  return username ? `\n\n${assigneeMarker}${base64UrlEncodeJson(username)} -->` : "";
}

export function findAssignee(body: string): string | null {
  try {
    const value = decodeMarker<unknown>(body, assigneeMarker, "assignee");
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function assigneeMarkerFragment(body: string): string {
  return markerFragment(body, `\n\n${assigneeMarker}`);
}

export function findApplications(body: string): ApplicationRef[] {
  try {
    const ids = decodeMarker<unknown>(body, applicationsMarker, "applications");
    if (!Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === "string" && id !== "").map((id) => ({ id, name: id }));
  } catch {
    return [];
  }
}

export function findProposal(body: string): Proposal {
  let proposal: Proposal;
  try {
    proposal = decodeMarker<Proposal>(body, proposalMarker, "requirement proposal");
  } catch (error) {
    if (error instanceof Error && error.message === "requirement proposal not found") throw error;
    throw new Error("requirement proposal is malformed");
  }
  if (!proposal || typeof proposal !== "object" || !proposal.specification) throw new Error("requirement proposal is malformed");
  validateSpecification(proposal.specification);
  return proposal;
}

function workflowError(message: string): ApplicationError {
  return new ApplicationError('conflict', 409, message);
}

export function findAccepted(body: string): AcceptanceMetadata {
  let accepted: AcceptanceMetadata;
  try {
    accepted = decodeMarker<AcceptanceMetadata>(body, acceptedProjectionMarker, "accepted requirement");
  } catch (error) {
    if (error instanceof Error && error.message === "accepted requirement not found") throw error;
    throw new Error("accepted requirement is malformed");
  }
  try {
    if (!accepted || typeof accepted !== "object" || !accepted.specification) throw new Error();
    validateSpecification(accepted.specification);
  } catch {
    throw new Error("accepted requirement is malformed");
  }
  return accepted;
}

export function acceptedMarker(accepted: AcceptanceMetadata): string {
  return `\n\n---\nCurrent accepted requirement: \`${accepted.requirementId}\` revision \`${accepted.revision}\` (\`${accepted.digest}\`)\n\n${acceptedProjectionMarker}${base64UrlEncodeJson(accepted)} -->`;
}

export function proposalMarkerFragment(body: string): string {
  return markerFragment(body, `\n\n${proposalMarker}`);
}

export function acceptedMarkerFragment(body: string): string {
  const marker = "\n\n---\nCurrent accepted requirement: `";
  const start = body.lastIndexOf(marker);
  if (start < 0) return "";
  const projection = body.indexOf(acceptedProjectionMarker, start);
  if (projection >= 0) {
    const end = body.indexOf(" -->", projection);
    if (end >= 0) return body.slice(start, end + 4);
  }
  const lineStart = start + "\n\n---\n".length;
  const lineEnd = body.indexOf("\n", lineStart);
  return lineEnd >= 0 ? body.slice(start, lineEnd + 1) : body.slice(start);
}

export function applicationIds(body: string): string[] {
  return findApplications(body).map((application) => application.id);
}

function findRequirementId(body: string): string {
  const marker = "Current accepted requirement: `";
  const start = body.lastIndexOf(marker);
  if (start < 0) return "";
  const remaining = body.slice(start + marker.length);
  const end = remaining.indexOf("`");
  return end < 0 ? "" : remaining.slice(0, end);
}

function markerFragment(body: string, marker: string): string {
  const start = body.lastIndexOf(marker);
  if (start < 0) return "";
  const end = body.indexOf(" -->", start);
  return end < 0 ? "" : body.slice(start, end + 4);
}

function decodeMarker<T>(body: string, marker: string, name: string): T {
  const start = body.lastIndexOf(marker);
  if (start < 0) throw new Error(`${name} not found`);
  const remaining = body.slice(start + marker.length);
  const end = remaining.indexOf(" -->");
  if (end < 0) throw new Error(`${name} is malformed`);
  try {
    return JSON.parse(base64UrlDecode(remaining.slice(0, end))) as T;
  } catch {
    throw new Error(`${name} is malformed`);
  }
}

function isStatus(value: string): value is Status {
  return (statuses as readonly string[]).includes(value);
}

function teamSlug(value: string): boolean {
  return /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(value);
}

function requiredLabel(labels: Map<string, Label>, name: string): Label {
  const label = labels.get(name);
  if (!label) throw new Error(`Forgejo did not return label ${JSON.stringify(name)}`);
  return label;
}

function acceptanceResult(acceptance: AcceptanceMetadata): AcceptanceResult {
  return {
    requirementId: acceptance.requirementId,
    revision: acceptance.revision,
    digest: acceptance.digest,
    path: acceptance.path,
    commitSha: acceptance.commitSha,
  };
}

function sameSpecification(left: RequirementSpec, right: RequirementSpec): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIssueVersion(left: Issue, right: Issue): boolean {
  return sameInstant(left.updated_at, right.updated_at);
}

function sameLabelIds(labels: Label[], ids: number[]): boolean {
  const current = labels.map((label) => label.id).sort((left, right) => left - right);
  const wanted = [...ids].sort((left, right) => left - right);
  return current.length === wanted.length && current.every((id, index) => id === wanted[index]);
}

function hasLabels(issue: Issue, ...names: string[]): boolean {
  const labels = new Set(issue.labels.map((label) => label.name));
  return names.every((name) => labels.has(name));
}

function sameInstant(left: string, right: string | Date): boolean {
  return instantKey(left) === instantKey(right);
}

function formatRFC3339(value: Date): string {
  return `${value.toISOString().slice(0, 19)}Z`;
}

function instantKey(value: string | Date): string {
  if (value instanceof Date) {
    return `${Math.floor(value.getTime() / 1000)}:${String((value.getTime() % 1000) * 1_000_000).padStart(9, "0")}`;
  }
  const match = value.match(/^(.*?:\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return `invalid:${value}`;
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(seconds)) return `invalid:${value}`;
  return `${Math.floor(seconds / 1000)}:${(match[2] ?? "").padEnd(9, "0")}`;
}

function formatRevision(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 19).replaceAll(":", "")}.${iso.slice(20, 23)}000000Z`;
}

function cleanPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify(value))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(standard);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function base64Encode(value: Uint8Array): string {
  let result = "";
  for (let index = 0; index < value.length; index += 0x8000) {
    result += String.fromCharCode(...value.subarray(index, index + 0x8000));
  }
  return btoa(result);
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

interface Snapshot {
  schema_version: number;
  requirement_id: string;
  revision: string;
  title: string;
  status: string;
  accepted_at: string;
  accepted_by: string;
  issue: string;
  specification: RequirementSpec;
}

const snapshotSpecificationSchema = z.object({
  goal: z.string(),
  users: z.array(z.string()),
  user_stories: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  non_functional_requirements: z.array(z.string()),
  moscow: z.object({ must: z.array(z.string()), should: z.array(z.string()), could: z.array(z.string()) }),
  open_questions: z.array(z.string()),
  non_goals: z.array(z.string()),
});

const acceptedSnapshotSchema = z.object({
  schema_version: z.literal(1),
  requirement_id: z.string(),
  revision: z.string(),
  title: z.string(),
  status: z.literal("accepted"),
  accepted_at: z.string(),
  accepted_by: z.string(),
  issue: z.string(),
  specification: snapshotSpecificationSchema,
});

type AcceptedSnapshot = z.infer<typeof acceptedSnapshotSchema>;

function fromSnapshotSpecification(specification: AcceptedSnapshot["specification"]): RequirementSpec {
  return {
    goal: specification.goal,
    users: specification.users,
    userStories: specification.user_stories,
    acceptanceCriteria: specification.acceptance_criteria,
    nonFunctionalRequirements: specification.non_functional_requirements,
    moscow: specification.moscow,
    openQuestions: specification.open_questions,
    nonGoals: specification.non_goals,
  };
}

function encodeSnapshotYaml(snapshot: Snapshot): Uint8Array {
  const specification = snapshot.specification;
  const lines = [
    `schema_version: ${snapshot.schema_version}`,
    `requirement_id: ${yamlScalar(snapshot.requirement_id)}`,
    `revision: ${yamlScalar(snapshot.revision)}`,
    `title: ${yamlScalar(snapshot.title)}`,
    `status: ${yamlScalar(snapshot.status)}`,
    `accepted_at: ${yamlScalar(snapshot.accepted_at)}`,
    `accepted_by: ${yamlScalar(snapshot.accepted_by)}`,
    `issue: ${yamlScalar(snapshot.issue)}`,
    "specification:",
    `    goal: ${yamlScalar(specification.goal)}`,
    ...yamlList("    users", specification.users),
    ...yamlList("    user_stories", specification.userStories),
    ...yamlList("    acceptance_criteria", specification.acceptanceCriteria),
    ...yamlList("    non_functional_requirements", specification.nonFunctionalRequirements),
    "    moscow:",
    ...yamlList("        must", specification.moscow.must),
    ...yamlList("        should", specification.moscow.should),
    ...yamlList("        could", specification.moscow.could),
    ...yamlList("    open_questions", specification.openQuestions),
    ...yamlList("    non_goals", specification.nonGoals),
  ];
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

function yamlList(key: string, values: string[]): string[] {
  if (values.length === 0) return [`${key}: []`];
  return [`${key}:`, ...values.map((value) => `${" ".repeat(key.length - key.trimStart().length + 4)}- ${yamlScalar(value)}`)];
}

function yamlScalar(value: string): string {
  if (value !== "" && /^[A-Za-z0-9_./# -]+$/.test(value) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(value)
    && !/^(?:null|true|false|yes|no|on|off|~)$/i.test(value) && !/^\d/.test(value) && !value.endsWith(" ")) return value;
  return JSON.stringify(value);
}
