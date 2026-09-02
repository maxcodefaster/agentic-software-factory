/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

import type { WorkspaceApplication, WorkspaceContract } from './devcontainer';

const relativePath = z.string().min(1).max(256).refine((value) => {
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  const parts = value.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}, 'must be a clean repository-relative path');
const command = z.string().trim().min(1).max(4_096).refine((value) => !value.includes('\0'), 'must not contain NUL');
const loopbackHttpUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'http:' && !url.username && !url.password
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}, 'must be a loopback HTTP URL without credentials');

const applicationSchema = z.object({
  slug: z.string().max(28).regex(/^[a-z0-9](?:-?[a-z0-9])*$/),
  displayName: z.string().trim().min(1).max(64),
  url: loopbackHttpUrl,
  verification: z.enum(['required', 'excluded']).default('required'),
  health: z.object({
    url: loopbackHttpUrl,
    intervalSeconds: z.number().int().min(2).max(60),
    failureThreshold: z.number().int().min(2).max(120),
  }).strict(),
}).strict().superRefine((application, context) => {
  if (new URL(application.url).port !== new URL(application.health.url).port) {
    context.addIssue({ code: 'custom', path: ['health', 'url'], message: 'must use the application port' });
  }
});

const supervisorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('process-compose'),
    config: relativePath,
    control: z.object({
      address: z.enum(['127.0.0.1', 'localhost', '::1']),
      port: z.number().int().min(1_024).max(65_535),
    }).strict(),
    commands: z.object({ status: command, attach: command, logs: command, restart: command.optional(), shutdown: command }).strict(),
  }).strict(),
  z.object({
    kind: z.literal('custom'),
    commands: z.object({ status: command, attach: command.optional(), logs: command.optional(), restart: command.optional(), shutdown: command }).strict(),
  }).strict(),
]);

const manifestSchema = z.object({
  version: z.literal(1),
  development: z.object({ devcontainer: relativePath }).strict(),
  verification: z.object({ devcontainer: relativePath }).strict(),
  runtime: z.object({
    supervisor: supervisorSchema,
    startupTimeoutSeconds: z.number().int().min(10).max(600),
  }).strict(),
  ide: z.object({
    tasks: relativePath,
    processTask: z.string().trim().min(1).max(128),
  }).strict().optional(),
  applications: z.array(applicationSchema).max(32),
  release: z.object({ manifest: relativePath }).strict().optional(),
}).strict();

export interface CompatibilityIssue {
  path: string;
  code: string;
  message: string;
}

export interface SystemContract {
  version: 1;
  developmentDevcontainer: string;
  verificationDevcontainer: string;
  supervisor: z.infer<typeof supervisorSchema>;
  startupTimeoutSeconds: number;
  applications: Array<z.infer<typeof applicationSchema>>;
  developer: WorkspaceContract;
  verification: WorkspaceContract;
}

export type CompatibilityResult =
  | { compatible: true; contract: SystemContract }
  | { compatible: false; issues: CompatibilityIssue[] };

export type SystemContractReferenceResult =
  | { valid: true; paths: string[] }
  | { valid: false; issues: CompatibilityIssue[] };

export function systemContractReferences(manifestSource: string): SystemContractReferenceResult {
  const parsed = parseManifest(manifestSource);
  if (!parsed.success) return { valid: false, issues: parsed.issues };
  const manifest = parsed.manifest;
  const paths = [manifest.development.devcontainer, manifest.verification.devcontainer];
  if (manifest.runtime.supervisor.kind === 'process-compose') paths.push(manifest.runtime.supervisor.config);
  return { valid: true, paths: [...new Set(paths)] };
}

export function inspectSystemContract(manifestSource: string, artifacts: ReadonlyMap<string, string>): CompatibilityResult {
  const parsed = parseManifest(manifestSource);
  if (!parsed.success) return { compatible: false, issues: parsed.issues };
  const manifest = parsed.manifest;
  const issues: CompatibilityIssue[] = [];
  const requiredPaths = [manifest.development.devcontainer, manifest.verification.devcontainer];
  if (manifest.runtime.supervisor.kind === 'process-compose') requiredPaths.push(manifest.runtime.supervisor.config);
  for (const path of new Set(requiredPaths)) {
    if (!artifacts.has(path)) issues.push({ path, code: 'missing-file', message: `Required by .factory/system.yaml but ${path} does not exist at this commit.` });
  }

  const slugs = new Set<string>();
  for (const application of manifest.applications) {
    if (slugs.has(application.slug)) issues.push({ path: '.factory/system.yaml:applications', code: 'duplicate-slug', message: `Application slug ${application.slug} is duplicated.` });
    slugs.add(application.slug);
  }
  validateDevcontainer(manifest.development.devcontainer, artifacts.get(manifest.development.devcontainer), false, manifest.applications, issues);
  validateDevcontainer(manifest.verification.devcontainer, artifacts.get(manifest.verification.devcontainer), true, manifest.applications.filter((application) => application.verification === 'required'), issues);
  if (issues.length > 0) return { compatible: false, issues };

  const toApp = (application: z.infer<typeof applicationSchema>, share: 'owner' | 'authenticated'): WorkspaceApplication => ({
    slug: application.slug,
    displayName: application.displayName,
    url: application.url,
    share,
    healthCheck: {
      url: application.health.url,
      interval: application.health.intervalSeconds,
      threshold: application.health.failureThreshold,
    },
  });
  const developer = manifest.applications.map((application) => toApp(application, 'owner'));
  const verification = manifest.applications.filter((application) => application.verification === 'required')
    .map((application) => toApp(application, 'authenticated'));
  return {
    compatible: true,
    contract: {
      version: 1,
      developmentDevcontainer: manifest.development.devcontainer,
      verificationDevcontainer: manifest.verification.devcontainer,
      supervisor: manifest.runtime.supervisor,
      startupTimeoutSeconds: manifest.runtime.startupTimeoutSeconds,
      applications: manifest.applications,
      developer: {
        apps: developer,
        devcontainerPath: manifest.development.devcontainer,
        supervisorCommands: manifest.runtime.supervisor.commands,
        shutdownCommand: manifest.runtime.supervisor.commands.shutdown,
        startupTimeoutSeconds: manifest.runtime.startupTimeoutSeconds,
        contractVersion: 1,
      },
      verification: {
        apps: verification,
        devcontainerPath: manifest.verification.devcontainer,
        supervisorCommands: manifest.runtime.supervisor.commands,
        shutdownCommand: manifest.runtime.supervisor.commands.shutdown,
        startupTimeoutSeconds: manifest.runtime.startupTimeoutSeconds,
        contractVersion: 1,
      },
    },
  };
}

