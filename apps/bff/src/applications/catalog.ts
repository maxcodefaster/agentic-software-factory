/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { DeclaredApplication, WorkspaceApplication } from './devcontainer';
import { createHash } from 'node:crypto';

export interface SystemRegistration {
  team: string;
  repositoryOwner: string;
  repositoryName: string;
}

export interface ApplicationDefinition extends SystemRegistration {
  id: string;
  name: string;
  description: string;
  repositoryUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  defaultSha: string;
  systemContext?: string;
  declaredApps: DeclaredApplication[];
  workspaceApps?: WorkspaceApplication[];
}

export function coderHandoffUrl(publicUrl: string, path: string): string {
  if (!publicUrl) return '';
  const target = path.startsWith('/') ? path : `/${path}`;
  const url = new URL('/api/v2/users/oidc/callback', publicUrl);
  url.searchParams.set('redirect', target);
  return url.toString();
}

export function coderAppUrl(publicUrl: string, value: string | null | undefined): string | null {
  if (!publicUrl || !value) return null;
  const target = new URL(value);
  if (target.origin !== new URL(publicUrl).origin) {
    const authRedirect = new URL('/api/v2/applications/auth-redirect', publicUrl);
    authRedirect.searchParams.set('redirect_uri', target.toString());
    return coderHandoffUrl(publicUrl, `${authRedirect.pathname}${authRedirect.search}`);
  }
  return coderHandoffUrl(publicUrl, `${target.pathname}${target.search}`);
}

interface WorkspaceCandidate {
  id: string;
  name: string;
  status: string;
  healthy: boolean;
  lastUsedAt: string;
  parameters: Record<string, string>;
}

export function workspaceForApplication<T extends WorkspaceCandidate>(application: ApplicationDefinition, workspaces: T[]): T | undefined {
  const expectedName = coderWorkspaceName('main', application.cloneUrl);
  return workspaces
    .filter((workspace) => workspace.name === expectedName
      && workspace.parameters.repository_url === application.cloneUrl
      && workspace.parameters.repository_ref === application.defaultSha
      && workspace.parameters.workspace_kind === 'developer'
      && (!application.workspaceApps || sameJson(workspace.parameters.repository_apps, application.workspaceApps)))
    .sort((left, right) => workspaceRank(right) - workspaceRank(left)
      || Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt)
      || left.id.localeCompare(right.id))[0];
}

function sameJson(encoded: string | undefined, expected: unknown): boolean {
  if (!encoded) return false;
  try {
    return stableJson(JSON.parse(encoded)) === stableJson(expected);
  } catch {
    return false;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function coderWorkspaceName(prefix: 'main' | 'ticket' | 'staging' | 'verification', identity: string): string {
  return `${prefix}-${createHash('sha256').update(identity).digest('hex').slice(0, 10)}`;
}

export function systemDisplayName(repositoryName: string): string {
  return repositoryName.split(/[-_.]+/).filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function workspaceRank(workspace: WorkspaceCandidate): number {
  if (workspace.healthy && workspace.status === 'running') return 3;
  if (workspace.status === 'running') return 2;
  return workspace.healthy ? 1 : 0;
}
