/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { createAuthCore } from './auth';
import { FactoryAuthService } from './auth/service';
import { UserDeprovisionService, UserDeprovisionStore } from './auth/deprovision';
import { createDatabase } from '@agentic-software-factory/db';
import { assertDatabaseSchema, bundledMigrationsFolder, closeDatabase } from '@agentic-software-factory/db/migrate';
import { loadRuntimeConfig } from './env';
import { ForgejoClient } from './forgejo/client';
import { forgejoTeamAccess, forgejoTeamName } from './forgejo/access';
import { CoderClient } from './integrations/coder';
import { ImplementationStore } from './implementation/store';
import { ImplementationService } from './implementation/service';
import { createInterviewOperationReconciler, createServer, createServerServices } from './server';
import { ApplicationRegistry } from './applications/registry';
import { inspectSystemContract, systemContractReferences } from './applications/system-contract';
import { ApplicationStore } from './applications/store';
import { ApplicationOnboarding } from './applications/onboarding';
import { DatabaseOnboardingLifecycleStore } from './applications/onboarding-store';
import { systemDisplayName } from './applications/catalog';
import { StagingReconciler } from './applications/staging';
import { StagingStore } from './applications/staging-store';
import { WorkspaceStartupMetrics } from './applications/startup-metrics';
import { RetentionService } from './operations/retention';
import { OtlpTraceExporter } from './operations/tracing';
import { and, arrayContains, arrayOverlaps, asc, eq, sql } from 'drizzle-orm';
import { coderUserBinding, user } from '@agentic-software-factory/db/schema';
import { WorkerHost } from './worker-host';

const config = loadRuntimeConfig();
const database = createDatabase(config.databaseUrl, config.databaseTlsCa);
let app: ReturnType<typeof createServer> | undefined;
let workers: WorkerHost | undefined;
let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'shutdown', signal }));
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  try {
    if (app) await app.stop();
    if (workers) await workers.stop();
    await closeDatabase(database.sql);
    clearTimeout(timeout);
    process.exitCode = 0;
  } catch {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'shutdown_failed' }));
    clearTimeout(timeout);
    process.exitCode = 1;
  }
};
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

