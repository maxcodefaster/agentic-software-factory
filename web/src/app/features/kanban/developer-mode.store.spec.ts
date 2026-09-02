/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { Subject, of, throwError } from 'rxjs';

import type { ImplementationRun } from '@agentic-software-factory/api-contracts/implementation';
import { ApplicationsClient } from '../../core/api/applications.client';
import { ImplementationClient } from '../../core/api/implementation.client';
import { DeveloperModeStore } from './developer-mode.store';

const context = { team: 'factory', application: 'orders' };
const run: ImplementationRun = {
  id: 'run-1', requirementNumber: 42, applicationId: 'orders', applicationName: 'Orders', acceptedDigest: 'digest',
  repository: 'factory/orders', repositoryUrl: 'https://git.example/orders', branch: 'requirement-42', pullNumber: 7,
  pullUrl: 'https://git.example/orders/pulls/7', headSha: 'abcdef', mergedSha: null, phase: 'agent-running',
  agentStatus: 'running', agentError: null, agentStartedHeadSha: 'previous', checks: [], reviews: [], blockers: [], nextAction: '',
  workspaceUrl: null, agentUrl: null, ideUrl: null, developmentApps: [], verificationApps: [], isContributor: true,
  canContinueBranch: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: null,
};

describe('DeveloperModeStore', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels stale reads and does not overlap polling requests', async () => {
    vi.useFakeTimers();
    const first = new Subject<{ runs: ImplementationRun[] }>();
    const current = new Subject<{ runs: ImplementationRun[] }>();
    const poll = new Subject<{ runs: ImplementationRun[] }>();
    const list = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(current).mockReturnValueOnce(poll);
    const store = configure(list);

    store.connect(context, 41, false, false);
    store.connect(context, 42, false, false);
    first.next({ runs: [{ ...run, requirementNumber: 41 }] });
    expect(store.runs()).toEqual([]);
    current.next({ runs: [run] });
    current.complete();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(list).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(list).toHaveBeenCalledTimes(3);
    poll.next({ runs: [{ ...run, phase: 'done' }] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('backs off polling failures', async () => {
    vi.useFakeTimers();
    const list = vi.fn()
      .mockReturnValueOnce(of({ runs: [run] }))
      .mockReturnValueOnce(throwError(() => ({ error: { error: 'Temporary failure' } })))
      .mockReturnValueOnce(of({ runs: [{ ...run, phase: 'done' }] }));
    const store = configure(list);
    store.connect(context, 42, false, false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('does not poll states that need user action', async () => {
    vi.useFakeTimers();
    const list = vi.fn(() => of({ runs: [{ ...run, phase: 'awaiting-review' }] }));
    const store = configure(list);
    store.connect(context, 42, false, true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(list).toHaveBeenCalledOnce();
  });

  it('pauses polling while the document is hidden', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    const list = vi.fn(() => of({ runs: [run] }));
    const store = configure(list);
    store.connect(context, 42, false, false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(list).toHaveBeenCalledOnce();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(list).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(list).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it('does not overlap commands', () => {
    const result = new Subject<ImplementationRun>();
    const start = vi.fn(() => result);
    const store = configure(vi.fn(() => of({ runs: [] })), { start });
    store.connect(context, 42, true, false);

    store.start('orders');
    store.start('orders');
    expect(start).toHaveBeenCalledOnce();
    expect(store.busy()).toBe(true);
    result.next(run);
    result.complete();
    expect(store.busy()).toBe(false);
  });
});

function configure(list: ReturnType<typeof vi.fn>, api: Record<string, unknown> = {}): DeveloperModeStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      DeveloperModeStore,
      { provide: ImplementationClient, useValue: { list, start: vi.fn(), review: vi.fn(), complete: vi.fn(), prepareVerification: vi.fn(), retryVerification: vi.fn(), retryCompletion: vi.fn(), ...api } },
      { provide: ApplicationsClient, useValue: { developmentTools: vi.fn(() => of(null)) } },
      { provide: TranslocoService, useValue: { translate: (key: string) => key } },
    ],
  });
  return TestBed.inject(DeveloperModeStore);
}
