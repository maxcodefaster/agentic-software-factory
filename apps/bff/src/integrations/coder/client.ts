/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import {
  pathEscape,
  type ChatQuestion,
  type ImplementationChatInput,
  type ImplementationChatBinding,
  type ImplementationChatReconciliation,
  implementationChatBinding,
  type RequirementsChatInput,
  type RequirementsChatResult,
  CoderChatClient,
} from "./chat.ts";
import { coderWorkspaceName } from '../../applications/catalog';
import type { WorkspaceContract } from '../../applications/devcontainer';
import { UpstreamHttpError, UpstreamTimeoutError } from '../fetch';
import { z } from 'zod';

// Coder does not expose chat:* as a user-creatable token scope.
const CHAT_SCOPES = ['coder:all'] as const;
const EXTERNAL_AUTH_SCOPES = ['user:read_personal', 'user:update_personal'] as const;
const TOKEN_CLEANUP_TIMEOUT_MS = 5_000;

export type {
  ChatCapability,
  ChatQuestion,
  ChatQuestionOption,
  CoderClientOptions,
  FetchFunction,
  RequirementsChatInput,
  RequirementsChatResult,
  ImplementationChatInput,
  SleepFunction,
} from "./chat.ts";

export interface CoderWorkspace {
  id: string;
  name: string;
  owner: string;
  template: string;
  status: string;
  transition: string;
  healthy: boolean;
  outdated: boolean;
  lastUsedAt: string;
  url?: string;
  chatUrl?: string;
  ideUrl?: string;
  terminalUrl?: string;
  apps: CoderWorkspaceApp[];
  parameters: Record<string, string>;
}

export interface CoderWorkspaceApp {
  slug: string;
  displayName: string;
  url: string;
  health: 'healthy' | 'initializing' | 'unhealthy' | 'disabled';
}

type WorkspaceKind = 'developer' | 'staging' | 'verification';

export interface CoderRepositoryRefResolver {
  resolve(repositoryUrl: string, branch: string, signal?: AbortSignal): Promise<string>;
  workspaceContract(repositoryUrl: string, repositoryRef: string, kind: WorkspaceKind, signal?: AbortSignal): Promise<WorkspaceContract>;
}

export interface CoderSummary {
  count: number;
  workspaces: CoderWorkspace[];
  available: boolean;
}

export interface CoderUserIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  username: string;
}

export interface CoderUserBindingStore {
  findByFactoryUserId(factoryUserId: string): Promise<{ coderUserId: string } | null>;
  bind(input: { factoryUserId: string; coderUserId: string }): Promise<void>;
  findByCoderUserId(coderUserId: string): Promise<{ factoryUserId: string } | null>;
}

interface WorkspaceEnvelope {
  count: number;
  workspaces: WorkspaceResponse[];
}

interface WorkspaceResponse {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  organization_id: string;
  template_display_name: string;
  template_name: string;
  outdated: boolean;
  last_used_at: string;
  health: {
    healthy: boolean;
  };
  latest_build: {
    id?: string;
    template_version_id?: string;
    status: string;
    transition: string;
    resources?: Array<{
      agents?: Array<{
        id?: string;
        parent_id?: string | null;
        name: string;
        status: string;
        display_apps?: string[];
        apps?: Array<{
          slug: string;
          display_name: string;
          external: boolean;
          url: string;
          subdomain: boolean;
          subdomain_name?: string;
          health: string;
           command?: string;
          sharing_level?: string;
        }>;
      }>;
    }>;
  };
}

