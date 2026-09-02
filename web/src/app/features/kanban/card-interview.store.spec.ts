/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { Subject, of, throwError } from 'rxjs';

import type { InterviewResponse, InterviewState } from '../../core/api/kanban.types';
import { KanbanInterviewClient } from '../../core/api/kanban-interview.client';
import { CardInterviewStore } from './card-interview.store';

const context = { team: 'factory', application: 'orders' };
const question = { id: 'q-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [], allowCustom: true, hint: null };
const answer = { questionId: question.id, expectedVersion: 1, selected: [], customText: 'Small' };
const pending: InterviewState = {
  version: 1,
  runId: 'run-1',
  chatId: 'chat-1',
  turns: [],
  pending: question,
  done: false,
  startedAt: '2026-08-20T01:00:00Z',
  startedBy: 'alice',
  retakes: 0,
  pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: question.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:01:00Z', createdBy: 'alice' },
};

describe('CardInterviewStore', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels a stale read when the card changes', () => {
    const first = new Subject<InterviewResponse>();
    const second = new Subject<InterviewResponse>();
    const get = vi.fn((_context, id: string) => id === '1' ? first : second);
    const store = configure(get);

    store.connect(context, '1', false);
    store.connect(context, '2', false);
    first.next({ state: { ...pending, runId: 'stale' }, spec: null, agent: { available: true } });
    expect(store.state()).toBeNull();

    second.next({ state: { ...pending, runId: 'current' }, spec: null, agent: { available: true } });
    expect(store.state()?.runId).toBe('current');
  });

  it('does not accept an in-flight interview response after the context changes', () => {
    const first = new Subject<InterviewResponse>();
    const second = new Subject<InterviewResponse>();
    const get = vi.fn((request: { team: string }) => request.team === 'factory' ? first : second);
    const store = configure(get);

    store.connect(context, '1', false);
    store.connect({ team: 'operations', application: 'orders' }, '1', false);
    first.next({ state: { ...pending, runId: 'stale' }, spec: null, agent: { available: true } });
    expect(store.state()).toBeNull();

    second.next({ state: { ...pending, runId: 'current' }, spec: null, agent: { available: true } });
    expect(store.state()?.runId).toBe('current');
  });

  it('backs off after a transient poll failure and stops at a settled state', async () => {
    vi.useFakeTimers();
    const settled = { ...pending, pendingOperation: null };
    const get = vi.fn()
      .mockReturnValueOnce(of({ state: pending, spec: null, agent: { available: true } }))
      .mockReturnValueOnce(throwError(() => ({ error: { error: 'Temporary failure' } })))
      .mockReturnValueOnce(of({ state: settled, spec: null, agent: { available: true } }));
    const store = configure(get);
    store.connect(context, '1', false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(store.error()).toBe('Temporary failure');
    await vi.advanceTimersByTimeAsync(999);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(get).toHaveBeenCalledTimes(3);
    expect(store.error()).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('does not overlap commands', () => {
    const startResult = new Subject<{ state: InterviewState }>();
    const start = vi.fn(() => startResult);
    const store = configure(vi.fn(() => of({ state: pending, spec: null, agent: { available: true } })), { start });
    store.connect(context, '1', true);

    store.start();
    store.start();
    expect(start).toHaveBeenCalledOnce();
    expect(store.busy()).toBe(true);
    startResult.next({ state: pending });
    startResult.complete();
    expect(store.busy()).toBe(false);
  });
});

function configure(get: ReturnType<typeof vi.fn>, api: Record<string, unknown> = {}): CardInterviewStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      CardInterviewStore,
      { provide: KanbanInterviewClient, useValue: { get, start: vi.fn(), retake: vi.fn(), sharpen: vi.fn(), answer: vi.fn(), retry: vi.fn(), ...api } },
      { provide: TranslocoService, useValue: { translate: (key: string) => key } },
    ],
  });
  return TestBed.inject(CardInterviewStore);
}