function parseManifest(source: string): { success: true; manifest: z.infer<typeof manifestSchema> } | { success: false; issues: CompatibilityIssue[] } {
  let value: unknown;
  try { value = Bun.YAML.parse(source); }
  catch (error) {
    return { success: false, issues: [{ path: '.factory/system.yaml', code: 'invalid-yaml', message: error instanceof Error ? error.message : 'must be valid YAML' }] };
  }
  const parsed = manifestSchema.safeParse(value);
  if (parsed.success) return { success: true, manifest: parsed.data };
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      path: ['.factory/system.yaml', ...issue.path.map(String)].join(':'),
      code: 'invalid-contract',
      message: issue.message,
    })),
  };
}

function validateDevcontainer(
  path: string,
  source: string | undefined,
  verification: boolean,
  expectedApps: Array<z.infer<typeof applicationSchema>>,
  issues: CompatibilityIssue[],
): void {
  if (source === undefined) return;
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { issues.push({ path, code: 'invalid-json', message: `${path} must be valid JSON.` }); return; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path, code: 'invalid-devcontainer', message: `${path} must contain a Dev Container object.` });
    return;
  }
  const config = value as Record<string, unknown>;
  const build = config.build;
  if (build && typeof build === 'object' && !Array.isArray(build) && 'dockerfile' in build) {
    const target = (build as Record<string, unknown>).target;
    if (typeof target !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(target)) {
      issues.push({ path: `${path}:build.target`, code: 'missing-build-target', message: 'Dockerfile Dev Containers must select one explicit build target.' });
    }
  }
  for (const field of ['dockerComposeFile', 'service', 'runServices', 'runArgs', 'privileged', 'capAdd', 'securityOpt', 'mounts', 'initializeCommand']) {
    if (field in config) issues.push({ path: `${path}:${field}`, code: 'unsupported-field', message: `${field} is not supported by the Kubernetes runtime.` });
  }
  if (!validLifecycleCommand(config.postStartCommand)) {
    issues.push({ path: `${path}:postStartCommand`, code: 'missing-start-lifecycle', message: 'A non-empty postStartCommand must start the repository runtime.' });
  }
  if (verification) {
    if (config.workspaceMount !== 'source=${localWorkspaceFolder},target=/workspaces/project,type=bind,readonly') {
      issues.push({ path: `${path}:workspaceMount`, code: 'verification-not-readonly', message: 'Verification source must use the platform read-only workspace mount.' });
    }
    if (config.workspaceFolder !== '/workspaces/project') {
      issues.push({ path: `${path}:workspaceFolder`, code: 'invalid-workspace-folder', message: 'Verification workspaceFolder must be /workspaces/project.' });
    }
  } else if ('workspaceMount' in config || 'workspaceFolder' in config) {
    issues.push({ path, code: 'workspace-path-override', message: 'Development must use the platform workspace path.' });
  }
  const coder = config.customizations && typeof config.customizations === 'object'
    ? (config.customizations as { coder?: unknown }).coder : undefined;
  const declared = coder && typeof coder === 'object' && Array.isArray((coder as { apps?: unknown }).apps)
    ? (coder as { apps: Array<Record<string, unknown>> }).apps : [];
  if (declared.length === 0) return;
  const expected = new Map(expectedApps.map((application) => [application.slug, application]));
  if (declared.length !== expected.size) {
    issues.push({ path: `${path}:customizations.coder.apps`, code: 'application-set-drift', message: 'Coder app declarations must match the canonical application set or be omitted.' });
  }
  for (const app of declared) {
    const canonical = typeof app.slug === 'string' ? expected.get(app.slug) : undefined;
    if (!canonical || app.url !== canonical.url) {
      issues.push({ path: `${path}:customizations.coder.apps`, code: 'application-drift', message: `Coder app ${String(app.slug ?? '<missing>')} does not match .factory/system.yaml.` });
      continue;
    }
    const health = app.healthCheck;
    if (!health || typeof health !== 'object'
      || (health as Record<string, unknown>).url !== canonical.health.url
      || (health as Record<string, unknown>).interval !== canonical.health.intervalSeconds
      || (health as Record<string, unknown>).threshold !== canonical.health.failureThreshold) {
      issues.push({ path: `${path}:customizations.coder.apps:${canonical.slug}:healthCheck`, code: 'health-drift', message: 'Coder healthCheck does not match .factory/system.yaml.' });
    }
    if (verification && app.share !== 'authenticated') {
      issues.push({ path: `${path}:customizations.coder.apps:${canonical.slug}:share`, code: 'verification-sharing', message: 'Verification app sharing must be authenticated.' });
    }
  }
}

function validLifecycleCommand(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0 && !value.includes('\0');
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0 && !item.includes('\0'));
}