const workspaceResponseSchema = z.object({
  id: z.string(), name: z.string(), owner_id: z.string(), owner_name: z.string(), organization_id: z.string(),
  template_display_name: z.string(), template_name: z.string(), outdated: z.boolean(), last_used_at: z.string(),
  health: z.object({ healthy: z.boolean() }).passthrough(),
  latest_build: z.object({
    id: z.string().optional(), template_version_id: z.string().optional(), status: z.string(), transition: z.string(),
    resources: z.array(z.object({ agents: z.array(z.object({
      id: z.string().optional(), parent_id: z.string().nullable().optional(), name: z.string(), status: z.string(),
      display_apps: z.array(z.string()).optional(), apps: z.array(z.object({
        slug: z.string(), display_name: z.string(), external: z.boolean(), url: z.string(), subdomain: z.boolean(),
        subdomain_name: z.string().optional(), health: z.string(), command: z.string().optional(), sharing_level: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough()).optional() }).passthrough()).optional(),
  }).passthrough(),
}).passthrough();

interface WorkspaceBuildParameter { name: string; value: string }

interface UserRolesResponse {
  roles: string[];
  organization_roles: Record<string, string[]>;
}

interface CoderUser {
  id: string;
  username: string;
  name: string;
  email: string;
  login_type: string;
  status: string;
  organization_ids: string[];
  is_service_account?: boolean;
}

interface UsersResponse { count: number; users: CoderUser[] }
interface GeneratedKey { key: string }
interface ApiKey { id: string; token_name?: string }
interface CoderOrganization { id: string; name?: string; is_default: boolean }
interface CoderTemplate { id: string; active_version_id: string; deprecated: boolean; deleted: boolean }
interface WorkspaceBuild { id: string; job: { status: string; error?: string } }

export class CoderClient extends CoderChatClient {
  private readonly lifecycleSleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private userBindings?: CoderUserBindingStore;
  private organizationName = "default";
  private templateName = "agentic-software-factory";
  private workspaceNamespace = "";
  private tenantId = "factory";
  private repositoryRefs?: CoderRepositoryRefResolver;
  private verificationOwnerId = "";
  private verificationOwnerUsername = "";
  private stagingOwnerId = "";
  private stagingOwnerUsername = "";
  private organizationId?: string;

  constructor(options: import('./chat').CoderClientOptions) {
    super(options);
    this.lifecycleSleep = (milliseconds, signal) => abortableSleep(options.sleep, milliseconds, signal);
  }

  configureVerificationOwner(id: string, username: string): this {
    this.verificationOwnerId = id;
    this.verificationOwnerUsername = username;
    return this;
  }

  configureStagingOwner(id: string, username: string): this {
    this.stagingOwnerId = id;
    this.stagingOwnerUsername = username;
    return this;
  }

  configureUserBindings(userBindings: CoderUserBindingStore, organizationName: string, templateName = "agentic-software-factory", workspaceNamespace = ""): this {
    this.userBindings = userBindings;
    this.organizationName = organizationName;
    this.tenantId = organizationName;
    this.templateName = templateName;
    this.workspaceNamespace = workspaceNamespace;
    return this;
  }

  configureTenant(tenantId: string): this {
    this.tenantId = tenantId;
    return this;
  }

  configureRepositoryRefs(repositoryRefs: CoderRepositoryRefResolver): this {
    this.repositoryRefs = repositoryRefs;
    return this;
  }

  async reconcileFactoryMcpConfiguration(signal?: AbortSignal): Promise<void> {
    await this.reconcileFactoryMcp(await this.configuredOrganization(signal), signal);
  }
  async startRequirementsChatFor(identity: CoderUserIdentity, input: RequirementsChatInput, signal?: AbortSignal): Promise<RequirementsChatResult> {
    this.requireVerifiedIdentity(identity);
    const organizationId = await this.configuredOrganization(signal);
    return this.withUserToken(identity, 10 * 60, (token) => this.startRequirementsChat({ ...input, organizationId }, signal, token), signal);
  }

  async interviewCapabilityFor(identity: CoderUserIdentity, signal?: AbortSignal) {
    try {
      this.requireVerifiedIdentity(identity);
      const organizationId = await this.configuredOrganization(signal);
      const global = await this.chatCapabilityForOrganization(organizationId, signal);
      if (!global.available) return global;
      const user = await this.resolveUser(identity, signal);
      if (!user.organization_ids.includes(organizationId)) return { available: false, reason: "User is outside the configured Coder organization" };
      return this.withMappedUserToken(user, 60, async (token) => {
        const response = await this.request<{ models: Array<{ enabled: boolean; is_default: boolean }> }>(
          "GET", `/api/v2/organizations/${pathEscape(organizationId)}/chats/models`, undefined, 200, signal, token,
        );
        const defaults = response.models.filter((model) => model.enabled && model.is_default);
        return defaults.length === 1
          ? { available: true }
          : { available: false, reason: defaults.length === 0 ? "No default Coder Agent model is available to this user" : "More than one default Coder Agent model is available to this user" };
      }, signal);
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : "Coder interview access is unavailable" };
    }
  }

  async summaryForIdentity(identity: CoderUserIdentity, signal?: AbortSignal, ensureAccess = false): Promise<CoderSummary> {
    this.requireVerifiedIdentity(identity);
    const user = await this.resolveMappedUser(identity, signal);
    if (!user) return { count: 0, workspaces: [], available: true };
    if (ensureAccess) await this.ensureAgentsAccess(user, signal);
    return this.summary(user.username, signal);
  }

  async developmentToolsFor(identity: CoderUserIdentity, signal?: AbortSignal): Promise<{
    coderIdentity: boolean;
    forgejoConnected: boolean;
    forgejoUsername: string | null;
    connectUrl: string;
  }> {
    const user = await this.resolveUser(identity, signal);
    return this.withMappedUserToken(user, 5 * 60, async (token) => {
      await this.refreshExternalAuth(token, signal);
      const external = await this.request<{
        authenticated: boolean;
        user?: { login?: string } | null;
      }>('GET', '/api/v2/external-auth/forgejo', undefined, 200, signal, token).catch(() => ({ authenticated: false, user: null }));
      return {
        coderIdentity: true,
        forgejoConnected: external.authenticated,
        forgejoUsername: external.user?.login ?? null,
        connectUrl: `${this.publicUrl}/external-auth/forgejo`,
      };
    }, signal, false, EXTERNAL_AUTH_SCOPES);
  }

  async attestVerificationWorkspaceFor(identity: CoderUserIdentity, workspaceId: string, input: { repositoryUrl: string; branch: string; headSha: string; templateName: string; workspaceNamespace: string; templateVersionId?: string }, signal?: AbortSignal): Promise<CoderWorkspace> {
    assertGitSha(input.headSha);
    const requester = await this.resolveUser(identity, signal);
    const organizationId = await this.configuredOrganization(signal);
    if (!requester.organization_ids.includes(organizationId)) throw new Error("requester is outside the configured Coder organization");
    let workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    const owner = await this.verificationOwner(organizationId, signal);
    if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId) || !workspace.name.startsWith("verification-") || !workspace.latest_build.id) throw new Error("verification workspace escaped tenant scope");
    const parameters = await this.request<WorkspaceBuildParameter[]>("GET", `/api/v2/workspacebuilds/${pathEscape(workspace.latest_build.id)}/parameters`, undefined, 200, signal);
    const values = Object.fromEntries(parameters.map((item) => [item.name, item.value]));
    const template = await this.activeTemplate(organizationId, input.templateName, 'verification', signal);
    const templateVersionId = input.templateVersionId ?? template.active_version_id;
    const expected = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'verification', input.workspaceNamespace, signal);
    const startupTimeout = startupTimeoutSeconds(expected);
    if (workspace.template_name !== input.templateName || !matchesParameters(values, expected) || workspace.latest_build.template_version_id !== templateVersionId) throw new Error("verification workspace attestation failed");
    await this.waitForBuild(workspace.latest_build.id, signal, startupTimeout);
    workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId) || !workspace.latest_build.id) throw new Error("verification workspace escaped tenant scope");
    const currentValues = await this.buildParameters(workspace.latest_build.id, signal);
    if (workspace.template_name !== input.templateName || !matchesParameters(currentValues, expected) || workspace.latest_build.template_version_id !== templateVersionId) throw new Error("verification workspace attestation failed");
    return this.waitForHealthyVerification(workspaceId, owner, organizationId, input.templateName, templateVersionId, expected, startupTimeout, signal);
  }

  async answerRequirementsChatFor(identity: CoderUserIdentity, chatId: string, previousQuestionId: string, answer: string, questionNumber: number, operationId: string, signal?: AbortSignal): Promise<ChatQuestion | null> {
    return this.withUserToken(identity, 10 * 60, (token) => this.answerRequirementsChat(chatId, previousQuestionId, answer, questionNumber, operationId, signal, token), signal);
  }

  async sharpenRequirementsChatFor(identity: CoderUserIdentity, chatId: string, note: string, previousQuestionId: string, signal?: AbortSignal): Promise<ChatQuestion | null> {
    return this.withUserToken(identity, 10 * 60, (token) => this.sharpenRequirementsChat(chatId, note, previousQuestionId, signal, token), signal);
  }

  async submitRequirementsProposalFor(identity: CoderUserIdentity, binding: { teamId: string; repository: string; requirementNumber: number; runId: string; chatId: string; proposalNonce: string }, operationId: string, signal?: AbortSignal): Promise<void> {
    return this.withUserToken(identity, 10 * 60, async (token) => {
      await this.submitRequirementsProposal(binding, operationId, signal, token);
    }, signal);
  }

  async startImplementationChatFor(identity: CoderUserIdentity, input: ImplementationChatInput, signal?: AbortSignal): Promise<{ chatId: string }> {
    this.requireVerifiedIdentity(identity);
    const organizationId = await this.configuredOrganization(signal);
    const user = await this.resolveUser(identity, signal);
    const binding = implementationChatBinding(input);
    const existing = await this.withMappedUserToken(user, 60, (token) => this.reconcileImplementationChat(binding, signal, token), signal);
    if (existing.status === 'found') return { chatId: existing.chatId };
    if (existing.status === 'duplicate') throw new Error(`multiple Coder chats match implementation operation ${binding.operationId}: ${existing.chatIds.join(', ')}`);
    signal?.throwIfAborted();
    await this.expireDurableChatTokens(user.id, binding.operationId);
    return this.withDurableChatToken(user, binding.operationId, (token) => this.startImplementationChat({ ...input, organizationId }, signal, token), signal);
  }

  async reconcileImplementationChatFor(identity: CoderUserIdentity, binding: ImplementationChatBinding, signal?: AbortSignal): Promise<ImplementationChatReconciliation> {
    this.requireVerifiedIdentity(identity);
    return this.withUserToken(identity, 10 * 60, (token) => this.reconcileImplementationChat(binding, signal, token), signal);
  }

  async activeTemplateVersionId(templateName: string, signal?: AbortSignal): Promise<string> {
    const organizationId = await this.configuredOrganization(signal);
    return (await this.activeTemplate(organizationId, templateName, 'workspace', signal)).active_version_id;
  }

  async implementationChatStatusFor(identity: CoderUserIdentity, chatId: string, signal?: AbortSignal) {
    const user = await this.resolveUser(identity, signal);
    return this.implementationChatStatusForUser(user, chatId, signal, false);
  }

  async implementationChatStatusForFactoryUser(factoryUserId: string, chatId: string, signal?: AbortSignal) {
    const mapping = await this.userBindings?.findByFactoryUserId(factoryUserId);
    if (!mapping) throw new Error('Coder user binding is not configured for the implementation actor');
    const user = await this.mappedUser(mapping.coderUserId, signal, true);
    return this.implementationChatStatusForUser(user, chatId, signal, true);
  }

  private async implementationChatStatusForUser(user: CoderUser, chatId: string, signal: AbortSignal | undefined, requireCleanup: boolean) {
    const status = await this.withMappedUserToken(user, 10 * 60, (token) => this.implementationChatStatus(chatId, signal, token), signal);
    if (status.operationId && ['waiting', 'error'].includes(status.status)) {
      const cleanup = this.expireDurableChatTokens(user.id, status.operationId);
      if (requireCleanup) await cleanup;
      else await cleanup.catch(() => undefined);
    }
    return status;
  }

  async continueImplementationChatFor(identity: CoderUserIdentity, chatId: string, instruction: string, signal?: AbortSignal): Promise<void> {
    const user = await this.resolveUser(identity, signal);
    const status = await this.withMappedUserToken(user, 60, (token) => this.implementationChatStatus(chatId, signal, token), signal);
    if (!status.operationId) throw new Error('implementation Chat authority binding is missing');
    signal?.throwIfAborted();
    if (['waiting', 'error'].includes(status.status)) await this.expireDurableChatTokens(user.id, status.operationId);
    return this.withDurableChatToken(user, status.operationId, (token) => this.continueImplementationChat(chatId, instruction, signal, token), signal);
  }

  async ensureVerificationWorkspaceFor(identity: CoderUserIdentity, input: {
    repositoryUrl: string; branch: string; headSha: string; pullNumber: number; templateName: string; workspaceNamespace: string; templateVersionId?: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    assertGitSha(input.headSha);
    const requester = await this.resolveUser(identity, signal);
    const organizationId = await this.configuredOrganization(signal);
    if (!requester.organization_ids.includes(organizationId)) throw new Error("requester is outside the configured Coder organization");
    const owner = await this.verificationOwner(organizationId, signal);
    const template = await this.request<CoderTemplate>("GET", `/api/v2/organizations/${pathEscape(organizationId)}/templates/${pathEscape(input.templateName)}`, undefined, 200, signal);
    if (template.deprecated || template.deleted) throw new Error("Coder verification template is unavailable");
    const templateVersionId = input.templateVersionId ?? template.active_version_id;
    const name = coderWorkspaceName('verification', `${input.repositoryUrl}#${input.pullNumber}@${input.headSha}`);
    const richParameterValues = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'verification', input.workspaceNamespace, signal);
    const startupTimeout = provisioningTimeoutSeconds(richParameterValues);
    let workspace = await this.workspaceByName(owner.id, name, signal);
    let created = false;
    if (!workspace) {
      workspace = await this.request<WorkspaceResponse>("POST", `/api/v2/users/${pathEscape(owner.id)}/workspaces`, {
        template_version_id: templateVersionId,
        name,
        ttl_ms: 4 * 60 * 60 * 1000,
        automatic_updates: "never",
        rich_parameter_values: richParameterValues,
      }, 201, signal);
      created = true;
    }
    if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId)) throw new Error("verification workspace escaped tenant scope");
    this.assertWorkspaceTemplate(workspace, input.templateName, 'verification');
    if (created) {
      if (!workspace.latest_build.id) throw new Error("verification workspace has no build");
      await this.waitForBuild(workspace.latest_build.id, signal, startupTimeout);
      workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspace.id)}`, undefined, 200, signal);
    }
    const parameters = workspace.latest_build.id
      ? await this.request<WorkspaceBuildParameter[]>("GET", `/api/v2/workspacebuilds/${pathEscape(workspace.latest_build.id)}/parameters`, undefined, 200, signal)
      : [];
    let values = Object.fromEntries(parameters.map((item) => [item.name, item.value]));
    if (!matchesWorkspaceScope(values, input.repositoryUrl, 'verification', input.workspaceNamespace)) {
      throw new Error("existing verification workspace escaped tenant scope");
    }
    if (values.repository_ref !== input.headSha) {
      throw new Error("existing verification workspace parameters do not match the requested SHA");
    }
    if (!matchesWorkspaceBuild(workspace, values, templateVersionId, richParameterValues)) {
      await this.restartWorkspace(workspace, templateVersionId, richParameterValues, signal, startupTimeout);
      workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspace.id)}`, undefined, 200, signal);
      values = await this.buildParameters(workspace.latest_build.id!, signal);
    } else if (workspace.latest_build.id) await this.waitForBuild(workspace.latest_build.id, signal, startupTimeout);
    return this.verificationWorkspaceById(workspace.id, {
      repositoryUrl: input.repositoryUrl,
      headSha: input.headSha,
      templateName: input.templateName,
      workspaceNamespace: input.workspaceNamespace,
      templateVersionId,
    }, signal);
  }

  async ensureStagingWorkspace(input: {
    repositoryUrl: string; repositoryRef: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    assertGitSha(input.repositoryRef);
    const organizationId = await this.configuredOrganization(signal);
    const owner = await this.stagingOwner(organizationId, signal);
    const template = await this.activeTemplate(organizationId, input.templateName, 'staging', signal);
    const name = coderWorkspaceName('staging', input.repositoryUrl);
    const richParameterValues = await this.workspaceParameters(input.repositoryUrl, input.repositoryRef, 'staging', input.workspaceNamespace, signal);
    const startupTimeout = provisioningTimeoutSeconds(richParameterValues);
    let workspace = await this.workspaceByName(owner.id, name, signal);
    if (!workspace) {
      workspace = await this.request<WorkspaceResponse>('POST', `/api/v2/users/${pathEscape(owner.id)}/workspaces`, {
        template_version_id: template.active_version_id,
        name,
        ttl_ms: 0,
        automatic_updates: 'never',
        rich_parameter_values: richParameterValues,
      }, 201, signal);
      if (!workspace.latest_build.id) throw new Error('staging workspace has no build');
      await this.waitForBuild(workspace.latest_build.id, signal, startupTimeout);
    } else {
      this.assertAutomationWorkspace(workspace, owner, organizationId, input.repositoryUrl);
      this.assertWorkspaceTemplate(workspace, input.templateName, 'staging');
      const values = workspace.latest_build.id ? await this.buildParameters(workspace.latest_build.id, signal) : {};
      if (!matchesWorkspaceScope(values, input.repositoryUrl, 'staging', input.workspaceNamespace)) {
        throw new Error('existing staging workspace escaped tenant scope');
      }
      if (!matchesWorkspaceBuild(workspace, values, template.active_version_id, richParameterValues)) {
        await this.restartWorkspace(workspace, template.active_version_id, richParameterValues, signal, startupTimeout);
      }
    }
    const healthy = await this.waitForHealthyStaging(workspace.id, input.repositoryUrl, owner, organizationId, input.templateName, template.active_version_id, richParameterValues, startupTimeout, signal);
    if (healthy) return healthy;
    throw new Error(`staging workspace did not become healthy within ${startupTimeout} seconds`);
  }

  async stagingWorkspaceById(workspaceId: string, input: {
    repositoryUrl: string; repositoryRef: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const organizationId = await this.configuredOrganization(signal);
    const owner = await this.stagingOwner(organizationId, signal);
    const template = await this.activeTemplate(organizationId, input.templateName, 'staging', signal);
    const expected = await this.workspaceParameters(input.repositoryUrl, input.repositoryRef, 'staging', input.workspaceNamespace, signal);
    const workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    if (workspace.latest_build.id) await this.waitForBuild(workspace.latest_build.id, signal);
    return this.readStagingWorkspace(workspaceId, input.repositoryUrl, owner, organizationId, input.templateName, template.active_version_id, expected, signal);
  }

  private async waitForHealthyStaging(
    workspaceId: string,
    repositoryUrl: string,
    owner: CoderUser,
    organizationId: string,
    templateName: string,
    templateVersionId: string,
    expected: WorkspaceBuildParameter[],
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<CoderWorkspace | null> {
    const deadline = Date.now() + timeoutSeconds * 1_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const projected = await this.readStagingWorkspace(workspaceId, repositoryUrl, owner, organizationId, templateName, templateVersionId, expected, signal);
      if (projected.healthy && projected.apps.every((app) => app.health === 'healthy')) return projected;
      await this.lifecycleSleep(1_000, signal);
    }
    return null;
  }

  private async readStagingWorkspace(
    workspaceId: string,
    repositoryUrl: string,
    owner: CoderUser,
    organizationId: string,
    templateName: string,
    templateVersionId: string,
    expected: WorkspaceBuildParameter[],
    signal?: AbortSignal,
  ): Promise<CoderWorkspace> {
    const workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    this.assertAutomationWorkspace(workspace, owner, organizationId, repositoryUrl);
    this.assertWorkspaceTemplate(workspace, templateName, 'staging');
    if (!workspace.latest_build.id) throw new Error('staging workspace has no build');
    const parameters = await this.buildParameters(workspace.latest_build.id, signal);
    if (!matchesParameters(parameters, expected) || workspace.latest_build.template_version_id !== templateVersionId) {
      throw new Error('staging workspace attestation failed');
    }
    return this.toWorkspace(workspace, parameters, false, 'shared');
  }

  async verificationWorkspaceById(workspaceId: string, input: {
    repositoryUrl: string; headSha: string; templateName: string; workspaceNamespace: string; templateVersionId?: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    assertGitSha(input.headSha);
    const organizationId = await this.configuredOrganization(signal);
    let workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    const owner = await this.verificationOwner(organizationId, signal);
    if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId) || !workspace.name.startsWith("verification-") || !workspace.latest_build.id) throw new Error("verification workspace escaped tenant scope");
    this.assertWorkspaceTemplate(workspace, input.templateName, 'verification');
    const template = await this.activeTemplate(organizationId, input.templateName, 'verification', signal);
    const templateVersionId = input.templateVersionId ?? template.active_version_id;
    const expected = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'verification', input.workspaceNamespace, signal);
    const startupTimeout = startupTimeoutSeconds(expected);
    let parameters = await this.buildParameters(workspace.latest_build.id, signal);
    if (!matchesParameters(parameters, expected)
      || workspace.latest_build.template_version_id !== templateVersionId) throw new Error("verification workspace attestation failed");
    await this.waitForBuild(workspace.latest_build.id, signal, startupTimeout);
    workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId) || !workspace.latest_build.id) throw new Error("verification workspace escaped tenant scope");
    parameters = await this.buildParameters(workspace.latest_build.id, signal);
    if (!matchesParameters(parameters, expected)
      || workspace.template_name !== input.templateName || workspace.latest_build.template_version_id !== templateVersionId) throw new Error("verification workspace attestation failed");
    return this.waitForHealthyVerification(workspaceId, owner, organizationId, input.templateName, templateVersionId, expected, startupTimeout, signal);
  }

  private async waitForHealthyVerification(
    workspaceId: string, owner: CoderUser, organizationId: string,
    templateName: string, templateVersionId: string, expected: WorkspaceBuildParameter[], timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<CoderWorkspace> {
    const deadline = Date.now() + timeoutSeconds * 1_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
      if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId) || !workspace.latest_build.id) throw new Error('verification workspace escaped tenant scope');
      this.assertWorkspaceTemplate(workspace, templateName, 'verification');
      const parameters = await this.buildParameters(workspace.latest_build.id, signal);
      if (!matchesParameters(parameters, expected) || workspace.latest_build.template_version_id !== templateVersionId) throw new Error('verification workspace attestation failed');
      const projected = this.toWorkspace(workspace, parameters, false);
      if (projected.healthy && projected.apps.every((app) => app.health === 'healthy')) return projected;
      await this.lifecycleSleep(1_000, signal);
    }
    throw new Error(`verification workspace apps did not become healthy within ${timeoutSeconds} seconds`);
  }

  async ensureDeveloperWorkspaceFor(identity: CoderUserIdentity, input: {
    repositoryUrl: string; defaultBranch: string; repositoryOwner?: string; repositoryName?: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const repositoryRef = await this.resolveRepositoryRef(input.repositoryUrl, input.defaultBranch, signal);
    const owner = await this.resolveUser(identity, signal);
    await this.ensureAgentsAccess(owner, signal);
    const organizationId = await this.configuredOrganization(signal);
    if (!owner.organization_ids.includes(organizationId)) throw new Error("requester is outside the configured Coder organization");
    const template = await this.activeTemplate(organizationId, input.templateName, "developer", signal);
    const name = coderWorkspaceName('main', input.repositoryUrl);
    const richParameterValues = await this.workspaceParameters(input.repositoryUrl, repositoryRef, 'developer', input.workspaceNamespace, signal);
    let workspace = await this.workspaceByName(owner.id, name, signal);
    let created = false;
    if (!workspace) {
      await this.requireForgejoConnection(owner, signal);
      workspace = await this.request<WorkspaceResponse>("POST", `/api/v2/users/${pathEscape(owner.id)}/workspaces`, {
        template_version_id: template.active_version_id,
        name,
        automatic_updates: "never",
        rich_parameter_values: richParameterValues,
      }, 201, signal);
      created = true;
    }
    this.assertWorkspaceOwner(workspace, owner, organizationId, "developer");
    this.assertWorkspaceTemplate(workspace, input.templateName, "developer");
    const values = workspace.latest_build.id ? await this.buildParameters(workspace.latest_build.id, signal) : {};
    this.assertWorkspaceScope(values, input.repositoryUrl, 'developer', input.workspaceNamespace);
    if (created) {
      if (!workspace.latest_build.id) throw new Error("developer workspace has no build");
      await this.waitForBuild(workspace.latest_build.id, signal);
      workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspace.id)}`, undefined, 200, signal);
      const currentValues = await this.buildParameters(workspace.latest_build.id!, signal);
      return this.toWorkspace(workspace, currentValues, await this.chatAllowed(owner.username, signal));
    }
    if (matchesWorkspaceBuild(workspace, values, template.active_version_id, richParameterValues)) {
      return this.toWorkspace(workspace, values, await this.chatAllowed(owner.username, signal));
    } else {
      await this.restartWorkspace(workspace, template.active_version_id, richParameterValues, signal);
    }
    workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspace.id)}`, undefined, 200, signal);
    const currentValues = await this.buildParameters(workspace.latest_build.id!, signal);
    return this.toWorkspace(workspace, currentValues, await this.chatAllowed(owner.username, signal));
  }

  async rebuildDeveloperWorkspaceFor(identity: CoderUserIdentity, workspaceId: string, input: {
    repositoryUrl: string; branch: string; repositoryRef?: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const repositoryRef = input.repositoryRef ?? await this.resolveRepositoryRef(input.repositoryUrl, input.branch, signal);
    assertGitSha(repositoryRef);
    const owner = await this.resolveUser(identity, signal);
    const organizationId = await this.configuredOrganization(signal);
    const workspace = await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    this.assertWorkspaceOwner(workspace, owner, organizationId, "developer");
    this.assertWorkspaceTemplate(workspace, input.templateName, "developer");
    if (!workspace.latest_build.id) throw new Error("developer workspace has no build");
    const values = await this.buildParameters(workspace.latest_build.id, signal);
    this.assertWorkspaceScope(values, input.repositoryUrl, 'developer', input.workspaceNamespace);
    const template = await this.activeTemplate(organizationId, input.templateName, "developer", signal);
    const richParameterValues = await this.workspaceParameters(input.repositoryUrl, repositoryRef, 'developer', input.workspaceNamespace, signal);
    if (matchesWorkspaceBuild(workspace, values, template.active_version_id, richParameterValues)) {
      await this.waitForBuild(workspace.latest_build.id, signal);
    } else {
      await this.restartWorkspace(workspace, template.active_version_id, richParameterValues, signal);
    }
    return this.developerWorkspaceByIdFor(identity, workspaceId, {
      repositoryUrl: input.repositoryUrl, repositoryRef, templateName: input.templateName, workspaceNamespace: input.workspaceNamespace,
    }, signal);
  }

  async ensureIterationWorkspaceFor(identity: CoderUserIdentity, input: {
    repositoryUrl: string; branch: string; headSha: string; contributor?: string; templateName: string; workspaceNamespace: string; templateVersionId?: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    assertGitSha(input.headSha);
    const owner = await this.resolveUser(identity, signal);
    const organizationId = await this.configuredOrganization(signal);
    const template = await this.activeTemplate(organizationId, input.templateName, "iteration", signal);
    const templateVersionId = input.templateVersionId ?? template.active_version_id;
    const name = iterationWorkspaceName(input.repositoryUrl, input.branch, input.contributor ?? identity.subject, input.headSha);
    const richParameterValues = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'developer', input.workspaceNamespace, signal);
    let workspace = await this.workspaceByName(owner.id, name, signal);
    if (!workspace) {
      await this.requireForgejoConnection(owner, signal);
      workspace = await this.request<WorkspaceResponse>("POST", `/api/v2/users/${pathEscape(owner.id)}/workspaces`, {
        template_version_id: templateVersionId,
        name,
        automatic_updates: "never",
        rich_parameter_values: richParameterValues,
      }, 201, signal);
      await this.waitForBuild(workspace.latest_build.id!, signal);
    }
    this.assertWorkspaceOwner(workspace, owner, organizationId, "iteration");
    this.assertWorkspaceTemplate(workspace, input.templateName, "iteration");
    if (workspace.latest_build.id) {
      const values = workspace.latest_build.id ? await this.buildParameters(workspace.latest_build.id, signal) : {};
      this.assertWorkspaceScope(values, input.repositoryUrl, 'developer', input.workspaceNamespace);
      if (!matchesWorkspaceBuild(workspace, values, templateVersionId, richParameterValues)) {
        await this.restartWorkspace(workspace, templateVersionId, richParameterValues, signal);
      }
    }
    return this.developerWorkspaceByIdFor(identity, workspace.id, {
      repositoryUrl: input.repositoryUrl, repositoryRef: input.headSha, templateName: input.templateName, workspaceNamespace: input.workspaceNamespace,
    }, signal);
  }

  async waitForHealthyWorkspaceFor(identity: CoderUserIdentity, workspaceId: string, input: {
    repositoryUrl: string; branch: string; headSha: string; contributor: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const owner = await this.resolveUser(identity, signal);
    await this.attestIterationWorkspace(identity, workspaceId, input, signal);
    return this.projectHealthyWorkspace(owner, workspaceId, input, "implementation", signal);
  }

  async stopIterationWorkspaceFor(identity: CoderUserIdentity, workspaceId: string, input: {
    repositoryUrl: string; branch: string; headSha: string; contributor: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const { owner, workspace, parameters } = await this.attestIterationWorkspace(identity, workspaceId, input, signal);
    if (workspace.latest_build.transition === 'stop' && workspace.latest_build.status === 'stopped') return this.toWorkspace(workspace, parameters, await this.chatAllowed(owner.username, signal));
    if (workspace.latest_build.transition !== 'start' || workspace.latest_build.status !== 'running') throw new Error('ticket workspace cannot be stopped from its current state');
    const build = await this.request<WorkspaceBuild>('POST', `/api/v2/workspaces/${pathEscape(workspace.id)}/builds`, { transition: 'stop' }, 201, signal);
    await this.waitForBuild(build.id, signal);
    const stopped = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspace.id)}`, undefined, 200, signal);
    return this.toWorkspace(stopped, parameters, await this.chatAllowed(owner.username, signal));
  }

  async resumeIterationWorkspaceFor(identity: CoderUserIdentity, workspaceId: string, input: {
    repositoryUrl: string; branch: string; headSha: string; contributor: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const { workspace, parameters } = await this.attestIterationWorkspace(identity, workspaceId, input, signal);
    if (!matchesWorkspaceBuild(workspace, parameters, workspace.latest_build.template_version_id ?? '', await this.workspaceParameters(input.repositoryUrl, input.headSha, 'developer', input.workspaceNamespace, signal))) {
      const template = await this.activeTemplate(await this.configuredOrganization(signal), input.templateName, 'iteration', signal);
      await this.restartWorkspace(workspace, template.active_version_id, await this.workspaceParameters(input.repositoryUrl, input.headSha, 'developer', input.workspaceNamespace, signal), signal);
    }
    return this.waitForHealthyWorkspaceFor(identity, workspaceId, input, signal);
  }

  async deleteIterationWorkspace(input: { repositoryUrl: string; branch: string; headSha: string; factoryUserId: string }, signal?: AbortSignal): Promise<void> {
    assertGitSha(input.headSha);
    const mapping = await this.userBindings?.findByFactoryUserId(input.factoryUserId);
    if (!mapping) throw new Error('iteration workspace owner is not mapped');
    const organizationId = await this.configuredOrganization(signal);
    const owner = await this.mappedUser(mapping.coderUserId, signal);
    const name = iterationWorkspaceName(input.repositoryUrl, input.branch, input.factoryUserId, input.headSha);
    const workspace = await this.workspaceByName(owner.id, name, signal);
    if (!workspace) return;
    if (workspace.organization_id !== organizationId || workspace.owner_id !== owner.id || workspace.owner_name !== owner.username || workspace.name !== name) throw new Error("iteration workspace escaped tenant scope");
    this.assertWorkspaceTemplate(workspace, this.templateName, "iteration");
    if (!workspace.latest_build.id) throw new Error("iteration workspace has no build");
    const parameters = await this.buildParameters(workspace.latest_build.id, signal);
    const expected = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'developer', this.workspaceNamespace, signal);
    if (!matchesParameters(parameters, expected)) throw new Error("workspace is not the requested iteration workspace");
    const build = await this.request<WorkspaceBuild>("POST", `/api/v2/workspaces/${pathEscape(workspace.id)}/builds`, { transition: "delete" }, 201, signal);
    await this.waitForBuild(build.id, signal);
  }

  async deleteVerificationWorkspace(workspaceId: string, input: { repositoryUrl: string; headSha: string }, signal?: AbortSignal): Promise<void> {
    assertGitSha(input.headSha);
    const organizationId = await this.configuredOrganization(signal);
    const workspace = await this.workspaceById(workspaceId, signal);
    if (!workspace) return;
    const owner = await this.verificationOwner(organizationId, signal);
    if (!this.isVerificationWorkspaceOwner(workspace, owner, organizationId)) throw new Error("verification workspace escaped tenant scope");
    this.assertWorkspaceTemplate(workspace, this.templateName, "verification");
    if (!workspace.latest_build.id) throw new Error("verification workspace has no build");
    const parameters = await this.buildParameters(workspace.latest_build.id, signal);
    const expected = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'verification', this.workspaceNamespace, signal);
    if (!matchesParameters(parameters, expected)) throw new Error("workspace is not the requested verification workspace");
    const build = await this.request<WorkspaceBuild>("POST", `/api/v2/workspaces/${pathEscape(workspaceId)}/builds`, {
      transition: "delete",
    }, 201, signal);
    await this.waitForBuild(build.id, signal);
  }

  async deleteStagingWorkspace(input: { repositoryUrl: string; templateName: string; workspaceNamespace: string }, signal?: AbortSignal): Promise<void> {
    const organizationId = await this.configuredOrganization(signal);
    const owner = await this.stagingOwner(organizationId, signal);
    const name = coderWorkspaceName('staging', input.repositoryUrl);
    const workspace = await this.workspaceByName(owner.id, name, signal);
    if (!workspace) return;
    this.assertAutomationWorkspace(workspace, owner, organizationId, input.repositoryUrl);
    this.assertWorkspaceTemplate(workspace, input.templateName, 'staging');
    if (!workspace.latest_build.id) throw new Error('staging workspace has no build');
    const parameters = await this.buildParameters(workspace.latest_build.id, signal);
    if (!matchesWorkspaceScope(parameters, input.repositoryUrl, 'staging', input.workspaceNamespace)) {
      throw new Error('workspace is not the requested staging workspace');
    }
    const build = await this.request<WorkspaceBuild>('POST', `/api/v2/workspaces/${pathEscape(workspace.id)}/builds`, {
      transition: 'delete',
    }, 201, signal);
    await this.waitForBuild(build.id, signal);
  }

  async summary(owner = "", signal?: AbortSignal): Promise<CoderSummary> {
    if (this.baseUrl === "" || this.token === "") {
      return { count: 0, workspaces: [], available: false };
    }

    const endpoint = new URL(`${this.baseUrl}/api/v2/workspaces`);
    endpoint.searchParams.set("limit", "100");
    const filters = [owner ? `owner:${owner}` : "", this.templateName ? `template:${this.templateName}` : ""].filter(Boolean);
    if (filters.length > 0) endpoint.searchParams.set("q", filters.join(" "));
    const response = await this.fetchSummary(endpoint, signal);
    const details = await Promise.all(response.workspaces.map((workspace) =>
      this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspace.id)}`, undefined, 200, signal),
    ));
    const organizationId = await this.configuredOrganization(signal);
    const scoped = details.filter((workspace) => workspace.organization_id === organizationId);
    const parameters = await Promise.all(scoped.map(async (workspace) => {
      if (!workspace.latest_build.id) return {};
      const values = await this.request<WorkspaceBuildParameter[]>("GET", `/api/v2/workspacebuilds/${pathEscape(workspace.latest_build.id)}/parameters`, undefined, 200, signal).catch(() => []);
      return Object.fromEntries(values
        .filter((item) => ["repository_url", "repository_ref", "workspace_kind", "workspace_namespace", "repository_apps", "devcontainer_path", "supervisor_commands", "supervisor_shutdown", "startup_timeout_seconds", "contract_version"].includes(item.name))
        .map((item) => [item.name, item.value]));
    }));
    const visible = scoped.map((workspace, index) => ({ workspace, parameters: parameters[index] ?? {} }))
      .filter(({ parameters: values }) => !this.workspaceNamespace || values.workspace_namespace === this.workspaceNamespace);
    const chatAvailable = owner ? await this.chatAllowed(owner, signal) : true;
    return {
      count: visible.length,
      workspaces: visible.map(({ workspace, parameters: values }) => this.toWorkspace(workspace, values, chatAvailable, 'owner')),
      available: true,
    };
  }

  async systemSummary(repositoryUrl: string, signal?: AbortSignal): Promise<CoderSummary> {
    if (this.baseUrl === "" || this.token === "") return { count: 0, workspaces: [], available: false };
    const organizationId = await this.configuredOrganization(signal);
    const owner = await this.stagingOwner(organizationId, signal);
    const workspace = await this.workspaceByName(owner.id, coderWorkspaceName('staging', repositoryUrl), signal);
    if (!workspace?.latest_build.id) return { count: 0, workspaces: [], available: true };
    try {
      this.assertAutomationWorkspace(workspace, owner, organizationId, repositoryUrl);
      this.assertWorkspaceTemplate(workspace, this.templateName, 'staging');
      const parameters = await this.buildParameters(workspace.latest_build.id, signal);
      if (!matchesWorkspaceScope(parameters, repositoryUrl, 'staging', this.workspaceNamespace)) return { count: 0, workspaces: [], available: true };
      return { count: 1, workspaces: [this.toWorkspace(workspace, parameters, false, 'shared')], available: true };
    } catch {
      return { count: 0, workspaces: [], available: true };
    }
  }

  private async chatAllowed(owner: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.request<UserRolesResponse>(
        "GET",
        `/api/v2/users/${pathEscape(owner)}/roles`,
        undefined,
        200,
        signal,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async withUserToken<T>(
    identity: CoderUserIdentity,
    lifetimeSeconds: number,
    action: (token: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const user = await this.resolveUser(identity, signal);
    return this.withMappedUserToken(user, lifetimeSeconds, action, signal);
  }

  private async withMappedUserToken<T>(
    user: CoderUser,
    lifetimeSeconds: number,
    action: (token: string) => Promise<T>,
    signal?: AbortSignal,
    ensureAccess = true,
    scopes: readonly string[] = CHAT_SCOPES,
  ): Promise<T> {
    if (ensureAccess) await this.ensureAgentsAccess(user, signal);
    const tokenName = `factory-request-${crypto.randomUUID()}`;
    try {
      const generated = await this.createDelegatedToken(user.id, tokenName, lifetimeSeconds, scopes, signal);
      return await action(generated.key);
    } finally {
      await this.expireTokenByName(user.id, tokenName).catch(() => undefined);
    }
  }

  private async withDurableChatToken<T>(user: CoderUser, operationId: string, action: (token: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.ensureAgentsAccess(user, signal);
    const tokenName = `${durableChatTokenPrefix(operationId)}${crypto.randomUUID()}`;
    let generated: GeneratedKey;
    try {
      generated = await this.createDelegatedToken(user.id, tokenName, 60 * 60, CHAT_SCOPES, signal);
    } catch (error) {
      await this.expireTokenByName(user.id, tokenName).catch(() => undefined);
      throw error;
    }
    try {
      return await action(generated.key);
    } catch (error) {
      if (!ambiguousCoderRequest(error)) await this.expireTokenByName(user.id, tokenName).catch(() => undefined);
      throw error;
    }
  }

  private createDelegatedToken(userId: string, tokenName: string, lifetimeSeconds: number, scopes: readonly string[], signal?: AbortSignal): Promise<GeneratedKey> {
    return this.request<GeneratedKey>('POST', `/api/v2/users/${pathEscape(userId)}/keys/tokens`, {
      lifetime: lifetimeSeconds * 1_000_000_000,
      token_name: tokenName,
      scopes,
    }, 201, signal);
  }

  private async expireTokenByName(userId: string, tokenName: string): Promise<void> {
    const signal = AbortSignal.timeout(TOKEN_CLEANUP_TIMEOUT_MS);
    const key = await this.request<ApiKey>('GET', `/api/v2/users/${pathEscape(userId)}/keys/tokens/${pathEscape(tokenName)}`, undefined, 200, signal).catch(() => null);
    if (key) await this.request<void>('PUT', `/api/v2/users/${pathEscape(userId)}/keys/${pathEscape(key.id)}/expire`, undefined, 204, signal);
  }

  private async expireDurableChatTokens(userId: string, operationId: string): Promise<void> {
    const signal = AbortSignal.timeout(TOKEN_CLEANUP_TIMEOUT_MS);
    const keys = await this.request<ApiKey[] | null>('GET', `/api/v2/users/${pathEscape(userId)}/keys/tokens`, undefined, 200, signal) ?? [];
    const prefix = durableChatTokenPrefix(operationId);
    await Promise.all(keys.filter((key) => key.token_name?.startsWith(prefix)).map((key) =>
      this.request<void>('PUT', `/api/v2/users/${pathEscape(userId)}/keys/${pathEscape(key.id)}/expire`, undefined, 204, signal),
    ));
  }

  private async resolveUser(identity: CoderUserIdentity, signal?: AbortSignal): Promise<CoderUser> {
    this.requireVerifiedIdentity(identity);
    if (!this.userBindings) throw new Error("Coder user binding is not configured");
    const factoryUserId = identity.subject;
    const mapping = await this.userBindings.findByFactoryUserId(factoryUserId);
    if (mapping) return this.mappedUser(mapping.coderUserId, signal, true);
    const query = new URLSearchParams({ q: identity.email, limit: "100" });
    const users = await this.request<UsersResponse>("GET", `/api/v2/users?${query}`, undefined, 200, signal);
    const matches = users.users.filter((user) => user.email.toLowerCase() === identity.email.toLowerCase());
    if (matches.length > 1) throw new Error("Coder identity is ambiguous");
    const organizationId = await this.configuredOrganization(signal);
    if (matches[0]) {
      const existing = matches[0];
      const alreadyMapped = await this.userBindings.findByCoderUserId(existing.id);
      if (alreadyMapped || existing.login_type !== "oidc" || existing.status !== "active" || existing.username !== identity.username || !existing.organization_ids.includes(organizationId)) {
        throw new Error("Existing Coder user does not match the Factory identity");
      }
      await this.userBindings.bind({ factoryUserId, coderUserId: existing.id });
      return existing;
    }
    const user = await this.request<CoderUser>("POST", "/api/v2/users", {
      email: identity.email,
      username: identity.username,
      name: identity.name,
      login_type: "oidc",
      user_status: "active",
      organization_ids: [organizationId],
    }, 201, signal);
    await this.userBindings.bind({ factoryUserId, coderUserId: user.id });
    return user;
  }

  private requireVerifiedIdentity(identity: CoderUserIdentity): void {
    if (!identity.emailVerified) throw new Error("Coder delegation requires a verified email address");
  }

  private async mappedUser(userId: string, signal?: AbortSignal, activate = false): Promise<CoderUser> {
    let user = await this.request<CoderUser>("GET", `/api/v2/users/${pathEscape(userId)}`, undefined, 200, signal);
    if (user.login_type !== "oidc" || !["active", "dormant"].includes(user.status)) throw new Error("Mapped Coder identity is not an available OIDC user");
    if (activate && user.status === "dormant") {
      user = await this.request<CoderUser>("PUT", `/api/v2/users/${pathEscape(userId)}/status/activate`, undefined, 200, signal);
    }
    return user;
  }

  private async resolveMappedUser(identity: CoderUserIdentity, signal?: AbortSignal): Promise<CoderUser | null> {
    if (!this.userBindings) throw new Error("Coder user binding is not configured");
    const mapping = await this.userBindings.findByFactoryUserId(identity.subject);
    if (!mapping) return null;
    const user = await this.mappedUser(mapping.coderUserId, signal);
    return user.status === "active" ? user : null;
  }

  private async workspaceByName(userId: string, name: string, signal?: AbortSignal): Promise<WorkspaceResponse | null> {
    try {
      return await this.request<WorkspaceResponse>("GET", `/api/v2/users/${pathEscape(userId)}/workspace/${pathEscape(name)}`, undefined, 200, signal);
    } catch (error) {
      if (this.isCoderStatus(error, 404) || this.isCoderStatus(error, 410)) return null;
      throw error;
    }
  }

  private async workspaceById(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceResponse | null> {
    try {
      return await this.request<WorkspaceResponse>("GET", `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    } catch (error) {
      if (this.isCoderStatus(error, 404) || this.isCoderStatus(error, 410)) return null;
      throw error;
    }
  }

  private async activeTemplate(organizationId: string, templateName: string, kind: string, signal?: AbortSignal): Promise<CoderTemplate> {
    const template = await this.request<CoderTemplate>("GET", `/api/v2/organizations/${pathEscape(organizationId)}/templates/${pathEscape(templateName)}`, undefined, 200, signal);
    if (template.deprecated || template.deleted) throw new Error(`Coder ${kind} template is unavailable`);
    return template;
  }

  private assertWorkspaceOwner(workspace: WorkspaceResponse, owner: CoderUser, organizationId: string, kind: string): void {
    if (workspace.organization_id !== organizationId || workspace.owner_id !== owner.id || workspace.owner_name !== owner.username) throw new Error(`${kind} workspace escaped tenant scope`);
  }

  private assertAutomationWorkspace(workspace: WorkspaceResponse, owner: CoderUser, organizationId: string, repositoryUrl: string): void {
    this.assertWorkspaceOwner(workspace, owner, organizationId, 'staging');
    if (workspace.name !== coderWorkspaceName('staging', repositoryUrl)) {
      throw new Error('staging workspace escaped deterministic identity');
    }
  }

  private assertWorkspaceTemplate(workspace: WorkspaceResponse, templateName: string, kind: string): void {
    if (workspace.template_name !== templateName) throw new Error(`${kind} workspace uses a different template`);
  }

  private isVerificationWorkspaceOwner(workspace: WorkspaceResponse, owner: CoderUser, organizationId: string): boolean {
    return workspace.organization_id === organizationId && workspace.owner_id === owner.id && workspace.owner_name === owner.username;
  }

  private async buildParameters(buildId: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const parameters = await this.request<WorkspaceBuildParameter[]>("GET", `/api/v2/workspacebuilds/${pathEscape(buildId)}/parameters`, undefined, 200, signal);
    return Object.fromEntries(parameters.map((item) => [item.name, item.value]));
  }

  private async attestIterationWorkspace(identity: CoderUserIdentity, workspaceId: string, input: {
    repositoryUrl: string; branch: string; headSha: string; contributor: string; templateName: string; workspaceNamespace: string;
  }, signal?: AbortSignal): Promise<{ owner: CoderUser; workspace: WorkspaceResponse; parameters: Record<string, string> }> {
    assertGitSha(input.headSha);
    const owner = await this.resolveUser(identity, signal);
    const organizationId = await this.configuredOrganization(signal);
    const workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    this.assertWorkspaceOwner(workspace, owner, organizationId, 'iteration');
    this.assertWorkspaceTemplate(workspace, input.templateName, 'iteration');
    if (workspace.name !== iterationWorkspaceName(input.repositoryUrl, input.branch, input.contributor, input.headSha) || !workspace.latest_build.id) throw new Error('ticket workspace escaped deterministic identity');
    const parameters = await this.buildParameters(workspace.latest_build.id, signal);
    const expected = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'developer', input.workspaceNamespace, signal);
    if (!matchesParameters(parameters, expected)) throw new Error('ticket workspace attestation failed');
    return { owner, workspace, parameters };
  }

  private assertWorkspaceScope(values: Record<string, string>, repositoryUrl: string, kind: WorkspaceKind, workspaceNamespace: string): void {
    if (!matchesWorkspaceScope(values, repositoryUrl, kind, workspaceNamespace)) throw new Error("existing workspace is outside the requested scope");
  }

  private async restartWorkspace(workspace: WorkspaceResponse, templateVersionId: string, richParameterValues: WorkspaceBuildParameter[], signal?: AbortSignal, timeoutSeconds = 300): Promise<void> {
    let current = workspace;
    if (current.latest_build.id && !['running', 'stopped', 'failed', 'canceled'].includes(current.latest_build.status)) {
      await this.waitForBuild(current.latest_build.id, signal, timeoutSeconds);
      current = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(current.id)}`, undefined, 200, signal);
    }
    if (current.latest_build.transition === 'start' && current.latest_build.status === 'running') {
      const stop = await this.request<WorkspaceBuild>('POST', `/api/v2/workspaces/${pathEscape(workspace.id)}/builds`, { transition: 'stop' }, 201, signal);
      await this.waitForBuild(stop.id, signal, timeoutSeconds);
    }
    const start = await this.request<WorkspaceBuild>('POST', `/api/v2/workspaces/${pathEscape(workspace.id)}/builds`, {
      transition: 'start',
      template_version_id: templateVersionId,
      rich_parameter_values: richParameterValues,
    }, 201, signal);
    await this.waitForBuild(start.id, signal, timeoutSeconds);
  }

  private async resolveRepositoryRef(repositoryUrl: string, branch: string, signal?: AbortSignal): Promise<string> {
    if (!this.repositoryRefs) throw new Error('Coder repository ref resolver is not configured');
    const repositoryRef = await this.repositoryRefs.resolve(repositoryUrl, branch, signal);
    assertGitSha(repositoryRef);
    return repositoryRef;
  }

  async developerWorkspaceByIdFor(identity: CoderUserIdentity, workspaceId: string, input: { repositoryUrl: string; repositoryRef: string; templateName: string; workspaceNamespace: string }, signal?: AbortSignal): Promise<CoderWorkspace> {
    const owner = await this.resolveUser(identity, signal);
    const organizationId = await this.configuredOrganization(signal);
    const workspace = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
    this.assertWorkspaceOwner(workspace, owner, organizationId, 'developer');
    this.assertWorkspaceTemplate(workspace, input.templateName, 'developer');
    if (!workspace.latest_build.id) throw new Error('developer workspace has no build');
    const parameters = await this.buildParameters(workspace.latest_build.id, signal);
    if (!matchesWorkspaceScope(parameters, input.repositoryUrl, 'developer', input.workspaceNamespace)
      || parameters.repository_ref !== input.repositoryRef) throw new Error('developer workspace attestation failed');
    return this.toWorkspace(workspace, parameters, await this.chatAllowed(owner.username, signal));
  }

  private async projectHealthyWorkspace(owner: CoderUser, workspaceId: string, input: {
    repositoryUrl: string; branch: string; headSha: string; contributor: string; templateName: string; workspaceNamespace: string;
  }, kind: string, signal?: AbortSignal): Promise<CoderWorkspace> {
    const organizationId = await this.configuredOrganization(signal);
    for (let attempt = 0; attempt < 600; attempt += 1) {
      signal?.throwIfAborted();
      const raw = await this.request<WorkspaceResponse>('GET', `/api/v2/workspaces/${pathEscape(workspaceId)}`, undefined, 200, signal);
      this.assertWorkspaceOwner(raw, owner, organizationId, kind);
      this.assertWorkspaceTemplate(raw, input.templateName, kind);
      if (raw.name !== iterationWorkspaceName(input.repositoryUrl, input.branch, input.contributor, input.headSha) || !raw.latest_build.id) throw new Error(`${kind} workspace escaped deterministic identity`);
      const parameters = await this.buildParameters(raw.latest_build.id, signal);
      const expected = await this.workspaceParameters(input.repositoryUrl, input.headSha, 'developer', input.workspaceNamespace, signal);
      if (!matchesParameters(parameters, expected)) throw new Error(`${kind} workspace attestation failed`);
      const workspace = this.toWorkspace(raw, parameters, await this.chatAllowed(owner.username, signal));
      if (workspace.healthy && workspace.apps.every((app) => app.health === 'healthy' || app.health === 'disabled')) return workspace;
      if (workspace.status === "failed" || workspace.transition !== "start") throw new Error(`${kind} workspace failed before its apps became healthy`);
      await this.lifecycleSleep(1_000, signal);
    }
    throw new Error(`${kind} workspace apps did not become healthy`);
  }

  private toWorkspace(workspace: WorkspaceResponse, parameters: Record<string, string>, chatAvailable: boolean, projection: 'owner' | 'shared' = 'owner'): CoderWorkspace {
    const workspacePath = `/@${pathEscape(workspace.owner_name)}/${pathEscape(workspace.name)}`;
    const agents = workspace.latest_build.resources?.flatMap((resource) => resource.agents ?? []) ?? [];
    const rootAgents = agents.filter((candidate) => !candidate.parent_id);
    const agent = rootAgents.find((candidate) => candidate.name === 'main' && candidate.status === 'connected')
      ?? rootAgents.find((candidate) => candidate.status === 'connected')
      ?? rootAgents[0];
    const apps = agent?.apps ?? [];
    const appUrl = (slug: string, includeDisabled = false): string | undefined => {
      const app = apps.find((candidate) => candidate.slug === slug);
      if (!app || (!includeDisabled && app.health === "disabled")) return undefined;
      if (app.external) return app.url;
      if (!app.subdomain || !app.subdomain_name || !this.wildcardAccessUrl) {
        throw new Error(`Coder app ${slug} is not available through the required wildcard subdomain`);
      }
      const host = this.wildcardAccessUrl.replaceAll('*', app.subdomain_name);
      return `${new URL(this.publicUrl).protocol}//${host}`;
    };
    const ide = apps.find((app) => isIdeApp(app) && app.health === 'healthy');
    const commandApps = apps.filter((app) => Boolean(app.command));
    const urlApps = apps.filter((app) => !app.command && !isIdeApp(app) && !isTerminalApp(app) && app.health !== 'disabled');
    const verificationApps = urlApps.filter((app) => !app.external && app.sharing_level === 'authenticated');
    const projectedApps = (parameters.workspace_kind === 'verification' || projection === 'shared' ? verificationApps : [...urlApps, ...commandApps])
      .map((app) => ({
        slug: app.slug,
        displayName: app.display_name || app.slug,
        url: app.command
          ? `${this.publicUrl}${workspacePath}.${pathEscape(agent?.name ?? 'main')}/terminal?app=${encodeURIComponent(app.slug)}`
          : appUrl(app.slug)!,
        health: normalizeAppHealth(app.health),
      }));
    const terminalUrl = agent?.display_apps?.includes('web_terminal')
      ? `${this.publicUrl}${workspacePath}.${pathEscape(agent.name)}/terminal`
      : undefined;
    return {
      id: workspace.id,
      name: workspace.name,
      owner: workspace.owner_name,
      template: workspace.template_display_name || workspace.template_name,
      status: workspace.latest_build.status,
      transition: workspace.latest_build.transition,
      healthy: workspace.health.healthy && agent?.status === "connected",
      outdated: workspace.outdated,
      lastUsedAt: workspace.last_used_at,
      url: projection === 'owner' && parameters.workspace_kind === 'developer' ? `${this.publicUrl}${workspacePath}` : undefined,
      chatUrl: projection === 'owner' && parameters.workspace_kind === 'developer' && chatAvailable ? `${this.publicUrl}/agents` : undefined,
      ideUrl: projection === 'owner' && parameters.workspace_kind === 'developer' && ide ? appUrl(ide.slug) : undefined,
      terminalUrl: projection === 'owner' && parameters.workspace_kind === 'developer' ? terminalUrl : undefined,
      apps: projectedApps,
      parameters,
    };
  }

  private async ensureAgentsAccess(user: CoderUser, signal?: AbortSignal): Promise<void> {
    const roles = await this.request<UserRolesResponse>("GET", `/api/v2/users/${pathEscape(user.id)}/roles`, undefined, 200, signal);
    if (roles.roles.includes("owner")) return;
    const organizationId = await this.configuredOrganization(signal);
    if (!user.organization_ids.includes(organizationId)) throw new Error("Coder user is not a member of the configured organization");
    const current = roles.organization_roles[organizationId] ?? [];
    if (current.includes("organization-admin") || current.includes("organization-workspace-creation-ban")) return;
    await this.request<void>("PUT", `/api/v2/organizations/${pathEscape(organizationId)}/members/${pathEscape(user.id)}/roles`, {
      roles: [...new Set([...current, "organization-workspace-creation-ban"])],
    }, 200, signal);
  }

  private async requireForgejoConnection(user: CoderUser, signal?: AbortSignal): Promise<void> {
    const connected = await this.withMappedUserToken(user, 5 * 60, async (token) => {
      await this.refreshExternalAuth(token, signal);
      const external = await this.request<{ authenticated: boolean }>(
        'GET', '/api/v2/external-auth/forgejo', undefined, 200, signal, token,
      );
      return external.authenticated;
    }, signal, false, EXTERNAL_AUTH_SCOPES);
    if (!connected) throw Object.assign(new Error('Connect Forgejo in Coder before creating a Developer workspace'), { status: 409 });
  }

  private async refreshExternalAuth(token: string, signal?: AbortSignal): Promise<void> {
    await this.request<unknown>('GET', '/api/v2/external-auth', undefined, 200, signal, token);
  }

  private async workspaceParameters(repositoryUrl: string, repositoryRef: string, workspaceKind: WorkspaceKind, workspaceNamespace: string, signal?: AbortSignal): Promise<WorkspaceBuildParameter[]> {
    if (!this.repositoryRefs) throw new Error('Coder repository ref resolver is not configured');
    const contract = await this.repositoryRefs.workspaceContract(repositoryUrl, repositoryRef, workspaceKind, signal);
    return [
      { name: 'repository_url', value: repositoryUrl },
      { name: 'repository_ref', value: repositoryRef },
      { name: 'workspace_kind', value: workspaceKind },
      { name: 'workspace_namespace', value: workspaceNamespace },
      { name: 'repository_apps', value: JSON.stringify(contract.apps) },
      { name: 'devcontainer_path', value: contract.devcontainerPath ?? (workspaceKind === 'verification' ? '.devcontainer/verification/devcontainer.json' : '.devcontainer/devcontainer.json') },
      { name: 'supervisor_commands', value: JSON.stringify(contract.supervisorCommands ?? {}) },
      { name: 'supervisor_shutdown', value: contract.shutdownCommand ?? 'true' },
      { name: 'startup_timeout_seconds', value: String(contract.startupTimeoutSeconds ?? 120) },
      { name: 'contract_version', value: String(contract.contractVersion ?? 1) },
      { name: 'tenant_id', value: this.tenantId || 'factory' },
    ];
  }

  private async configuredOrganization(signal?: AbortSignal): Promise<string> {
    if (this.organizationId) return this.organizationId;
    const organizations = await this.request<CoderOrganization[]>("GET", "/api/v2/organizations", undefined, 200, signal);
    const organization = organizations.find((item) => item.id === this.organizationName || item.name === this.organizationName)
      ?? (this.organizationName === "default" ? organizations.find((item) => item.is_default) : undefined);
    if (!organization) throw new Error(`Coder organization ${this.organizationName} was not found`);
    this.organizationId = organization.id;
    return organization.id;
  }

  async assertVerificationAutomationOwner(signal?: AbortSignal): Promise<void> {
    const organizationId = await this.configuredOrganization(signal);
    await this.verificationOwner(organizationId, signal);
  }

  async assertStagingAutomationOwner(signal?: AbortSignal): Promise<void> {
    const organizationId = await this.configuredOrganization(signal);
    await this.stagingOwner(organizationId, signal);
  }

  private async verificationOwner(organizationId: string, signal?: AbortSignal): Promise<CoderUser> {
    if (!this.verificationOwnerId || !this.verificationOwnerUsername) throw new Error("Coder verification automation owner is not configured");
    let user = await this.request<CoderUser>("GET", `/api/v2/users/${pathEscape(this.verificationOwnerId)}`, undefined, 200, signal);
    if (user.status === "dormant") {
      user = await this.request<CoderUser>("PUT", `/api/v2/users/${pathEscape(user.id)}/status/activate`, undefined, 200, signal);
    }
    const roles = await this.request<UserRolesResponse>("GET", `/api/v2/users/${pathEscape(user.id)}/roles`, undefined, 200, signal);
    const organizationRoles = Object.values(roles.organization_roles).flat();
    if (user.id !== this.verificationOwnerId || user.username !== this.verificationOwnerUsername || user.login_type !== "password"
      || user.status !== "active" || user.is_service_account === true || !user.organization_ids.includes(organizationId)
      || roles.roles.length > 0 || organizationRoles.some((role) => role.includes("agent") || role === "organization-admin")) {
      throw new Error("Coder verification automation owner has unsafe identity or roles");
    }
    return user;
  }

  private stagingOwner(organizationId: string, signal?: AbortSignal): Promise<CoderUser> {
    return this.automationOwner(this.stagingOwnerId, this.stagingOwnerUsername, organizationId, 'staging', signal);
  }

  private async automationOwner(id: string, username: string, organizationId: string, kind: string, signal?: AbortSignal): Promise<CoderUser> {
    if (!id || !username) throw new Error(`Coder ${kind} automation owner is not configured`);
    let user = await this.request<CoderUser>('GET', `/api/v2/users/${pathEscape(id)}`, undefined, 200, signal);
    if (user.status === 'dormant') user = await this.request<CoderUser>('PUT', `/api/v2/users/${pathEscape(user.id)}/status/activate`, undefined, 200, signal);
    const roles = await this.request<UserRolesResponse>('GET', `/api/v2/users/${pathEscape(user.id)}/roles`, undefined, 200, signal);
    const organizationRoles = Object.values(roles.organization_roles).flat();
    if (user.id !== id || user.username !== username || user.login_type !== 'password' || user.status !== 'active'
      || user.is_service_account === true || !user.organization_ids.includes(organizationId) || roles.roles.length > 0
      || organizationRoles.some((role) => role.includes('agent') || role === 'organization-admin')) {
      throw new Error(`Coder ${kind} automation owner has unsafe identity or roles`);
    }
    return user;
  }

  private async waitForBuild(buildId: string, signal?: AbortSignal, timeoutSeconds = 300): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const build = await this.request<WorkspaceBuild>("GET", `/api/v2/workspacebuilds/${pathEscape(buildId)}`, undefined, 200, signal);
      if (build.job.status === "succeeded") return;
      if (["failed", "canceled"].includes(build.job.status)) throw new Error(build.job.error || "Coder workspace build failed");
      await this.lifecycleSleep(1_000, signal);
    }
    throw new Error(`Coder workspace did not become ready within ${timeoutSeconds} seconds`);
  }

  private async fetchSummary(endpoint: URL, signal?: AbortSignal): Promise<WorkspaceEnvelope> {
    const response = await this.request<unknown>(
      "GET",
      endpoint.toString().slice(this.baseUrl.length),
      undefined,
      200,
      signal,
    );
    const parsed = z.object({ count: z.number(), workspaces: z.array(workspaceResponseSchema) }).passthrough().safeParse(response);
    if (!parsed.success) throw new Error(`Coder workspace API is incompatible: ${parsed.error.issues[0]?.path.join('.') || 'response'} ${parsed.error.issues[0]?.message || 'is invalid'}`);
    return parsed.data;
  }
}

async function abortableSleep(sleep: ((milliseconds: number, signal?: AbortSignal) => Promise<void>) | undefined, milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!sleep) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      reject(signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    sleep(milliseconds, signal).then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort));
  });
}

