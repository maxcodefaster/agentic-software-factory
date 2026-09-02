/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, mock, test } from 'bun:test';
import { WorkerHost } from './worker-host';

test('does not overlap runs of the same worker', async () => {
  let release: (() => void) | undefined;
  let active = 0;
  let maximumActive = 0;
  const run = mock(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>((resolve) => { release = resolve; });
    active -= 1;
  });
  const host = new WorkerHost();
  host.start({ name: 'reconciler', intervalMs: 5, immediate: true, run });

  await waitFor(() => run.mock.calls.length === 1);
  await Bun.sleep(20);
  expect(run).toHaveBeenCalledTimes(1);
  expect(maximumActive).toBe(1);

  release?.();
  await waitFor(() => run.mock.calls.length === 2);
  release?.();
  await host.stop();
  expect(maximumActive).toBe(1);
});

test('continues after a worker failure', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const run = mock(async () => {
    if (run.mock.calls.length === 1) throw new Error('temporary failure');
  });
  const host = new WorkerHost((record) => logs.push(record));
  host.start({ name: 'reconciler', intervalMs: 5, immediate: true, run });

  await waitFor(() => run.mock.calls.length >= 2);
  await host.stop();
  expect(logs).toEqual([expect.objectContaining({ event: 'worker_failed', worker: 'reconciler', error: 'temporary failure' })]);
});

test('wakes a worker immediately without overlapping an active run', async () => {
  let release: (() => void) | undefined;
  const run = mock(async () => new Promise<void>((resolve) => { release = resolve; }));
  const host = new WorkerHost();
  host.start({ name: 'reconciler', intervalMs: 60_000, run });

  expect(host.wake('reconciler')).toBe(true);
  await waitFor(() => run.mock.calls.length === 1);
  host.wake('reconciler');
  expect(run).toHaveBeenCalledTimes(1);
  release?.();
  await waitFor(() => run.mock.calls.length === 2);
  release?.();
  await host.stop();
});

test('ignores a wake before registration or after shutdown', async () => {
  const host = new WorkerHost();
  expect(host.wake('missing')).toBe(false);
  host.start({ name: 'reconciler', intervalMs: 60_000, run: async () => undefined });
  await host.stop();
  expect(host.wake('reconciler')).toBe(false);
});

test('clears timers, aborts, and waits for an active run during shutdown', async () => {
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const run = mock(async (workerSignal: AbortSignal) => {
    signal = workerSignal;
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const host = new WorkerHost();
  host.start({ name: 'reconciler', intervalMs: 5, immediate: true, run });
  await waitFor(() => run.mock.calls.length === 1);

  let stopped = false;
  const stopping = host.stop().then(() => { stopped = true; });
  await Bun.sleep(10);
  expect(signal?.aborted).toBe(true);
  expect(stopped).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);

  release?.();
  await stopping;
  await Bun.sleep(10);
  expect(run).toHaveBeenCalledTimes(1);
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('condition was not met');
    await Bun.sleep(1);
  }
}
