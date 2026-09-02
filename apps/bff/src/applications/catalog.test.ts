/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { coderAppUrl, coderWorkspaceName, systemDisplayName, workspaceForApplication, type ApplicationDefinition } from './catalog';

const application: ApplicationDefinition = {
  id: 'factory/app', team: 'factory', name: 'App', description: '', repositoryOwner: 'factory', repositoryName: 'app',
  repositoryUrl: 'https://forgejo.example/factory/app', cloneUrl: 'https://forgejo.example/factory/app.git', defaultBranch: 'main',
  defaultSha: 'a'.repeat(40),
  declaredApps: [],
};

describe('workspaceForApplication', () => {
  test('selects only the deterministic main workspace at the current default SHA', () => {
    const base = {
      name: coderWorkspaceName('main', application.cloneUrl), status: 'running', healthy: true, lastUsedAt: '2026-08-24T10:00:00Z',
      parameters: { repository_url: application.cloneUrl, repository_ref: application.defaultSha },
    };
    expect(workspaceForApplication(application, [
      { ...base, id: 'verification', parameters: { ...base.parameters, workspace_kind: 'verification' } },
      { ...base, id: 'ticket', name: coderWorkspaceName('ticket', 'ticket'), parameters: { ...base.parameters, workspace_kind: 'developer' } },
      { ...base, id: 'stale', parameters: { ...base.parameters, repository_ref: 'b'.repeat(40), workspace_kind: 'developer' } },
      { ...base, id: 'other', parameters: { ...base.parameters, repository_url: 'https://forgejo.example/factory/other.git', workspace_kind: 'developer' } },
      { ...base, id: 'developer', healthy: false, parameters: { ...base.parameters, workspace_kind: 'developer' } },
    ])?.id).toBe('developer');
  });

  test('prefers a healthy running workspace, then recent use', () => {
    const name = coderWorkspaceName('main', application.cloneUrl);
    const parameters = { repository_url: application.cloneUrl, repository_ref: application.defaultSha, workspace_kind: 'developer' };
    expect(workspaceForApplication(application, [
      { id: 'old', name, status: 'running', healthy: true, lastUsedAt: '2026-08-20T10:00:00Z', parameters },
      { id: 'new', name, status: 'running', healthy: true, lastUsedAt: '2026-08-24T10:00:00Z', parameters },
      { id: 'stopped', name, status: 'stopped', healthy: false, lastUsedAt: '2026-08-25T10:00:00Z', parameters },
    ])?.id).toBe('new');
  });

  test('matches a semantically equal app contract regardless of JSON key order', () => {
    const withApps = { ...application, workspaceApps: [{ slug: 'api', displayName: 'API', url: 'http://127.0.0.1:3001' }] };
    const candidate = {
      id: 'developer', name: coderWorkspaceName('main', application.cloneUrl), status: 'running', healthy: true, lastUsedAt: '2026-08-24T10:00:00Z',
      parameters: {
        repository_url: application.cloneUrl, repository_ref: application.defaultSha, workspace_kind: 'developer',
        repository_apps: JSON.stringify([{ url: 'http://127.0.0.1:3001', displayName: 'API', slug: 'api' }]),
      },
    };

    expect(workspaceForApplication(withApps, [candidate])?.id).toBe('developer');
  });
});

describe('coderAppUrl', () => {
  test('hands same-origin IDE and terminal routes through Coder OIDC', () => {
    const terminal = coderAppUrl('https://coder.example', 'https://coder.example/@alice/main.main/terminal?app=process-compose');
    const handoff = new URL(terminal!);

    expect(handoff.pathname).toBe('/api/v2/users/oidc/callback');
    expect(handoff.searchParams.get('redirect')).toBe('/@alice/main.main/terminal?app=process-compose');
  });

  test('hands subdomain applications through Coder OIDC and application auth', () => {
    const application = coderAppUrl('https://coder.example', 'https://preview.coder.example/');
    const handoff = new URL(application!);
    const authRedirect = new URL(handoff.searchParams.get('redirect')!, 'https://coder.example');
    expect(handoff.pathname).toBe('/api/v2/users/oidc/callback');
    expect(authRedirect.pathname).toBe('/api/v2/applications/auth-redirect');
    expect(authRedirect.searchParams.get('redirect_uri')).toBe('https://preview.coder.example/');
  });
});

test('formats repository slugs as System display names', () => {
  expect(systemDisplayName('inventory-service')).toBe('Inventory Service');
  expect(systemDisplayName('inventory-service')).toBe('Inventory Service');
});

test('keeps long System Coder app labels within the DNS limit', () => {
  const workspace = coderWorkspaceName('staging', 'https://forgejo.example/factory/example-application.git');
  expect(`example-application-admin--${workspace}--factory-stage`).toHaveLength(60);
});
