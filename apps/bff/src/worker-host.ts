/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

interface WorkerOptions {
  name: string;
  intervalMs: number;
  immediate?: boolean;
  failureEvent?: string;
  failureLevel?: 'error' | 'warn';
  run(signal: AbortSignal): Promise<void>;
}

interface Worker extends WorkerOptions {
  timer: ReturnType<typeof setInterval>;
  active: Promise<void> | null;
  wakePending: boolean;
}

type WorkerLog = (record: Record<string, unknown>) => void;

export class WorkerHost {
  private readonly workers = new Map<string, Worker>();
  private readonly abort = new AbortController();
  private stopping = false;
  private stoppingPromise: Promise<void> | null = null;

  constructor(private readonly log: WorkerLog = defaultLog) {}

  start(options: WorkerOptions): void {
    if (this.stopping) throw new Error('worker host is stopping');
    if (this.workers.has(options.name)) throw new Error(`worker already started: ${options.name}`);
    const worker: Worker = {
      ...options,
      active: null,
      wakePending: false,
      timer: setInterval(() => { this.trigger(worker); }, options.intervalMs),
    };
    worker.timer.unref();
    this.workers.set(worker.name, worker);
    if (worker.immediate) this.trigger(worker);
  }

  wake(name: string): boolean {
    const worker = this.workers.get(name);
    if (!worker || this.stopping) return false;
    if (worker.active) {
      worker.wakePending = true;
      return true;
    }
    this.trigger(worker);
    return true;
  }

  stop(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise;
    this.stopping = true;
    for (const worker of this.workers.values()) clearInterval(worker.timer);
    this.abort.abort(new DOMException('Worker host stopped', 'AbortError'));
    this.stoppingPromise = Promise.allSettled(
      [...this.workers.values()].map((worker) => worker.active).filter((active): active is Promise<void> => active !== null),
    ).then(() => undefined);
    return this.stoppingPromise;
  }

  private trigger(worker: Worker): void {
    if (this.stopping || worker.active) return;
    const active = Promise.resolve()
      .then(() => worker.run(this.abort.signal))
      .catch((error) => {
        try {
          this.log({
            timestamp: new Date().toISOString(),
            level: worker.failureLevel ?? 'error',
            event: worker.failureEvent ?? 'worker_failed',
            worker: worker.name,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Logging must not terminate a periodic worker.
        }
      })
      .finally(() => {
        if (worker.active !== active) return;
        worker.active = null;
        if (worker.wakePending) {
          worker.wakePending = false;
          this.trigger(worker);
        }
      });
    worker.active = active;
  }
}

function defaultLog(record: Record<string, unknown>): void {
  console.error(JSON.stringify(record));
}
