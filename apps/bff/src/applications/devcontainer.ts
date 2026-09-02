/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

const unsupportedRuntimeFields = [
  'dockerComposeFile', 'service', 'runServices', 'runArgs', 'privileged', 'capAdd',
  'securityOpt', 'mounts', 'initializeCommand',
] as const;

const bytes = (maximum: number) => z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= maximum);
const nonEmptyBytes = (maximum: number) => bytes(maximum).refine((value) => value.trim().length > 0);
const int32 = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const positiveInt32 = z.number().int().min(1).max(2_147_483_647);

const localHttpUrl = nonEmptyBytes(65_534).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && !url.username && !url.password
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
});

const healthCheckSchema = z.object({
  url: localHttpUrl,
  interval: positiveInt32,
  threshold: positiveInt32,
}).strict();

const coderAppSchema = z.object({
  slug: z.string().max(28).regex(/^[a-z0-9](-?[a-z0-9])*$/),
  displayName: nonEmptyBytes(64).optional(),
  url: nonEmptyBytes(65_534).optional(),
  command: nonEmptyBytes(65_534).optional(),
  icon: bytes(256).optional(),
  openIn: z.enum(['tab', 'slim-window']).optional(),
  share: z.enum(['owner', 'authenticated']).optional(),
  group: bytes(64).optional(),
  order: int32.optional(),
  healthCheck: healthCheckSchema.optional(),
}).strict().superRefine((app, context) => {
  if ((app.url === undefined) === (app.command === undefined)) {
    context.addIssue({ code: 'custom', message: 'exactly one of url or command is required' });
  }
  if (app.command !== undefined && app.healthCheck !== undefined) {
    context.addIssue({ code: 'custom', message: 'command apps cannot use healthCheck' });
  }
});

const coderCustomizationSchema = z.object({
  apps: z.array(coderAppSchema).optional(),
  name: z.string().regex(/^[a-z0-9](?:-?[a-z0-9])*$/).optional(),
  ignore: z.boolean().optional(),
  autoStart: z.boolean().optional(),
}).strict();

const devcontainerSchema = z.object({
  customizations: z.object({
    coder: coderCustomizationSchema,
  }).passthrough(),
}).passthrough().superRefine((config, context) => {
  for (const field of unsupportedRuntimeFields) {
    if (field in config) context.addIssue({ code: 'custom', message: `${field} is not supported by the Kubernetes workspace runtime` });
  }
});

const verificationDevcontainerSchema = devcontainerSchema.extend({
  workspaceMount: z.literal('source=${localWorkspaceFolder},target=/workspaces/project,type=bind,readonly'),
  workspaceFolder: z.literal('/workspaces/project'),
});

type CoderApp = z.infer<typeof coderAppSchema>;
type Devcontainer = z.infer<typeof devcontainerSchema>;

export type WorkspaceApplication = CoderApp;

export interface WorkspaceContract {
  apps: WorkspaceApplication[];
  devcontainerPath?: string;
  supervisorCommands?: {
    status: string;
    attach?: string;
    logs?: string;
    restart?: string;
    shutdown: string;
  };
  shutdownCommand?: string;
  startupTimeoutSeconds?: number;
  contractVersion?: number;
  tenantId?: string;
}

export interface DeclaredApplication {
  slug: string;
  displayName: string;
}

export function parseDevcontainer(source: string): DeclaredApplication[] {
  const config = parseConfig(source, '.devcontainer/devcontainer.json');
  validateUniqueSlugs(config, '.devcontainer/devcontainer.json');
  return applications(config).map(({ slug, displayName }) => ({ slug, displayName: displayName ?? slug }));
}

export function validateDevcontainers(developerSource: string, verificationSource: string): DeclaredApplication[] {
  return workspaceContracts(developerSource, verificationSource).developer.apps
    .map(({ slug, displayName }) => ({ slug, displayName: displayName ?? slug }));
}

export function workspaceContracts(developerSource: string, verificationSource: string): {
  developer: WorkspaceContract;
  verification: WorkspaceContract;
} {
  const developerPath = '.devcontainer/devcontainer.json';
  const verificationPath = '.devcontainer/verification/devcontainer.json';
  const developer = parseConfig(developerSource, developerPath);
  const verification = parseConfig(verificationSource, verificationPath, true);
  const developerValue = JSON.parse(developerSource) as Record<string, unknown>;
  if ('workspaceMount' in developerValue || 'workspaceFolder' in developerValue) {
    throw invalid(`${developerPath} must use the runtime workspace path`);
  }
  validateUniqueSlugs(developer, developerPath);
  validateUniqueSlugs(verification, verificationPath);

  const developerApps = new Map(applications(developer).filter((app) => app.url !== undefined)
    .map((app) => [app.slug, app]));
  const developerCommands = applications(developer).filter((app) => app.command !== undefined);
  if (developerCommands.length > 1) throw invalid(`${developerPath} may declare at most one command app`);
  for (const app of applications(developer)) {
    if (app.slug === 'code-server') throw invalid(`${developerPath} must not replace the platform IDE`);
    if (app.command !== undefined && app.share !== undefined && app.share !== 'owner') throw invalid(`${developerPath} command apps must use owner sharing`);
    if (app.url !== undefined && app.healthCheck === undefined) throw invalid(`${developerPath} URL apps must declare healthCheck`);
  }

  for (const app of applications(verification)) {
    if (app.command !== undefined) throw invalid(`${verificationPath} must not declare command apps`);
    if (app.slug === 'code-server') throw invalid(`${verificationPath} must not declare a code-server app`);
    const developerApp = developerApps.get(app.slug);
    if (!developerApp || developerApp.url !== app.url) {
      throw invalid(`${verificationPath} URL apps must match developer app slugs and URLs`);
    }
    if (app.share !== 'authenticated') {
      throw invalid(`${verificationPath} URL apps must use authenticated sharing`);
    }
    if (app.healthCheck === undefined) throw invalid(`${verificationPath} URL apps must declare healthCheck`);
  }
  if (applications(verification).length === 0) throw invalid(`${verificationPath} must declare at least one authenticated URL app`);

  return {
    developer: contract(developerSource, developer),
    verification: contract(verificationSource, verification),
  };
}

function parseConfig(source: string, path: string, verification = false): Devcontainer {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw invalid(`${path} must be valid JSON`);
  }
  const result = (verification ? verificationDevcontainerSchema : devcontainerSchema).safeParse(value);
  if (!result.success) {
    const hasCoder = typeof value === 'object' && value !== null
      && 'customizations' in value && typeof value.customizations === 'object' && value.customizations !== null
      && 'coder' in value.customizations;
    throw invalid(hasCoder
      ? `${path} must contain valid Coder app declarations supported by the Kubernetes workspace runtime`
      : `${path} must contain customizations.coder`);
  }
  return result.data;
}

function contract(_source: string, config: Devcontainer): WorkspaceContract {
  return { apps: applications(config) };
}

function applications(config: Devcontainer): CoderApp[] {
  return config.customizations.coder.apps ?? [];
}

function validateUniqueSlugs(config: Devcontainer, path: string): void {
  const slugs = new Set<string>();
  for (const app of applications(config)) {
    if (slugs.has(app.slug)) throw invalid(`${path} Coder app slugs must be unique`);
    slugs.add(app.slug);
  }
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}
