/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

export class LeaseLostError extends Error {
  override readonly name = 'LeaseLostError';
}
export class LeaseRenewalError extends Error {
  override readonly name = 'LeaseRenewalError';
  constructor(message: string, cause: unknown) { super(message, { cause }); }
}
export interface LeaseHeartbeat {
  readonly signal: AbortSignal;
  renewNow(): Promise<void>;
  throwIfLost(): void;
  stop(): Promise<void>;
}
export interface LeaseHeartbeatOptions {
  renewalTimeoutMs?: number;
  scheduler?: {
    setTimeout(callback: () => void, delayMs: number): { unref?(): void };
    clearTimeout(timer: { unref?(): void }): void;
  };
}
const nativeScheduler: NonNullable<LeaseHeartbeatOptions['scheduler']> = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function startLeaseHeartbeat(
  renew: () => Promise<boolean>,
  intervalMs: number,
  messages: { lost: string; failed: string },
  options: LeaseHeartbeatOptions = {},
): LeaseHeartbeat {
  const scheduler = options.scheduler ?? nativeScheduler;
  const renewalTimeoutMs = options.renewalTimeoutMs ?? Math.min(10_000, intervalMs / 2);
  if (renewalTimeoutMs <= 0 || renewalTimeoutMs >= intervalMs) throw new RangeError('Renewal timeout must be positive and shorter than lease headroom');

  const abort = new AbortController();
  let leaseError: LeaseLostError | LeaseRenewalError | null = null;
  let timer: ReturnType<typeof scheduler.setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;
  const clearTimer = () => {
    if (timer) scheduler.clearTimeout(timer);
    timer = null;
  };
  const schedule = (callback: () => void, delayMs: number) => {
    clearTimer();
    timer = scheduler.setTimeout(() => {
      timer = null;
      callback();
    }, delayMs);
    timer.unref?.();
  };
  const fail = (error: LeaseLostError | LeaseRenewalError) => {
    if (leaseError) return;
    leaseError = error;
    abort.abort(error);
  };
  const scheduleNext = () => !stopping && !leaseError && schedule(() => { void renewNow(); }, intervalMs);
  const renewNow = (): Promise<void> => {
    if (stopping || leaseError) return Promise.resolve();
    if (inFlight) return inFlight;
    clearTimer();
    let resolve!: () => void;
    let promise!: Promise<void>;
    const finish = (renewed?: boolean, cause?: unknown) => {
      if (inFlight !== promise) return;
      clearTimer();
      inFlight = null;
      if (renewed === false) fail(new LeaseLostError(messages.lost));
      if (renewed === undefined) fail(new LeaseRenewalError(messages.failed, cause));
      resolve();
      scheduleNext();
    };
    promise = new Promise<void>((done) => { resolve = done; });
    inFlight = promise;
    schedule(() => finish(undefined, new Error(`Lease renewal timed out after ${renewalTimeoutMs}ms`)), renewalTimeoutMs);
    try {
      renew().then(
        (renewed) => finish(renewed),
        (cause) => finish(undefined, cause),
      );
    } catch (cause) { finish(undefined, cause); }
    return promise;
  };
  scheduleNext();
  return {
    signal: abort.signal,
    renewNow,
    throwIfLost() {
      if (leaseError) throw leaseError;
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (inFlight) await inFlight;
        clearTimer();
        inFlight = null;
      })();
      return stopping;
    },
  };
}
