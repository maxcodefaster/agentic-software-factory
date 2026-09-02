/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';
import { LeaseLostError, LeaseRenewalError, startLeaseHeartbeat } from './lease-heartbeat';

const messages = { lost: 'lease was lost', failed: 'lease heartbeat failed' };

describe('lease heartbeat', () => {
  test('uses one unrefed timer and renews on schedule', async () => {
    const scheduler = new TestScheduler();
    let renewals = 0;
    const heartbeat = startLeaseHeartbeat(async () => { renewals += 1; return true; }, 1_000, messages, { scheduler, renewalTimeoutMs: 100 });

    expect(scheduler.activeTimers).toBe(1);
    expect(scheduler.unrefs).toBe(1);
    await scheduler.advance(999);
    expect(renewals).toBe(0);
    await scheduler.advance(1);
    expect(renewals).toBe(1);
    expect(scheduler.activeTimers).toBe(1);
    expect(scheduler.unrefs).toBe(3);
    await heartbeat.stop();
    expect(scheduler.activeTimers).toBe(0);
  });

  test('coalesces scheduled and concurrent manual renewals', async () => {
    const scheduler = new TestScheduler();
    const renewal = deferred<boolean>();
    let renewals = 0;
    const heartbeat = startLeaseHeartbeat(() => { renewals += 1; return renewal.promise; }, 1_000, messages, { scheduler, renewalTimeoutMs: 100 });

    await scheduler.advance(1_000, false);
    const manual = Array.from({ length: 10 }, () => heartbeat.renewNow());
    await flushMicrotasks();
    expect(renewals).toBe(1);
    expect(new Set(manual).size).toBe(1);
    renewal.resolve(true);
    await Promise.all(manual);
    expect(scheduler.activeTimers).toBe(1);
    await heartbeat.stop();
  });

  test('records a lost lease once with a stable message', async () => {
    const scheduler = new TestScheduler();
    const heartbeat = startLeaseHeartbeat(async () => false, 1_000, messages, { scheduler, renewalTimeoutMs: 100 });
    let aborts = 0;
    heartbeat.signal.addEventListener('abort', () => { aborts += 1; });

    await heartbeat.renewNow();
    const first = captureLeaseError(heartbeat.throwIfLost);
    await heartbeat.renewNow();

    expect(first).toBeInstanceOf(LeaseLostError);
    expect(first.message).toBe(messages.lost);
    expect(captureLeaseError(heartbeat.throwIfLost)).toBe(first);
    expect(heartbeat.signal.reason).toBe(first);
    expect(aborts).toBe(1);
    await heartbeat.stop();
  });

  test('preserves a failed renewal cause behind the stable message', async () => {
    const scheduler = new TestScheduler();
    const cause = new Error('database unavailable');
    const heartbeat = startLeaseHeartbeat(async () => { throw cause; }, 1_000, messages, { scheduler, renewalTimeoutMs: 100 });

    await heartbeat.renewNow();
    const failure = captureLeaseError(heartbeat.throwIfLost);
    expect(failure).toBeInstanceOf(LeaseRenewalError);
    expect(failure.message).toBe(messages.failed);
    expect(failure.cause).toBe(cause);
    expect(heartbeat.signal.reason).toBe(failure);
    await heartbeat.stop();
  });

  test('times out a renewal and aborts work', async () => {
    const scheduler = new TestScheduler();
    const heartbeat = startLeaseHeartbeat(() => new Promise<boolean>(() => {}), 1_000, messages, { scheduler, renewalTimeoutMs: 100 });
    const renewing = heartbeat.renewNow();

    await scheduler.advance(99);
    expect(heartbeat.signal.aborted).toBe(false);
    await scheduler.advance(1);
    await renewing;

    const failure = captureLeaseError(heartbeat.throwIfLost);
    expect(failure).toBeInstanceOf(LeaseRenewalError);
    expect(failure.message).toBe(messages.failed);
    expect(failure.cause).toEqual(new Error('Lease renewal timed out after 100ms'));
    expect(heartbeat.signal.reason).toBe(failure);
    await heartbeat.stop();
  });

  test('stop joins a normal in-flight renewal and is idempotent', async () => {
    const scheduler = new TestScheduler();
    const renewal = deferred<boolean>();
    const heartbeat = startLeaseHeartbeat(() => renewal.promise, 1_000, messages, { scheduler, renewalTimeoutMs: 100 });
    const renewing = heartbeat.renewNow();
    await flushMicrotasks();

    const stopping = heartbeat.stop();
    expect(heartbeat.stop()).toBe(stopping);
    expect(await settled(stopping)).toBe(false);
    renewal.resolve(true);
    await Promise.all([renewing, stopping]);

    expect(scheduler.activeTimers).toBe(0);
    expect(heartbeat.signal.aborted).toBe(false);
  });

  test('stop is bounded when a renewal never settles and ignores its late result', async () => {
    const scheduler = new TestScheduler();
    const renewal = deferred<boolean>();
    let renewals = 0;
    const heartbeat = startLeaseHeartbeat(() => { renewals += 1; return renewal.promise; }, 1_000, messages, { scheduler, renewalTimeoutMs: 100 });
    let aborts = 0;
    heartbeat.signal.addEventListener('abort', () => { aborts += 1; });
    void heartbeat.renewNow();
    await flushMicrotasks();

    const stopping = heartbeat.stop();
    await scheduler.advance(100);
    await stopping;
    const failure = captureLeaseError(heartbeat.throwIfLost);
    expect(failure).toBeInstanceOf(LeaseRenewalError);
    expect(scheduler.activeTimers).toBe(0);

    renewal.resolve(false);
    await flushMicrotasks();
    await heartbeat.renewNow();
    expect(captureLeaseError(heartbeat.throwIfLost)).toBe(failure);
    expect(heartbeat.signal.reason).toBe(failure);
    expect(aborts).toBe(1);
    expect(renewals).toBe(1);
  });
});

class TestScheduler {
  nowMs = 0;
  unrefs = 0;
  private timers = new Set<TestTimer>();

  get activeTimers(): number {
    return this.timers.size;
  }

  setTimeout = (callback: () => void, delayMs: number): TestTimer => {
    const timer = new TestTimer(this.nowMs + delayMs, callback, () => { this.unrefs += 1; });
    this.timers.add(timer);
    return timer;
  };

  clearTimeout = (timer: TestTimer): void => {
    this.timers.delete(timer);
  };

  async advance(milliseconds: number, flush = true): Promise<void> {
    const target = this.nowMs + milliseconds;
    while (true) {
      const next = [...this.timers].filter((timer) => timer.at <= target).sort((left, right) => left.at - right.at)[0];
      if (!next) break;
      this.nowMs = next.at;
      this.timers.delete(next);
      next.callback();
      if (flush) await flushMicrotasks();
    }
    this.nowMs = target;
    if (flush) await flushMicrotasks();
  }
}

class TestTimer {
  constructor(readonly at: number, readonly callback: () => void, readonly unref: () => void) {}
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settled(promise: Promise<void>): Promise<boolean> {
  return Promise.race([promise.then(() => true), Promise.resolve(false)]);
}

function captureLeaseError(throwIfLost: () => void): Error {
  try {
    throwIfLost();
    throw new Error('expected a lease error');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error;
  }
}