function matchesWorkspaceScope(values: Record<string, string>, repositoryUrl: string, kind: WorkspaceKind, workspaceNamespace: string): boolean {
  return values.repository_url === repositoryUrl
    && values.workspace_kind === kind
    && values.workspace_namespace === workspaceNamespace;
}

function startupTimeoutSeconds(parameters: WorkspaceBuildParameter[]): number {
  const value = Number(parameters.find((parameter) => parameter.name === 'startup_timeout_seconds')?.value);
  return Number.isInteger(value) && value >= 10 && value <= 600 ? value : 120;
}

function provisioningTimeoutSeconds(parameters: WorkspaceBuildParameter[]): number {
  return Math.max(600, startupTimeoutSeconds(parameters));
}

function matchesParameters(values: Record<string, string>, parameters: WorkspaceBuildParameter[]): boolean {
  return parameters.every((parameter) => values[parameter.name] === parameter.value);
}

function matchesWorkspaceBuild(workspace: WorkspaceResponse, values: Record<string, string>, templateVersionId: string, parameters: WorkspaceBuildParameter[]): boolean {
  return workspace.latest_build.id !== undefined
    && workspace.latest_build.transition === 'start'
    && workspace.latest_build.status === 'running'
    && workspace.latest_build.template_version_id === templateVersionId
    && parameters.every((parameter) => values[parameter.name] === parameter.value);
}

