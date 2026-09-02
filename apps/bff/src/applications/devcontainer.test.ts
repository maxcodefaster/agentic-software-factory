/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { parseDevcontainer, validateDevcontainers, workspaceContracts } from './devcontainer';

function config(coder: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...extra, customizations: { vscode: {}, coder } });
}

function reviewConfig(coder: Record<string, unknown>): string {
  return config(coder, {
    workspaceMount: 'source=${localWorkspaceFolder},target=/workspaces/project,type=bind,readonly',
    workspaceFolder: '/workspaces/project',
  });
}

const developerApps = [
  {
    slug: 'web', displayName: 'Web', url: 'http://localhost:4173', openIn: 'tab', share: 'authenticated',
    healthCheck: { url: 'http://127.0.0.1:4173/ready', interval: 5, threshold: 12 },
  },
  { slug: 'process-manager', displayName: 'Process manager', command: 'process-compose tui', share: 'owner' },
] as const;

const reviewCoder = {
  apps: [{
    slug: 'web', displayName: 'Web', url: 'http://localhost:4173', openIn: 'tab',
    share: 'authenticated',
    healthCheck: { url: 'http://[::1]:4173/ready', interval: 5, threshold: 12 },
  }],
} as const;

describe('Dev Container metadata', () => {
  test('accepts the Coder 2.34.8 app fields used by developer and verification configs', () => {
    const developer = config({
      name: 'customer-app', autoStart: true,
      apps: developerApps,
    }, { name: 'Customer app' });

    expect(validateDevcontainers(developer, reviewConfig(reviewCoder))).toEqual([
      { slug: 'web', displayName: 'Web' },
      { slug: 'process-manager', displayName: 'Process manager' },
    ]);
  });

  test('uses the slug when Coder displayName is omitted', () => {
    expect(parseDevcontainer(config({ apps: [{ slug: 'web', url: 'http://localhost:4173' }] })))
      .toEqual([{ slug: 'web', displayName: 'web' }]);
  });

  test('rejects malformed, duplicate, and unstable slugs', () => {
    for (const apps of [
      [{ slug: 'web--admin', url: 'http://localhost:4173' }],
      [{ slug: 'Web', url: 'http://localhost:4173' }],
      [{ slug: 'web', url: 'http://localhost:4173' }, { slug: 'web', command: 'top' }],
    ]) {
      expect(() => parseDevcontainer(config({ apps }))).toThrow('Coder app');
    }
  });

  test('enforces displayName bytes, URL-or-command, sharing, openIn, and exact fields', () => {
    const invalidApps = [
      { slug: 'web', displayName: 'é'.repeat(33), url: 'http://localhost:4173' },
      { slug: 'web' },
      { slug: 'web', url: 'http://localhost:4173', command: 'top' },
      { slug: 'web', url: 'http://localhost:4173', share: 'public' },
      { slug: 'web', url: 'http://localhost:4173', openIn: 'window' },
      { slug: 'web', url: 'http://localhost:4173', service: 'frontend' },
    ];
    for (const app of invalidApps) {
      expect(() => parseDevcontainer(config({ apps: [app] }))).toThrow('valid Coder app declarations');
    }
  });

  test('bounds persisted app fields and integer values', () => {
    const invalidApps = [
      { slug: 'web', url: `http://localhost/${'a'.repeat(65_518)}` },
      { slug: 'command', command: 'a'.repeat(65_535) },
      { slug: 'web', url: 'http://localhost:4173', icon: 'a'.repeat(257) },
      { slug: 'web', url: 'http://localhost:4173', group: 'a'.repeat(65) },
      { slug: 'web', url: 'http://localhost:4173', order: 2_147_483_648 },
      {
        slug: 'web', url: 'http://localhost:4173',
        healthCheck: { url: 'http://localhost:4173/ready', interval: 5, threshold: 2_147_483_648 },
      },
    ];
    for (const app of invalidApps) {
      expect(() => parseDevcontainer(config({ apps: [app] }))).toThrow('valid Coder app declarations');
    }
  });

  test('rejects malformed health checks and non-local health URLs', () => {
    for (const healthCheck of [
      { url: 'https://localhost:4173/ready', interval: 5, threshold: 2 },
      { url: 'http://example.com/ready', interval: 5, threshold: 2 },
      { url: 'http://127.0.0.1:4173/ready', interval: 0, threshold: 2 },
      { url: 'http://127.0.0.1:4173/ready', interval: 5, threshold: 2.5 },
      { url: 'http://127.0.0.1:4173/ready', interval: 5, threshold: 2, timeout: 1 },
    ]) {
      expect(() => parseDevcontainer(config({ apps: [{ slug: 'web', url: 'http://localhost:4173', healthCheck }] })))
        .toThrow('valid Coder app declarations');
    }
  });

  test('rejects container runtime fields that envbuilder cannot enforce', () => {
    for (const field of ['runArgs', 'privileged', 'mounts', 'dockerComposeFile']) {
      expect(() => parseDevcontainer(config({ apps: [] }, { [field]: [] }))).toThrow('Kubernetes workspace runtime');
    }
    expect(() => validateDevcontainers(config({ apps: [] }, { workspaceMount: 'other' }), reviewConfig(reviewCoder)))
      .toThrow('runtime workspace path');
  });

  test('rejects verification command apps, code-server, unmatched apps, and weak sharing', () => {
    const developer = config({ apps: developerApps });
    const invalidReviewCoders = [
      { ...reviewCoder, apps: [{ slug: 'process-manager', command: 'top', share: 'authenticated' }] },
      { ...reviewCoder, apps: [{ slug: 'code-server', url: 'http://localhost:13337', share: 'authenticated' }] },
      { ...reviewCoder, apps: [{ slug: 'other', url: 'http://localhost:4173', share: 'authenticated' }] },
      { ...reviewCoder, apps: [{ slug: 'web', url: 'http://localhost:9999', share: 'authenticated' }] },
      { ...reviewCoder, apps: [{ slug: 'web', url: 'http://localhost:4173', share: 'owner' }] },
    ];
    for (const coder of invalidReviewCoders) {
      expect(() => validateDevcontainers(developer, reviewConfig(coder))).toThrow('.devcontainer/verification/devcontainer.json');
    }
  });

  test('allows path-routed URL apps and keeps command apps owner-only', () => {
    const healthCheck = { url: 'http://127.0.0.1:4173/ready', interval: 5, threshold: 12 };
    expect(() => validateDevcontainers(
      config({ apps: [{ slug: 'web', url: 'http://localhost:4173', share: 'authenticated', healthCheck }] }),
      reviewConfig(reviewCoder),
    )).not.toThrow();
    expect(() => validateDevcontainers(
      config({ apps: [{ slug: 'web', url: 'http://localhost:4173', share: 'authenticated', healthCheck }] }),
      reviewConfig(reviewCoder),
    )).not.toThrow();
    expect(() => validateDevcontainers(
      config({ apps: [developerApps[0], { slug: 'command', command: 'top', share: 'authenticated' }] }),
      reviewConfig(reviewCoder),
    )).toThrow('command apps must use owner sharing');
  });

  test('rejects invalid JSON, missing Coder customizations, and unknown Coder fields', () => {
    expect(() => parseDevcontainer('{')).toThrow('valid JSON');
    expect(() => parseDevcontainer(JSON.stringify({ customizations: { vscode: {} } }))).toThrow('customizations.coder');
    expect(() => parseDevcontainer(config({ apps: [], services: [] }))).toThrow('valid Coder app declarations');
    expect(() => parseDevcontainer(config({ apps: [{ slug: 'web', url: 'http://localhost:4173', tooltip: 'unsupported' }] })))
      .toThrow('valid Coder app declarations');
  });

  test('returns canonical app metadata for workspace builds', () => {
    const developer = config({ apps: developerApps });
    const review = reviewConfig(reviewCoder);
    const contracts = workspaceContracts(developer, review);
    expect(contracts.developer.apps).toEqual([...developerApps]);
    expect(contracts.verification.apps).toEqual([...reviewCoder.apps]);
  });
});
