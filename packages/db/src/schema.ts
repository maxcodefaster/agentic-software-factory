/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export interface PersistedApplicationDefinition {
  id: string;
  name: string;
  description: string;
  repositoryUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  defaultSha: string;
  systemContext?: string;
  team: string;
  repositoryOwner: string;
  repositoryName: string;
  declaredApps: Array<{ slug: string; displayName: string }>;
  workspaceApps?: Array<{
    slug: string;
    displayName?: string;
    url: string;
    icon?: string;
    openIn?: 'tab' | 'slim-window';
    share?: 'owner' | 'authenticated';
    group?: string;
    order?: number;
    healthCheck?: { url: string; interval: number; threshold: number };
  }>;
}

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  preferredUsername: text('preferred_username').notNull().default(''),
  groups: text('groups').array().notNull().default([]),
  deprovisionedAt: timestamp('deprovisioned_at', { withTimezone: true }),
  deprovisionedCoderUserId: text('deprovisioned_coder_user_id'),
  coderDeprovisionedAt: timestamp('coder_deprovisioned_at', { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_issuer_account_id_uq').on(table.issuer, table.accountId),
  ],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  alg: text('alg'),
  crv: text('crv'),
});

export const oauthClient = pgTable(
  'oauth_client',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    clientCredentialsScopes: text('client_credentials_scopes').array().default([]),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [index('oauth_client_user_id_idx').on(table.userId)],
);

export const oauthResource = pgTable('oauth_resource', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes').array(),
  customClaims: jsonb('custom_claims').$type<Record<string, unknown>>(),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  policyVersion: integer('policy_version').default(1),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  ...timestamps,
});

export const oauthClientResource = pgTable(
  'oauth_client_resource',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('oauth_client_resource_client_id_idx').on(table.clientId),
    index('oauth_client_resource_resource_id_idx').on(table.resourceId),
    uniqueIndex('oauth_client_resource_client_resource_uq').on(table.clientId, table.resourceId),
  ],
);

export const oauthRefreshToken = pgTable(
  'oauth_refresh_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp('revoked', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: timestamp('rotation_replay_expires_at', { withTimezone: true }),
    authTime: timestamp('auth_time', { withTimezone: true }),
    confirmation: jsonb('confirmation').$type<Record<string, unknown>>(),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_refresh_token_client_id_idx').on(table.clientId),
    index('oauth_refresh_token_session_id_idx').on(table.sessionId),
    index('oauth_refresh_token_user_id_idx').on(table.userId),
    index('oauth_refresh_token_authorization_code_id_idx').on(table.authorizationCodeId),
  ],
);

export const oauthAccessToken = pgTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp('revoked', { withTimezone: true }),
    confirmation: jsonb('confirmation').$type<Record<string, unknown>>(),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_access_token_client_id_idx').on(table.clientId),
    index('oauth_access_token_session_id_idx').on(table.sessionId),
    index('oauth_access_token_user_id_idx').on(table.userId),
    index('oauth_access_token_authorization_code_id_idx').on(table.authorizationCodeId),
    index('oauth_access_token_refresh_id_idx').on(table.refreshId),
  ],
);

export const oauthConsent = pgTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text('user_id').references(() => user.id),
    referenceId: text('reference_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    scopes: text('scopes').array().notNull(),
    ...timestamps,
  },
  (table) => [
    index('oauth_consent_client_id_idx').on(table.clientId),
    index('oauth_consent_user_id_idx').on(table.userId),
  ],
);

