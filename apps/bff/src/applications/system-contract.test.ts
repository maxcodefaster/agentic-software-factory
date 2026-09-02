/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { inspectSystemContract } from './system-contract';

const manifest = `
version: 1
development:
  devcontainer: .devcontainer/devcontainer.json
verification:
  devcontainer: .devcontainer/verification/devcontainer.json
runtime:
  supervisor:
    kind: process-compose
    config: process-compose.yaml
    control: { address: 127.0.0.1, port: 8080 }
    commands:
      status: process-compose --address 127.0.0.1 --port 8080 process list
      attach: process-compose --address 127.0.0.1 --port 8080 attach
      logs: process-compose --address 127.0.0.1 --port 8080 process logs --follow
      shutdown: process-compose --address 127.0.0.1 --port 8080 --ordered-shutdown down
  startupTimeoutSeconds: 120
applications:
  - slug: web
    displayName: Web
    url: http://127.0.0.1:4173
    verification: required
    health: { url: http://127.0.0.1:4173/ready, intervalSeconds: 5, failureThreshold: 12 }
`;

const files = new Map([
  ['.devcontainer/devcontainer.json', JSON.stringify({ postStartCommand: './dev start', customizations: { vscode: {} } })],
  ['.devcontainer/verification/devcontainer.json', JSON.stringify({ postStartCommand: './dev start', workspaceMount: 'source=${localWorkspaceFolder},target=/workspaces/project,type=bind,readonly', workspaceFolder: '/workspaces/project' })],
  ['process-compose.yaml', 'version: "0.5"\nprocesses: {}\n'],
]);

describe('System repository contract v1', () => {
  test('returns canonical developer and verification apps from one manifest', () => {
    const result = inspectSystemContract(manifest, files);
    expect(result.compatible).toBe(true);
    if (!result.compatible) return;
    expect(result.contract.developer.apps).toEqual([expect.objectContaining({ slug: 'web', share: 'owner' })]);
    expect(result.contract.verification.apps).toEqual([expect.objectContaining({ slug: 'web', share: 'authenticated' })]);
    expect(result.contract.supervisor.kind).toBe('process-compose');
  });

  test('supports a custom supervisor and a non-web System', () => {
    const result = inspectSystemContract(`
version: 1
development: { devcontainer: .devcontainer/devcontainer.json }
verification: { devcontainer: .devcontainer/verification/devcontainer.json }
runtime:
  supervisor:
    kind: custom
    commands: { status: ./dev status, shutdown: ./dev stop }
  startupTimeoutSeconds: 60
applications: []
`, files);
    expect(result).toMatchObject({ compatible: true, contract: { applications: [], developer: { apps: [] }, verification: { apps: [] } } });
  });

  test('reports every missing referenced artifact with its path', () => {
    const result = inspectSystemContract(manifest, new Map());
    expect(result).toMatchObject({ compatible: false });
    if (result.compatible) return;
    expect(result.issues.filter((issue) => issue.code === 'missing-file').map((issue) => issue.path).sort()).toEqual([
      '.devcontainer/devcontainer.json', '.devcontainer/verification/devcontainer.json', 'process-compose.yaml',
    ]);
  });

  test('rejects traversal, unbounded probes, port drift, and duplicate slugs', () => {
    const unsafe = manifest
      .replace('.devcontainer/devcontainer.json', '../devcontainer.json')
      .replace('failureThreshold: 12', 'failureThreshold: 999')
      .replace('http://127.0.0.1:4173/ready', 'http://127.0.0.1:9999/ready')
      .replace('  - slug: web', '  - slug: web\n    displayName: Duplicate\n    url: http://127.0.0.1:4173\n    verification: required\n    health: { url: http://127.0.0.1:4173/ready, intervalSeconds: 5, failureThreshold: 12 }\n  - slug: web');
    const result = inspectSystemContract(unsafe, files);
    expect(result.compatible).toBe(false);
    if (result.compatible) return;
    expect(result.issues.map((issue) => issue.message).join(' ')).toMatch(/repository-relative|less than or equal to 120|application port/);
  });

  test('rejects verification source that is not mounted read-only', () => {
    const broken = new Map(files);
    broken.set('.devcontainer/verification/devcontainer.json', '{}');
    const result = inspectSystemContract(manifest, broken);
    expect(result.compatible).toBe(false);
    if (result.compatible) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['verification-not-readonly', 'invalid-workspace-folder']));
  });

  test('rejects unsupported runtime fields, missing startup commands, and implicit Dockerfile targets', () => {
    const broken = new Map(files);
    broken.set('.devcontainer/devcontainer.json', JSON.stringify({
      build: { dockerfile: 'Dockerfile' },
      privileged: true,
      postStartCommand: '',
    }));
    const result = inspectSystemContract(manifest, broken);
    expect(result.compatible).toBe(false);
    if (result.compatible) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing-build-target', 'unsupported-field', 'missing-start-lifecycle',
    ]));
  });

  test('accepts and ignores deprecated v1 IDE and release fields', () => {
    const legacy = manifest.replace('applications:', 'ide:\n  tasks: .vscode/tasks.json\n  processTask: Dev Processes\nrelease:\n  manifest: .factory/release.yaml\napplications:');
    const result = inspectSystemContract(legacy, files);
    expect(result).toMatchObject({ compatible: true });
    if (!result.compatible) return;
    expect(result.contract).not.toHaveProperty('releaseManifest');
  });

  test('allows omitted Coder apps and rejects duplicated metadata drift', () => {
    const omitted = inspectSystemContract(manifest, files);
    expect(omitted.compatible).toBe(true);
    const drift = new Map(files);
    drift.set('.devcontainer/devcontainer.json', JSON.stringify({ customizations: { coder: { apps: [{
      slug: 'web', url: 'http://127.0.0.1:9999',
      healthCheck: { url: 'http://127.0.0.1:9999/ready', interval: 5, threshold: 12 },
    }] } } }));
    const result = inspectSystemContract(manifest, drift);
    expect(result.compatible).toBe(false);
    if (result.compatible) return;
    expect(result.issues.map((issue) => issue.code)).toContain('application-drift');
  });
});
