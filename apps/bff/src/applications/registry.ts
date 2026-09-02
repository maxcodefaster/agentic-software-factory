/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ApplicationDefinition, SystemRegistration } from './catalog';
import type { ApplicationStore } from './store';

type RegistryStore = Pick<ApplicationStore, 'list' | 'get' | 'create' | 'delete' | 'reassign'>
  & Partial<Pick<ApplicationStore, 'getProjection' | 'saveProjection' | 'saveProjectionError' | 'listPersistedStatus'>>;

export class ApplicationRegistry {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cache = new Map<string, { value: ApplicationDefinition; expiresAt: number }>();
  private readonly loading = new Map<string, Promise<ApplicationDefinition>>();
  private readonly errors = new Map<string, string>();
  private activeLoads = 0;
  private readonly loadWaiters: Array<() => void> = [];

  constructor(
    private readonly store: RegistryStore,
    private readonly load: (registration: SystemRegistration, previous: ApplicationDefinition | null) => Promise<ApplicationDefinition>,
    private readonly now: () => number = Date.now,
    private readonly loadConcurrency = 4,
  ) {}

  async list(): Promise<ApplicationDefinition[]> {
    const registrations = await this.store.list();
    const loaded = await Promise.allSettled(registrations.map((registration) => this.loadCached(registration)));
    loaded.forEach((result, index) => {
      const registration = registrations[index]!;
      const id = `${registration.repositoryOwner}/${registration.repositoryName}`;
      if (result.status === 'rejected') this.errors.set(id, result.reason instanceof Error ? result.reason.message : String(result.reason));
    });
    return loaded.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  }

  async get(id: string): Promise<ApplicationDefinition | null> {
    const registration = await this.store.get(id);
    return registration ? this.loadCached(registration) : null;
  }

  listRegistrations(): Promise<SystemRegistration[]> {
    return this.store.list();
  }

  getRegistration(id: string): Promise<SystemRegistration | null> {
    return this.store.get(id);
  }

  async create(registration: SystemRegistration): Promise<{ application: ApplicationDefinition; created: boolean }> {
    const reservation = await this.store.create(registration);
    if (reservation.created) this.cache.delete(`${registration.repositoryOwner}/${registration.repositoryName}`);
    return { application: await this.loadCached(reservation.registration), created: reservation.created };
  }

  delete(id: string): Promise<void> {
    this.cache.delete(id);
    this.errors.delete(id);
    return this.store.delete(id);
  }

  invalidate(id: string): void {
    const cached = this.cache.get(id);
    if (cached) cached.expiresAt = 0;
  }

  loadErrors(): Array<{ systemId: string; error: string }> {
    return [...this.errors].map(([systemId, error]) => ({ systemId, error }));
  }

  async persistedStatus(): Promise<import('./store').PersistedRegistrySystem[]> {
    if (!this.store.listPersistedStatus) throw new Error('Persisted registry status is not configured');
    return this.store.listPersistedStatus();
  }

  async reassign(id: string, team: string): Promise<ApplicationDefinition> {
    await this.store.reassign(id, team);
    this.invalidate(id);
    const application = await this.get(id);
    if (!application) throw Object.assign(new Error('application not found'), { status: 404 });
    return application;
  }

  private loadCached(registration: SystemRegistration): Promise<ApplicationDefinition> {
    const id = `${registration.repositoryOwner}/${registration.repositoryName}`;
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.value);
    const active = this.loading.get(id);
    if (active) return active;
    const previous = cached?.value
      ? Promise.resolve(cached.value)
      : this.store.getProjection?.(id) ?? Promise.resolve(null);
    const request = previous.then((projection) => this.withLoadSlot(() => this.load(registration, projection)))
      .then((value) => {
        return this.store.saveProjection?.(value).then(() => value) ?? value;
      })
      .then((value) => {
        this.cache.set(id, { value, expiresAt: this.now() + 10_000 });
        this.errors.delete(id);
        return value;
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.errors.set(id, message);
        await this.store.saveProjectionError?.(id, message).catch(() => undefined);
        const projection = await previous;
        if (projection) {
          const stale = { ...projection, ...registration };
          this.cache.set(id, { value: stale, expiresAt: this.now() + 10_000 });
          return stale;
        }
        throw error;
      })
      .finally(() => this.loading.delete(id));
    this.loading.set(id, request);
    return request;
  }

  withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(id, current);
    return previous.then(action).finally(() => {
      release();
      if (this.locks.get(id) === current) this.locks.delete(id);
    });
  }

  private async withLoadSlot<T>(action: () => Promise<T>): Promise<T> {
    const limit = Math.max(1, this.loadConcurrency);
    if (this.activeLoads >= limit) await new Promise<void>((resolve) => this.loadWaiters.push(resolve));
    else this.activeLoads += 1;
    try {
      return await action();
    } finally {
      const next = this.loadWaiters.shift();
      if (next) next();
      else this.activeLoads -= 1;
    }
  }

}
