/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

export function startLeaseHeartbeat(
  renew: () => Promise<boolean>,
  intervalMs: number,
  messages: { lost: string; failed: string },
): {
  signal: AbortSignal;
  renewNow(): Promise<void>;
  throwIfLost(): void;
  stop(): void;
} {
  const abort = new AbortController();
  let active = true;
  let leaseError: Error | null = null;
  let renewal: Promise<void> | null = null;

  const loseLease = (message: string) => {
    if (!active || leaseError) return;
    leaseError = new Error(message);
    abort.abort(leaseError);
  };
  const runRenewal = async () => {
    if (!active || leaseError) return;
    try {
      if (!await renew()) loseLease(messages.lost);
    } catch {
      loseLease(messages.failed);
    }
  };
  const renewNow = () => {
    renewal ??= runRenewal().finally(() => { renewal = null; });
    return renewal;
  };
  const timer = setInterval(() => { void renewNow(); }, intervalMs);
  timer.unref();

  return {
    signal: abort.signal,
    renewNow,
    throwIfLost() {
      if (leaseError) throw leaseError;
    },
    stop() {
      active = false;
      clearInterval(timer);
    },
  };
}