function durableChatTokenPrefix(operationId: string): string {
  return `factory-chat-${operationId.length}-${operationId}-`;
}

function ambiguousCoderRequest(error: unknown): boolean {
  return error instanceof TypeError || error instanceof UpstreamTimeoutError
    || error instanceof DOMException || (error instanceof UpstreamHttpError && error.status >= 500);
}

function iterationWorkspaceName(repositoryUrl: string, branch: string, factoryUserId: string, headSha: string): string {
  return coderWorkspaceName('ticket', `${repositoryUrl}#${branch}#${factoryUserId}@${headSha}`);
}

function assertGitSha(value: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error('workspace requires an exact 40-character Git SHA');
}

function isIdeApp(app: { slug: string; display_name: string }): boolean {
  return app.slug === 'ide' || app.slug === 'code-server' || /\b(?:ide|code-server)\b/i.test(app.display_name);
}

function isTerminalApp(app: { slug: string; display_name: string }): boolean {
  return /(?:^|[-_])terminal(?:$|[-_])/i.test(app.slug) || /\bterminal\b/i.test(app.display_name);
}

function normalizeAppHealth(value: string): CoderWorkspaceApp['health'] {
  if (value === 'healthy' || value === 'initializing' || value === 'unhealthy' || value === 'disabled') return value;
  return 'initializing';
}
