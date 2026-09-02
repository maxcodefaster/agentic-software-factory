/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, mock, test } from 'bun:test';

import type { ApplicationDefinition, SystemRegistration } from './catalog';
import { ApplicationRegistry } from './registry';

const registration: SystemRegistration = { team: 'factory', repositoryOwner: 'factory', repositoryName: 'app' };
const application: ApplicationDefinition = {
  id: 'factory/app', team: 'factory', name: 'App', description: '', repositoryOwner: 'factory', repositoryName: 'app',
  repositoryUrl: 'https://forgejo.example/factory/app', cloneUrl: 'http://forgejo/factory/app.git', defaultBranch: 'main',
  defaultSha: 'a'.repeat(40),
  declaredApps: [{ slug: 'preview', displayName: 'Live preview' }],
};

describe('ApplicationRegistry', () => {
  test('single-flights repository metadata and refreshes it after ten seconds', async () => {
    let name = 'First';
    let now = 0;
    const load = mock(async (stored: SystemRegistration) => ({ ...application, ...stored, id: `${stored.repositoryOwner}/${stored.repositoryName}`, name }));
    const registry = new ApplicationRegistry({
      list: mock(async () => [registration]),
      get: mock(async () => registration),
      create: mock(async (value) => ({ registration: value, created: true })),
      delete: mock(async () => undefined),
      reassign: mock(async () => undefined),
    }, load, () => now);

    const [listed, fetched] = await Promise.all([registry.list(), registry.get(application.id)]);
    expect(listed[0]?.name).toBe('First');
    expect(fetched?.name).toBe('First');
    expect(load).toHaveBeenCalledTimes(1);
    name = 'Current';
    expect((await registry.get(application.id))?.name).toBe('First');
    now = 10_001;
    expect((await registry.get(application.id))?.name).toBe('Current');
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('persists only registration fields and returns the live System', async () => {
    const create = mock(async (value: SystemRegistration) => ({ registration: value, created: true }));
    const registry = new ApplicationRegistry({ list: async () => [], get: async () => null, create, delete: async () => undefined, reassign: async () => undefined }, async (stored) => ({
      ...application,
      team: stored.team,
      repositoryOwner: stored.repositoryOwner,
      repositoryName: stored.repositoryName,
      id: `${stored.repositoryOwner}/${stored.repositoryName}`,
    }));

    expect(await registry.create(registration)).toEqual({ application, created: true });
    expect(create).toHaveBeenCalledWith(registration);
  });

  test('keeps healthy Systems visible when another repository is unavailable', async () => {
    const broken = { ...registration, repositoryName: 'broken' };
    const registry = new ApplicationRegistry({
      list: async () => [registration, broken], get: async () => null,
      create: async (value: SystemRegistration) => ({ registration: value, created: true }), delete: async () => undefined, reassign: async () => undefined,
    }, async (stored) => {
      if (stored.repositoryName === 'broken') throw new Error('Forgejo unavailable');
      return application;
    });

    expect(await registry.list()).toEqual([application]);
  });

  test('keeps the last successful System visible through failure and clears degradation after recovery', async () => {
    let now = 0;
    let failure: Error | null = null;
    let name = 'Known good';
    let projection: ApplicationDefinition | null = null;
    const saveProjectionError = mock(async () => undefined);
    const store = {
      list: async () => [registration], get: async () => registration,
      create: async (value: SystemRegistration) => ({ registration: value, created: true }), delete: async () => undefined, reassign: async () => undefined,
      getProjection: async () => projection,
      saveProjection: async (value: ApplicationDefinition) => { projection = value; },
      saveProjectionError,
    };
    const load = async () => {
      if (failure) throw failure;
      return { ...application, name };
    };
    let registry = new ApplicationRegistry(store, load, () => now);

    expect(await registry.list()).toEqual([{ ...application, name: 'Known good' }]);
    failure = new Error('Forgejo unavailable');
    now = 10_001;
    registry = new ApplicationRegistry(store, load, () => now);
    expect(await registry.list()).toEqual([{ ...application, name: 'Known good' }]);
    expect(registry.loadErrors()).toEqual([{ systemId: application.id, error: 'Forgejo unavailable' }]);
    expect(saveProjectionError).toHaveBeenCalledWith(application.id, 'Forgejo unavailable');

    failure = null;
    name = 'Recovered';
    now = 20_002;
    expect(await registry.list()).toEqual([{ ...application, name: 'Recovered' }]);
    expect(registry.loadErrors()).toEqual([]);
  });

  test('reads team authorization data without loading repository metadata', async () => {
    const load = mock(async () => { throw new Error('Forgejo unavailable'); });
    const registry = new ApplicationRegistry({
      list: async () => [registration], get: async () => registration,
      create: async (value) => ({ registration: value, created: true }), delete: async () => undefined, reassign: async () => undefined,
    }, load);

    expect(await registry.getRegistration(application.id)).toEqual(registration);
    expect(await registry.listRegistrations()).toEqual([registration]);
    expect(load).not.toHaveBeenCalled();
  });

  test('limits concurrent repository metadata loads', async () => {
    const registrations = Array.from({ length: 12 }, (_, index) => ({ ...registration, repositoryName: `app-${index}` }));
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const load = mock(async (stored: SystemRegistration) => {
      active += 1;
      peak = Math.max(peak, active);
      await blocked;
      active -= 1;
      return { ...application, ...stored, id: `${stored.repositoryOwner}/${stored.repositoryName}` };
    });
    const registry = new ApplicationRegistry({
      list: async () => registrations, get: async () => null,
      create: async (value) => ({ registration: value, created: true }), delete: async () => undefined, reassign: async () => undefined,
    }, load, Date.now, 3);

    const result = registry.list();
    await Bun.sleep(0);
    expect(active).toBe(3);
    release();
    expect(await result).toHaveLength(registrations.length);
    expect(peak).toBe(3);
  });

  test('passes the last projection to metadata loading after process restart', async () => {
    const load = mock(async (stored: SystemRegistration, previous: ApplicationDefinition | null) => ({ ...previous!, ...stored }));
    const registry = new ApplicationRegistry({
      list: async () => [registration], get: async () => registration,
      create: async (value) => ({ registration: value, created: true }), delete: async () => undefined, reassign: async () => undefined,
      getProjection: async () => application,
    }, load);

    expect(await registry.list()).toEqual([application]);
    expect(load).toHaveBeenCalledWith(registration, application);
  });

  test('shares the metadata limit across direct lookups', async () => {
    const registrations = Array.from({ length: 8 }, (_, index) => ({ ...registration, repositoryName: `direct-${index}` }));
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const registry = new ApplicationRegistry({
      list: async () => [], get: async (id) => registrations.find((item) => `${item.repositoryOwner}/${item.repositoryName}` === id) ?? null,
      create: async (value) => ({ registration: value, created: true }), delete: async () => undefined, reassign: async () => undefined,
    }, async (stored) => {
      active += 1;
      peak = Math.max(peak, active);
      await blocked;
      active -= 1;
      return { ...application, ...stored, id: `${stored.repositoryOwner}/${stored.repositoryName}` };
    }, Date.now, 2);

    const result = Promise.all(registrations.map((item) => registry.get(`${item.repositoryOwner}/${item.repositoryName}`)));
    await Bun.sleep(0);
    expect(active).toBe(2);
    release();
    expect(await result).toHaveLength(registrations.length);
    expect(peak).toBe(2);
  });
});