export const oauthClientAssertion = pgTable('oauth_client_assertion', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const systemRegistration = pgTable(
  'system_registration',
  {
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    teamId: text('team_id').notNull(),
    forgejoOwner: text('forgejo_owner').notNull(),
    forgejoRepository: text('forgejo_repository').notNull(),
    projection: jsonb('projection').$type<PersistedApplicationDefinition>(),
    projectionUpdatedAt: timestamp('projection_updated_at', { withTimezone: true }),
    projectionError: text('projection_error'),
    projectionErrorAt: timestamp('projection_error_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.systemId] }),
    index('system_registration_team_idx').on(table.tenantId, table.teamId),
    uniqueIndex('system_registration_forgejo_repository_uq').on(table.tenantId, table.forgejoOwner, table.forgejoRepository),
    check('system_registration_system_id_check', sql`${table.systemId} = ${table.forgejoOwner} || '/' || ${table.forgejoRepository}`),
  ],
);

export const systemOnboarding = pgTable(
  'system_onboarding',
  {
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    teamId: text('team_id').notNull(),
    targetTeamId: text('target_team_id'),
    forgejoOwner: text('forgejo_owner').notNull(),
    forgejoRepository: text('forgejo_repository').notNull(),
    phase: text('phase').notNull().default('validating'),
    targetSha: text('target_sha'),
    contractVersion: integer('contract_version'),
    compatibilityIssues: jsonb('compatibility_issues').$type<Array<{ path: string; code: string; message: string }>>().notNull().default([]),
    policyPlan: jsonb('policy_plan').$type<Record<string, unknown>>(),
    lastError: text('last_error'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.systemId] }),
    uniqueIndex('system_onboarding_forgejo_repository_uq').on(table.tenantId, table.forgejoOwner, table.forgejoRepository),
    index('system_onboarding_reconcile_idx').on(table.phase, table.leaseExpiresAt, table.updatedAt),
    check('system_onboarding_system_id_check', sql`${table.systemId} = ${table.forgejoOwner} || '/' || ${table.forgejoRepository}`),
    check('system_onboarding_phase_check', sql`${table.phase} in ('validating', 'applying-access', 'applying-policy', 'creating-staging', 'ready', 'retry-wait', 'repair', 'failed', 'reassigning', 'reassigning-access', 'unregistering', 'removed')`),
    check('system_onboarding_lease_check', sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`),
    check('system_onboarding_attempts_check', sql`${table.attempts} >= 0`),
    check('system_onboarding_generation_check', sql`${table.leaseGeneration} >= 0`),
  ],
);

export const systemOnboardingEvent = pgTable(
  'system_onboarding_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    phase: text('phase').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.systemId],
      foreignColumns: [systemOnboarding.tenantId, systemOnboarding.systemId],
      name: 'system_onboarding_event_onboarding_fk',
    }).onDelete('cascade'),
    index('system_onboarding_event_timeline_idx').on(table.tenantId, table.systemId, table.id),
  ],
);

export const stagingReconciliation = pgTable(
  'staging_reconciliation',
  {
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    desiredSha: text('desired_sha').notNull(),
    currentSha: text('current_sha'),
    phase: text('phase').notNull().default('pending'),
    health: text('health').notNull().default('unknown'),
    workspace: jsonb('workspace').$type<Record<string, unknown>>(),
    lastError: text('last_error'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.systemId] }),
    foreignKey({
      columns: [table.tenantId, table.systemId],
      foreignColumns: [systemRegistration.tenantId, systemRegistration.systemId],
      name: 'staging_reconciliation_registration_fk',
    }).onDelete('cascade'),
    index('staging_reconciliation_due_idx').on(table.phase, table.nextAttemptAt, table.leaseExpiresAt),
    check('staging_reconciliation_phase_check', sql`${table.phase} in ('pending', 'provisioning', 'healthy', 'retry-wait', 'failed', 'deleting')`),
    check('staging_reconciliation_health_check', sql`${table.health} in ('unknown', 'initializing', 'healthy', 'unhealthy')`),
    check('staging_reconciliation_lease_check', sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`),
  ],
);

export const stagingReconciliationEvent = pgTable(
  'staging_reconciliation_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    desiredSha: text('desired_sha').notNull(),
    phase: text('phase').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.systemId],
      foreignColumns: [stagingReconciliation.tenantId, stagingReconciliation.systemId],
      name: 'staging_reconciliation_event_state_fk',
    }).onDelete('cascade'),
    index('staging_reconciliation_event_timeline_idx').on(table.tenantId, table.systemId, table.id),
  ],
);

export const workspaceStartup = pgTable(
  'workspace_startup',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    workspaceKind: text('workspace_kind').notNull(),
    repositorySha: text('repository_sha').notNull(),
    contractVersion: integer('contract_version').notNull(),
    architecture: text('architecture').notNull(),
    cacheKey: text('cache_key').notNull(),
    cacheState: text('cache_state').notNull().default('unknown'),
    outcome: text('outcome').notNull().default('starting'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    errorClass: text('error_class'),
    ...timestamps,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId, table.systemId], foreignColumns: [systemRegistration.tenantId, systemRegistration.systemId], name: 'workspace_startup_registration_fk' }).onDelete('cascade'),
    check('workspace_startup_kind_check', sql`${table.workspaceKind} in ('developer', 'ticket', 'staging', 'verification')`),
    check('workspace_startup_cache_check', sql`${table.cacheState} in ('unknown', 'warm', 'cold')`),
    check('workspace_startup_outcome_check', sql`${table.outcome} in ('starting', 'ready', 'failed', 'cancelled')`),
    index('workspace_startup_slo_idx').on(table.workspaceKind, table.cacheState, table.outcome, table.requestedAt),
  ],
);

export const coderUserBinding = pgTable(
  'coder_user_binding',
  {
    factoryUserId: text('factory_user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
    coderUserId: text('coder_user_id').notNull().unique(),
    ...timestamps,
  },
);

export const delivery = pgTable(
  'delivery',
  {
    id: text('id').primaryKey(),
    requirementNumber: integer('requirement_number').notNull(),
    tenantId: text('tenant_id').notNull(),
    systemId: text('system_id').notNull(),
    acceptedDigest: text('accepted_digest').notNull(),
    createdByUserId: text('created_by_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.systemId],
      foreignColumns: [systemRegistration.tenantId, systemRegistration.systemId],
      name: 'delivery_system_registration_fk',
    }).onDelete('restrict'),
    uniqueIndex('delivery_identity_uq').on(table.tenantId, table.systemId, table.requirementNumber, table.acceptedDigest),
    index('delivery_requirement_idx').on(table.tenantId, table.systemId, table.requirementNumber, table.createdAt),
    index('delivery_creator_idx').on(table.createdByUserId, table.createdAt),
  ],
);

