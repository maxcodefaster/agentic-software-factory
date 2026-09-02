/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

const root = new URL('../../../../', import.meta.url);
const source = (path: string) => Bun.file(new URL(path, root)).text();

describe('Forgejo review actor deployment contract', () => {
  test('passes the review token to the Kubernetes BFF runtime', async () => {
    expect(await source('deploy/local/platform.yaml')).toContain('key: forgejo-review-token');
  });

  test('repairs the review account and creates a token that can submit reviews', async () => {
    const bootstrap = await source('deploy/local/bootstrap-forgejo-review.sh');
    expect(bootstrap).toContain('admin user must-change-password --unset');
    expect(bootstrap).toContain('username=${FORGEJO_REVIEW_USER:-factory-review}');
    expect(bootstrap).toContain('--username "$username"');
    expect(bootstrap).toContain('--scopes write:repository,read:user');
    expect(bootstrap).not.toContain('"scopes":["read:repository"]');
  });

  test('wires the Kubernetes runtime secret into the BFF', async () => {
    const manifest = await source('deploy/local/platform.yaml');
    expect(manifest).toContain('- name: FORGEJO_REVIEW_TOKEN');
    expect(manifest).toContain('key: forgejo-review-token');
    expect(await source('deploy/local/rollout-factory.sh')).toContain('bootstrap-forgejo-review.sh');
    const bootstrap = await source('deploy/local/bootstrap-forgejo-review.sh');
    expect(bootstrap).toContain('admin user must-change-password --unset');
    expect(bootstrap).toContain('--scopes write:repository,read:user');
    expect(bootstrap).toContain('forgejo-review-token');
    expect(bootstrap).toContain('kubectl patch secret');
  });

  test('keeps review automation unavailable until its token identity is verified', async () => {
    const main = await source('apps/bff/src/main.ts');
    expect(main).toContain('reviewForgejo.assertAuthenticatedLogin(config.forgejo.reviewUser)');
    expect(main.indexOf('reviewForgejo.assertAuthenticatedLogin')).toBeLessThan(main.indexOf('systemDependencyError = null'));
    expect(main.indexOf('app.listen')).toBeLessThan(main.indexOf('reviewForgejo.assertAuthenticatedLogin'));
  });

  test('keeps implementation automation unavailable until its token identity is verified', async () => {
    const main = await source('apps/bff/src/main.ts');
    expect(main).toContain('projectForgejo.assertAuthenticatedLogin(config.forgejo.implementationUser)');
    expect(main.indexOf('projectForgejo.assertAuthenticatedLogin')).toBeLessThan(main.indexOf('systemDependencyError = null'));
    expect(main.indexOf('app.listen')).toBeLessThan(main.indexOf('projectForgejo.assertAuthenticatedLogin'));
  });
});