try {
  await assertDatabaseSchema(database.db, bundledMigrationsFolder);
  const authCore = await createAuthCore(database.db, config.auth);
  const auth = new FactoryAuthService(authCore, config.auth, database.db);
  const forgejo = new ForgejoClient(
    config.forgejo.baseUrl,
    config.forgejo.token,
    config.forgejo.owner,
    '',
    config.forgejo.branch,
  );
  const coder = new CoderClient({
    baseUrl: config.coder.baseUrl,
    publicUrl: config.coder.publicUrl,
    wildcardAccessUrl: config.coder.wildcardAccessUrl,
    token: config.coder.token,
    mcpUrl: config.coder.mcpUrl,
    fetch: globalThis.fetch.bind(globalThis),
  }).configureVerificationOwner(config.coder.verificationOwnerId, config.coder.verificationOwner)
    .configureStagingOwner(config.coder.stagingOwnerId, config.coder.stagingOwner)
    .configureRestrictedAppSharing(config.coder.restrictedAppSharing)
    .configureUserBindings({
    async findByFactoryUserId(factoryUserId) {
      const [mapping] = await database.db.select({ coderUserId: coderUserBinding.coderUserId }).from(coderUserBinding)
        .where(eq(coderUserBinding.factoryUserId, factoryUserId)).limit(1);
      return mapping ?? null;
    },
    async bind(input) {
      const [active] = await database.db.select({ id: user.id }).from(user)
        .where(and(eq(user.id, input.factoryUserId), sql`${user.deprovisionedAt} is null`)).limit(1);
      if (!active) throw new Error('Factory user is deprovisioned');
      await database.db.insert(coderUserBinding).values(input);
    },
    async findByCoderUserId(coderUserId) {
      const [mapping] = await database.db.select({ factoryUserId: coderUserBinding.factoryUserId }).from(coderUserBinding)
        .where(eq(coderUserBinding.coderUserId, coderUserId)).limit(1);
      return mapping ?? null;
    },
  }, config.application.coderOrganization, config.application.coderTemplate, config.tenant.workspaceNamespace);
  coder.configureTenant(config.tenant.id);
  const projectForgejo = new ForgejoClient(
    config.forgejo.baseUrl,
    config.forgejo.implementationToken,
    config.forgejo.owner,
    '',
    config.forgejo.branch,
  );
  const reviewForgejo = new ForgejoClient(
    config.forgejo.baseUrl,
    config.forgejo.reviewToken,
    config.forgejo.owner,
    '',
    config.forgejo.branch,
  );
  coder.configureRepositoryRefs({
    async resolve(repositoryUrl, branch, signal) {
      const parts = new URL(repositoryUrl).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
      const repository = parts.pop();
      const owner = parts.pop();
      if (!owner || !repository) throw new Error('repository URL does not identify a Forgejo repository');
      return projectForgejo.getProjectBranchHead(owner, repository, branch, signal);
    },
    async workspaceContract(repositoryUrl, repositoryRef, kind, signal) {
      const parts = new URL(repositoryUrl).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
      const repository = parts.pop();
      const owner = parts.pop();
      if (!owner || !repository) throw new Error('repository URL does not identify a Forgejo repository');
      const contract = await loadSystemContract(projectForgejo, owner, repository, repositoryRef, signal);
      return kind === 'verification' ? contract.verification : contract.developer;
    },
  });
  const implementationForgejo = forgejo.withPullReviewActor(reviewForgejo);
  const applicationStore = new ApplicationStore(database.db, config.tenant.id);
  const applications = new ApplicationRegistry(applicationStore, async (registration, previous) => {
    const repository = await forgejo.getProjectRepository(registration.repositoryOwner, registration.repositoryName);
    const defaultSha = await forgejo.getProjectBranchHead(registration.repositoryOwner, registration.repositoryName, repository.default_branch);
    if (previous?.defaultBranch === repository.default_branch && previous.defaultSha === defaultSha) {
      return { ...previous, ...registration };
    }
    const [contract, readme] = await Promise.all([
      loadSystemContract(forgejo, registration.repositoryOwner, registration.repositoryName, defaultSha),
      forgejo.readProjectFile(registration.repositoryOwner, registration.repositoryName, defaultSha, 'README.md').catch(() => ''),
    ]);
    return {
      ...registration,
      id: `${registration.repositoryOwner}/${registration.repositoryName}`,
      name: systemDisplayName(repository.name),
      description: repository.description || '',
      repositoryUrl: repository.html_url,
      cloneUrl: `${config.forgejo.baseUrl.replace(/\/$/, '')}/${registration.repositoryOwner}/${registration.repositoryName}.git`,
      defaultBranch: repository.default_branch,
      defaultSha,
      systemContext: repositoryContext(repository.name, repository.description || '', repository.default_branch, contract.developer.apps, readme),
      declaredApps: contract.developer.apps.filter((app) => app.url !== undefined)
        .map(({ slug, displayName }) => ({ slug, displayName: displayName ?? slug })),
      workspaceApps: contract.developer.apps,
    };
  });
  const onboardingLifecycle = new DatabaseOnboardingLifecycleStore(database.db, config.tenant.id);
  const startupMetrics = new WorkspaceStartupMetrics(database.db, config.tenant.id);
  const staging = new StagingReconciler(
    applications,
    coder,
    new StagingStore(database.db, config.tenant.id),
    startupMetrics,
    config.application.coderTemplate,
    config.tenant.workspaceNamespace,
  );
  const applicationOnboarding = new ApplicationOnboarding(forgejo, applications, onboardingLifecycle, {
    owners: config.forgejo.authorizedOwners,
    implementationUser: config.forgejo.implementationUser,
    reviewUser: config.forgejo.reviewUser,
    cloneUser: config.forgejo.cloneUser,
    teams: config.tenant.teams.map((team) => ({
      slug: team.slug,
      forgejoTeam: forgejoTeamName(config.forgejo.humanTeam, config.tenant.id, team.slug),
    })),
  }, staging, (repository, signal) => staging.delete(
    repository.systemId,
    `${config.forgejo.baseUrl.replace(/\/$/, '')}/${repository.repositoryOwner}/${repository.repositoryName}.git`,
    signal,
  ));
  const retention = new RetentionService(database.db, config.tenant.id);
  const tracing = config.otel ? new OtlpTraceExporter(config.otel.endpoint, config.otel.serviceName) : null;
  let integrationActor = '';
  let reviewActor = config.forgejo.reviewUser;
  const reconcileBranchProtection = async (signal?: AbortSignal): Promise<void> => {
    if (!integrationActor) throw new Error('Forgejo automation identities are not initialized');
    await Promise.all((await applications.list()).map(async (application) => {
      await forgejo.ensureMainBranchProtection(
        application.repositoryOwner,
        application.repositoryName,
        application.defaultBranch,
        { mergeActor: integrationActor, reviewActor },
        signal,
      );
      await forgejo.ensureCollaborator(
        application.repositoryOwner,
        application.repositoryName,
        reviewActor,
        'read',
        signal,
      );
      await forgejo.ensureCollaborator(
        application.repositoryOwner,
        application.repositoryName,
        config.forgejo.implementationUser,
        'write',
        signal,
      );
      await forgejo.ensureCollaborator(
        application.repositoryOwner,
        application.repositoryName,
        config.forgejo.cloneUser,
        'read',
        signal,
      );
      await forgejo.ensureImplementationBranchProtection(
        application.repositoryOwner,
        application.repositoryName,
        config.forgejo.implementationUser,
        signal,
      );
    }));
  };
  const reconcileForgejoHumanAccess = async (signal?: AbortSignal): Promise<void> => {
    const [registered, tenantUsers] = await Promise.all([
      applications.list(),
      database.db.select({ username: user.preferredUsername, groups: user.groups }).from(user)
        .where(and(arrayContains(user.groups, [config.tenant.group]), sql`${user.deprovisionedAt} is null`)),
    ]);
    const access = forgejoTeamAccess({
      baseTeam: config.forgejo.humanTeam,
      tenantTeam: config.tenant.id,
      tenantGroup: config.tenant.group,
      teams: config.tenant.teams,
      applications: registered,
      users: tenantUsers,
      serviceUsers: [config.forgejo.implementationUser, config.forgejo.reviewUser, config.forgejo.cloneUser],
    });
    await Promise.all(access.map((team) => forgejo.ensureReadTeam(
      config.forgejo.owner,
      team.name,
      team.usernames,
      team.repositories,
      signal,
      false,
    )));
  };
  let systemDependencyError: Error | null = new Error('External services are initializing');
  const reconcileForgejoHumanAccessGlobally = async (signal?: AbortSignal): Promise<boolean> => {
    const connection = await database.sql.reserve();
    const key = `forgejo-human-access:${config.tenant.id}`;
    let acquired = false;
    try {
      const [result] = await connection<{ acquired: boolean }[]>`
        select pg_try_advisory_lock(hashtextextended(${key}, 0)) as acquired
      `;
      acquired = result?.acquired === true;
      if (acquired) await reconcileForgejoHumanAccess(signal);
      return acquired;
    } finally {
      if (acquired) await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      connection.release();
    }
  };
  const systemsReady = async (): Promise<void> => {
    if (systemDependencyError) throw systemDependencyError;
  };
  const withRequirementWriteLock = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    const connection = await database.sql.reserve();
    try {
      await connection`select pg_advisory_lock(hashtextextended(${key}, 0))`;
      return await action();
    } finally {
      await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`.catch(() => undefined);
      connection.release();
    }
  };
  const implementationStore = new ImplementationStore(database.db, config.tenant.id);
  workers = new WorkerHost();
  const userDeprovision = new UserDeprovisionService(
    new UserDeprovisionStore(database.db),
    coder,
    forgejo,
    () => workers?.wake('forgejo-human-access') ?? false,
  );
  const implementation = new ImplementationService(
    implementationStore,
    implementationForgejo,
    projectForgejo,
    coder,
    config.forgejo.publicUrl,
    config.forgejo.implementationUser,
    applications,
    {
      reviewActor,
      coderPublicUrl: config.coder.publicUrl,
      coderTemplate: config.application.coderTemplate,
      workspaceNamespace: config.tenant.workspaceNamespace,
      onMerged: async (applicationId) => {
        applications.invalidate(applicationId);
        await staging.reconcileById(applicationId);
      },
      startupMetrics,
      onOperationReserved: () => workers?.wake('implementation-operations'),
      withRequirementWriteLock,
    },
  );
  const reconcileImplementationOperations = async (signal?: AbortSignal): Promise<void> => {
    for (const operation of await implementationStore.reconcilableOperations()) {
      if (signal?.aborted) return;
      const [found] = await database.db.select().from(user).where(eq(user.id, operation.factoryUserId)).limit(1);
      if (!found) continue;
      await implementation.resumeOperation(operation, {
        issuer: config.auth.issuer,
        subject: found.id,
        email: found.email,
        emailVerified: found.emailVerified,
        name: found.name,
        username: found.preferredUsername,
        groups: found.groups,
      }, signal).catch((error) => console.error(JSON.stringify({
        timestamp: new Date().toISOString(), level: 'error', event: 'implementation_operation_reconcile_failed',
        operationId: operation.idempotencyKey, error: error instanceof Error ? error.message : String(error),
      })));
    }
  };
  const reconcileDeliveryCompletions = async (signal?: AbortSignal): Promise<void> => {
    for (const completion of await implementationStore.reconcilableCompletions()) {
      if (signal?.aborted) return;
      await implementation.reconcileCompletion(completion, signal).catch((error) => console.error(JSON.stringify({
        timestamp: new Date().toISOString(), level: 'error', event: 'delivery_completion_reconcile_failed',
        deliveryId: completion.deliveryId, error: error instanceof Error ? error.message : String(error),
      })));
    }
  };
  const reconcileDeliveryVerifications = async (signal?: AbortSignal): Promise<void> => {
    for (const verification of await implementationStore.reconcilableVerifications()) {
      if (signal?.aborted) return;
      const identity = await database.db.select().from(user).where(eq(user.id, verification.requestedByUserId)).limit(1).then((rows) => rows[0]);
      if (!identity) continue;
      await implementation.reconcileVerification(verification, {
        issuer: config.auth.issuer, subject: identity.id, email: identity.email, emailVerified: identity.emailVerified,
        name: identity.name, username: identity.preferredUsername, groups: identity.groups,
      }, signal).catch((error) => console.error(JSON.stringify({
        timestamp: new Date().toISOString(), level: 'error', event: 'delivery_verification_reconcile_failed',
        deliveryId: verification.deliveryId, error: error instanceof Error ? error.message : String(error),
      })));
    }
  };
  const serverServices = createServerServices({
    auth,
    authPublicOrigin: new URL(config.auth.issuer).origin,
    forgejo,
    coder,
    coderPublicUrl: config.coder.publicUrl,
    coderTemplate: config.application.coderTemplate,
    workspaceNamespace: config.tenant.workspaceNamespace,
    implementation,
    applications,
    listUsers: async ({ groups, limit }) => ({
      users: (await database.db.select({
        id: user.id,
        username: user.preferredUsername,
        displayName: user.name,
        email: user.email,
      }).from(user).where(and(
        arrayContains(user.groups, [config.tenant.group]),
        sql`${user.deprovisionedAt} is null`,
        ...(groups?.length ? [arrayOverlaps(user.groups, [...groups])] : []),
      )).orderBy(asc(user.name), asc(user.id)).limit(limit))
        .map((found) => ({
          ...found,
          initials: found.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'U',
        })),
    }),
    deprovisionUser: (factoryUserId) => userDeprovision.deprovision(factoryUserId, config.tenant.group),
    applicationOnboarding,
    staging,
    tenant: {
      id: config.tenant.id,
      group: config.tenant.group,
      adminGroup: config.tenant.adminGroup,
      businessGroup: config.tenant.businessGroup,
      developerGroup: config.tenant.developerGroup,
      teams: config.tenant.teams,
    },
    identityByUserId: async (factoryUserId: string) => {
      const [found] = await database.db.select().from(user).where(and(eq(user.id, factoryUserId), sql`${user.deprovisionedAt} is null`)).limit(1);
      return found ? { issuer: config.auth.issuer, subject: found.id, email: found.email, emailVerified: found.emailVerified, name: found.name, username: found.preferredUsername, groups: found.groups } : null;
    },
    databaseReady: async () => { await database.db.execute('select 1'); },
    systemsReady,
    systemsStatus: () => staging.status(),
    workspaceStartupSummary: (since) => startupMetrics.summary(since),
    measureWorkspaceStartup: (input, action) => startupMetrics.measure(input, action),
    ...(tracing ? { trace: (span: import('./operations/tracing').HttpSpan) => tracing.export(span) } : {}),
    withInterviewOperationLock: async (key, action) => {
      const connection = await database.sql.reserve();
      let acquired = false;
      try {
        const [result] = await connection<{ acquired: boolean }[]>`
          select pg_try_advisory_lock(hashtextextended(${key}, 0)) as acquired
        `;
        acquired = result?.acquired === true;
        if (acquired) await action();
      } finally {
        if (acquired) await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
        connection.release();
      }
    },
    withRequirementWriteLock,
    forgejoPublicUrl: config.forgejo.publicUrl,
    allowedOrigins: config.allowedOrigins,
    trustedProxyCidrs: config.trustedProxyCidrs,
    rateLimits: { writes: new URL(config.auth.issuer).hostname.endsWith('localhost') ? 200 : 20 },
    ...(config.webRoot ? { webRoot: config.webRoot } : {}),
  });
  const interviewOperations = createInterviewOperationReconciler(serverServices);
  app = createServer(serverServices, interviewOperations);
  if (!shuttingDown) {
    app.listen({ hostname: config.host, port: config.port, maxRequestBodySize: 1024 * 1024 });
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'server_listening', host: config.host, port: config.port }));
    const initializeExternalServices = async (signal?: AbortSignal): Promise<void> => {
      try {
        const [, integration, implementation, review] = await Promise.all([
          Promise.all([coder.assertVerificationAutomationOwner(signal), coder.assertStagingAutomationOwner(signal)]),
          forgejo.authenticatedUser(signal).then((actor) => actor.login),
          projectForgejo.assertAuthenticatedLogin(config.forgejo.implementationUser),
          reviewForgejo.assertAuthenticatedLogin(config.forgejo.reviewUser),
        ]);
        if (implementation !== config.forgejo.implementationUser) throw new Error('Forgejo implementation actor mismatch');
        integrationActor = integration;
        reviewActor = review;
        forgejo.configureBranchProtectionActors(integrationActor, reviewActor);
        await Promise.all([reconcileBranchProtection(signal), reconcileForgejoHumanAccessGlobally(signal), coder.reconcileFactoryMcpConfiguration(signal)]);
        systemDependencyError = null;
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'external_services_initialized' }));
      } catch (error) {
        systemDependencyError = error instanceof Error ? error : new Error(String(error));
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(), level: 'warn', event: 'external_services_initialization_failed',
          error: systemDependencyError.message,
        }));
      }
    };
    workers.start({ name: 'external-services', intervalMs: 30_000, immediate: true, failureEvent: 'external_services_worker_failed', failureLevel: 'warn', run: initializeExternalServices });
    workers.start({
      name: 'forgejo-human-access', intervalMs: 30_000, failureEvent: 'forgejo_human_access_reconcile_failed', failureLevel: 'warn',
      run: async (signal) => {
        if (systemDependencyError || !await reconcileForgejoHumanAccessGlobally(signal)) return;
        await userDeprovision.reconcileForgejo(undefined, signal);
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'forgejo_human_access_reconciled' }));
      },
    });
    workers.start({ name: 'coder-user-deprovision', intervalMs: 30_000, failureEvent: 'coder_user_deprovision_failed', failureLevel: 'warn', run: (signal) => userDeprovision.reconcileCoder(signal) });
    workers.start({ name: 'implementation-operations', intervalMs: 5_000, immediate: true, failureEvent: 'implementation_operations_reconcile_failed', run: reconcileImplementationOperations });
    workers.start({ name: 'delivery-completions', intervalMs: 5_000, immediate: true, failureEvent: 'delivery_completions_reconcile_failed', run: reconcileDeliveryCompletions });
    workers.start({ name: 'delivery-verifications', intervalMs: 5_000, immediate: true, failureEvent: 'delivery_verifications_reconcile_failed', run: reconcileDeliveryVerifications });
    workers.start({ name: 'interview-operations', intervalMs: 5_000, immediate: true, failureEvent: 'interview_operations_reconcile_failed', run: (signal) => interviewOperations.reconcile(signal) });
    workers.start({ name: 'application-onboarding', intervalMs: 10_000, immediate: true, failureEvent: 'application_onboarding_reconcile_failed', failureLevel: 'warn', run: (signal) => applicationOnboarding.reconcileDue(signal) });
    workers.start({ name: 'staging', intervalMs: 30_000, immediate: true, failureEvent: 'staging_reconcile_failed', failureLevel: 'warn', run: (signal) => staging.reconcileAll(signal) });
    workers.start({ name: 'retention', intervalMs: 24 * 60 * 60_000, immediate: true, failureEvent: 'retention_sweep_failed', failureLevel: 'warn', run: () => retention.sweep() });
  }
} catch (error) {
  await closeDatabase(database.sql).catch(() => undefined);
  if (shuttingDown) process.exitCode = 0;
  else throw error;
}

function repositoryContext(name: string, description: string, branch: string, apps: Array<{ displayName?: string; slug: string }>, readme: string): string {
  const header = `Repository: ${name}\nDescription: ${description || 'No description'}\nDefault branch: ${branch}\nApplications: ${apps.map((app) => app.displayName || app.slug).join(', ') || 'None'}`;
  return `${header}\n\nREADME at the exact default commit:\n${readme.slice(0, 32 * 1024)}`;
}

async function loadSystemContract(
  forgejo: ForgejoClient,
  owner: string,
  repository: string,
  ref: string,
  signal?: AbortSignal,
) {
  const manifest = await forgejo.readProjectFile(owner, repository, ref, '.factory/system.yaml', signal);
  const references = systemContractReferences(manifest);
  if (!references.valid) throw Object.assign(new Error('System repository is incompatible'), { status: 422, issues: references.issues });
  const artifacts = new Map(await Promise.all(references.paths.map(async (path) => [
    path,
    await forgejo.readProjectFile(owner, repository, ref, path, signal),
  ] as const)));
  const result = inspectSystemContract(manifest, artifacts);
  if (!result.compatible) throw Object.assign(new Error('System repository is incompatible'), { status: 422, issues: result.issues });
  return result.contract;
}