export const deliveryContributor = pgTable(
  'delivery_contributor',
  {
    deliveryId: text('delivery_id').notNull().references(() => delivery.id, { onDelete: 'cascade' }),
    factoryUserId: text('factory_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
    forgejoAccessRevokedAt: timestamp('forgejo_access_revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.deliveryId, table.factoryUserId] }),
    index('delivery_contributor_user_idx').on(table.factoryUserId, table.createdAt),
  ],
);

export const deliveryCompletion = pgTable(
  'delivery_completion',
  {
    deliveryId: text('delivery_id').primaryKey().references(() => delivery.id, { onDelete: 'cascade' }),
    phase: text('phase').notNull().default('merge-requested'),
    reviewedHeadSha: text('reviewed_head_sha').notNull(),
    reviewedDefaultSha: text('reviewed_default_sha').notNull(),
    verificationWorkspaceId: text('verification_workspace_id').notNull(),
    mergedSha: text('merged_sha'),
    mergeRequestedAt: timestamp('merge_requested_at', { withTimezone: true }).notNull().defaultNow(),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('delivery_completion_phase_check', sql`${table.phase} in ('merge-requested', 'merged', 'cleanup-pending', 'card-transition-pending', 'complete', 'retry-wait', 'repair')`),
    check('delivery_completion_lease_check', sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`),
    index('delivery_completion_due_idx').on(table.phase, table.nextAttemptAt, table.leaseExpiresAt),
  ],
);

export const deliveryVerification = pgTable(
  'delivery_verification',
  {
    deliveryId: text('delivery_id').primaryKey().references(() => delivery.id, { onDelete: 'cascade' }),
    requestedByUserId: text('requested_by_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
    desiredHeadSha: text('desired_head_sha').notNull(),
    desiredDefaultSha: text('desired_default_sha').notNull(),
    currentHeadSha: text('current_head_sha'),
    workspaceId: text('workspace_id'),
    phase: text('phase').notNull().default('desired'),
    health: text('health').notNull().default('unknown'),
    lastError: text('last_error'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseGeneration: integer('lease_generation').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('delivery_verification_phase_check', sql`${table.phase} in ('desired', 'provisioning', 'healthy', 'retry-wait', 'repair', 'deleting')`),
    check('delivery_verification_health_check', sql`${table.health} in ('unknown', 'initializing', 'healthy', 'unhealthy')`),
    check('delivery_verification_lease_check', sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`),
    index('delivery_verification_due_idx').on(table.phase, table.nextAttemptAt, table.leaseExpiresAt),
  ],
);

export const deliveryLifecycleEvent = pgTable(
  'delivery_lifecycle_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deliveryId: text('delivery_id').notNull().references(() => delivery.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    phase: text('phase').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('delivery_lifecycle_event_kind_check', sql`${table.kind} in ('verification', 'completion')`),
    index('delivery_lifecycle_event_timeline_idx').on(table.deliveryId, table.id),
  ],
);

export const operation = pgTable(
  'operation',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    deliveryId: text('delivery_id').notNull(),
    factoryUserId: text('factory_user_id').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull().default('pending'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    externalId: text('external_id'),
    error: text('error'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.deliveryId, table.factoryUserId],
      foreignColumns: [deliveryContributor.deliveryId, deliveryContributor.factoryUserId],
      name: 'operation_delivery_contributor_fk',
    }).onDelete('cascade'),
    uniqueIndex('operation_delivery_kind_uq')
      .on(table.deliveryId, table.kind)
      .where(sql`${table.state} in ('pending', 'running', 'ambiguous', 'succeeded')`),
    uniqueIndex('operation_external_id_uq').on(table.kind, table.externalId).where(sql`${table.externalId} is not null`),
    index('operation_reconcile_idx').on(table.state, table.leaseExpiresAt, table.createdAt),
    check('operation_state_check', sql`${table.state} in ('pending', 'running', 'ambiguous', 'succeeded', 'failed')`),
    check(
      'operation_lease_check',
      sql`(${table.state} = 'running') = (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const authSchema = {
  user,
  session,
  account,
  verification,
  jwks,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClientAssertion,
};

export const schema = {
  ...authSchema,
  systemRegistration,
  systemOnboarding,
  systemOnboardingEvent,
  stagingReconciliation,
  stagingReconciliationEvent,
  workspaceStartup,
  coderUserBinding,
  delivery,
  deliveryContributor,
  deliveryCompletion,
  deliveryVerification,
  deliveryLifecycleEvent,
  operation,
};

export type AuthUser = typeof user.$inferSelect;
export type AuthSession = typeof session.$inferSelect;
