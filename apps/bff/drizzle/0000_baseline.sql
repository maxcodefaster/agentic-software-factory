-- Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
--
-- All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coder_user_binding" (
	"factory_user_id" text PRIMARY KEY NOT NULL,
	"coder_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coder_user_binding_coder_user_id_unique" UNIQUE("coder_user_id")
);
--> statement-breakpoint
CREATE TABLE "delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"requirement_number" integer NOT NULL,
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"accepted_digest" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_completion" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"phase" text DEFAULT 'merge-requested' NOT NULL,
	"reviewed_head_sha" text NOT NULL,
	"reviewed_default_sha" text NOT NULL,
	"verification_workspace_id" text NOT NULL,
	"merged_sha" text,
	"merge_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_completion_phase_check" CHECK ("delivery_completion"."phase" in ('merge-requested', 'merged', 'cleanup-pending', 'card-transition-pending', 'complete', 'retry-wait', 'repair')),
	CONSTRAINT "delivery_completion_lease_check" CHECK (("delivery_completion"."lease_owner" is null) = ("delivery_completion"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "delivery_contributor" (
	"delivery_id" text NOT NULL,
	"factory_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_contributor_delivery_id_factory_user_id_pk" PRIMARY KEY("delivery_id","factory_user_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_lifecycle_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"kind" text NOT NULL,
	"phase" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_lifecycle_event_kind_check" CHECK ("delivery_lifecycle_event"."kind" in ('verification', 'completion'))
);
--> statement-breakpoint
CREATE TABLE "delivery_verification" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"desired_head_sha" text NOT NULL,
	"desired_default_sha" text NOT NULL,
	"current_head_sha" text,
	"workspace_id" text,
	"phase" text DEFAULT 'desired' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_verification_phase_check" CHECK ("delivery_verification"."phase" in ('desired', 'provisioning', 'healthy', 'retry-wait', 'repair', 'deleting')),
	CONSTRAINT "delivery_verification_health_check" CHECK ("delivery_verification"."health" in ('unknown', 'initializing', 'healthy', 'unhealthy')),
	CONSTRAINT "delivery_verification_lease_check" CHECK (("delivery_verification"."lease_owner" is null) = ("delivery_verification"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}',
	"user_id" text,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "operation" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"factory_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"external_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_state_check" CHECK ("operation"."state" in ('pending', 'running', 'ambiguous', 'succeeded', 'failed')),
	CONSTRAINT "operation_lease_check" CHECK (("operation"."state" = 'running') = ("operation"."lease_owner" is not null and "operation"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staging_reconciliation" (
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"desired_sha" text NOT NULL,
	"current_sha" text,
	"phase" text DEFAULT 'pending' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"workspace" jsonb,
	"last_error" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staging_reconciliation_tenant_id_system_id_pk" PRIMARY KEY("tenant_id","system_id"),
	CONSTRAINT "staging_reconciliation_phase_check" CHECK ("staging_reconciliation"."phase" in ('pending', 'provisioning', 'healthy', 'retry-wait', 'failed', 'deleting')),
	CONSTRAINT "staging_reconciliation_health_check" CHECK ("staging_reconciliation"."health" in ('unknown', 'initializing', 'healthy', 'unhealthy')),
	CONSTRAINT "staging_reconciliation_lease_check" CHECK (("staging_reconciliation"."lease_owner" is null) = ("staging_reconciliation"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "staging_reconciliation_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"desired_sha" text NOT NULL,
	"phase" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_onboarding" (
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"team_id" text NOT NULL,
	"target_team_id" text,
	"forgejo_owner" text NOT NULL,
	"forgejo_repository" text NOT NULL,
	"phase" text DEFAULT 'validating' NOT NULL,
	"target_sha" text,
	"contract_version" integer,
	"compatibility_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_plan" jsonb,
	"last_error" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_onboarding_tenant_id_system_id_pk" PRIMARY KEY("tenant_id","system_id"),
	CONSTRAINT "system_onboarding_system_id_check" CHECK ("system_onboarding"."system_id" = "system_onboarding"."forgejo_owner" || '/' || "system_onboarding"."forgejo_repository"),
	CONSTRAINT "system_onboarding_phase_check" CHECK ("system_onboarding"."phase" in ('validating', 'applying-access', 'applying-policy', 'creating-staging', 'ready', 'retry-wait', 'repair', 'failed', 'reassigning', 'reassigning-access', 'unregistering', 'removed')),
	CONSTRAINT "system_onboarding_lease_check" CHECK (("system_onboarding"."lease_owner" is null) = ("system_onboarding"."lease_expires_at" is null)),
	CONSTRAINT "system_onboarding_attempts_check" CHECK ("system_onboarding"."attempts" >= 0),
	CONSTRAINT "system_onboarding_generation_check" CHECK ("system_onboarding"."lease_generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE "system_onboarding_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"phase" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_registration" (
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"team_id" text NOT NULL,
	"forgejo_owner" text NOT NULL,
	"forgejo_repository" text NOT NULL,
	"projection" jsonb,
	"projection_updated_at" timestamp with time zone,
	"projection_error" text,
	"projection_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_registration_tenant_id_system_id_pk" PRIMARY KEY("tenant_id","system_id"),
	CONSTRAINT "system_registration_system_id_check" CHECK ("system_registration"."system_id" = "system_registration"."forgejo_owner" || '/' || "system_registration"."forgejo_repository")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"preferred_username" text DEFAULT '' NOT NULL,
	"groups" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_startup" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"system_id" text NOT NULL,
	"workspace_kind" text NOT NULL,
	"repository_sha" text NOT NULL,
	"contract_version" integer NOT NULL,
	"architecture" text NOT NULL,
	"cache_key" text NOT NULL,
	"cache_state" text DEFAULT 'unknown' NOT NULL,
	"outcome" text DEFAULT 'starting' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_startup_kind_check" CHECK ("workspace_startup"."workspace_kind" in ('developer', 'ticket', 'staging', 'verification')),
	CONSTRAINT "workspace_startup_cache_check" CHECK ("workspace_startup"."cache_state" in ('unknown', 'warm', 'cold')),
	CONSTRAINT "workspace_startup_outcome_check" CHECK ("workspace_startup"."outcome" in ('starting', 'ready', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coder_user_binding" ADD CONSTRAINT "coder_user_binding_factory_user_id_user_id_fk" FOREIGN KEY ("factory_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_system_registration_fk" FOREIGN KEY ("tenant_id","system_id") REFERENCES "public"."system_registration"("tenant_id","system_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_completion" ADD CONSTRAINT "delivery_completion_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_contributor" ADD CONSTRAINT "delivery_contributor_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_contributor" ADD CONSTRAINT "delivery_contributor_factory_user_id_user_id_fk" FOREIGN KEY ("factory_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lifecycle_event" ADD CONSTRAINT "delivery_lifecycle_event_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_verification" ADD CONSTRAINT "delivery_verification_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_verification" ADD CONSTRAINT "delivery_verification_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation" ADD CONSTRAINT "operation_delivery_contributor_fk" FOREIGN KEY ("delivery_id","factory_user_id") REFERENCES "public"."delivery_contributor"("delivery_id","factory_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_reconciliation" ADD CONSTRAINT "staging_reconciliation_registration_fk" FOREIGN KEY ("tenant_id","system_id") REFERENCES "public"."system_registration"("tenant_id","system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_reconciliation_event" ADD CONSTRAINT "staging_reconciliation_event_state_fk" FOREIGN KEY ("tenant_id","system_id") REFERENCES "public"."staging_reconciliation"("tenant_id","system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_onboarding_event" ADD CONSTRAINT "system_onboarding_event_onboarding_fk" FOREIGN KEY ("tenant_id","system_id") REFERENCES "public"."system_onboarding"("tenant_id","system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_startup" ADD CONSTRAINT "workspace_startup_registration_fk" FOREIGN KEY ("tenant_id","system_id") REFERENCES "public"."system_registration"("tenant_id","system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_uq" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_identity_uq" ON "delivery" USING btree ("tenant_id","system_id","requirement_number","accepted_digest");--> statement-breakpoint
CREATE INDEX "delivery_requirement_idx" ON "delivery" USING btree ("tenant_id","system_id","requirement_number","created_at");--> statement-breakpoint
CREATE INDEX "delivery_creator_idx" ON "delivery" USING btree ("created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_completion_due_idx" ON "delivery_completion" USING btree ("phase","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "delivery_contributor_user_idx" ON "delivery_contributor" USING btree ("factory_user_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_lifecycle_event_timeline_idx" ON "delivery_lifecycle_event" USING btree ("delivery_id","id");--> statement-breakpoint
CREATE INDEX "delivery_verification_due_idx" ON "delivery_verification" USING btree ("phase","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_id_idx" ON "oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_session_id_idx" ON "oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_id_idx" ON "oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_authorization_code_id_idx" ON "oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refresh_id_idx" ON "oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauth_client_user_id_idx" ON "oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_client_id_idx" ON "oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resource_id_idx" ON "oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_client_resource_client_resource_uq" ON "oauth_client_resource" USING btree ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_id_idx" ON "oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_id_idx" ON "oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_client_id_idx" ON "oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_session_id_idx" ON "oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_user_id_idx" ON "oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorization_code_id_idx" ON "oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_delivery_kind_uq" ON "operation" USING btree ("delivery_id","kind") WHERE "operation"."state" in ('pending', 'running', 'ambiguous', 'succeeded');--> statement-breakpoint
CREATE UNIQUE INDEX "operation_external_id_uq" ON "operation" USING btree ("kind","external_id") WHERE "operation"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "operation_reconcile_idx" ON "operation" USING btree ("state","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staging_reconciliation_due_idx" ON "staging_reconciliation" USING btree ("phase","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "staging_reconciliation_event_timeline_idx" ON "staging_reconciliation_event" USING btree ("tenant_id","system_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_onboarding_forgejo_repository_uq" ON "system_onboarding" USING btree ("tenant_id","forgejo_owner","forgejo_repository");--> statement-breakpoint
CREATE INDEX "system_onboarding_reconcile_idx" ON "system_onboarding" USING btree ("phase","lease_expires_at","updated_at");--> statement-breakpoint
CREATE INDEX "system_onboarding_event_timeline_idx" ON "system_onboarding_event" USING btree ("tenant_id","system_id","id");--> statement-breakpoint
CREATE INDEX "system_registration_team_idx" ON "system_registration" USING btree ("tenant_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_registration_forgejo_repository_uq" ON "system_registration" USING btree ("tenant_id","forgejo_owner","forgejo_repository");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workspace_startup_slo_idx" ON "workspace_startup" USING btree ("workspace_kind","cache_state","outcome","requested_at");
