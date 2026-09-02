/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of } from 'rxjs';

import type { InterviewState } from '@agentic-software-factory/api-contracts/kanban';
import { KanbanInterviewClient } from '../../core/api/kanban-interview.client';
import { CardInterview } from './card-interview';

const question = { id: 'q-1', header: 'Scope', prompt: 'Which scope?', type: 'single' as const, options: [{ value: 'small', label: 'Small', description: null }, { value: 'large', label: 'Large', description: null }], allowCustom: true, hint: null };
const answer = { questionId: question.id, expectedVersion: 1, selected: ['small'], customText: '' };
const pending: InterviewState = {
  version: 1, runId: 'run-1', chatId: 'chat-1', turns: [], pending: question, done: false,
  startedAt: '2026-08-20T01:00:00Z', startedBy: 'alice', retakes: 0,
  pendingOperation: { operationId: 'turn-1', answer, payload: 'Small', previousQuestionId: question.id, expectedVersion: 1, phase: 'answer', createdAt: '2026-08-20T01:01:00Z', createdBy: 'alice' },
};

describe('CardInterview async answer polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders pending processing state', async () => {
    const get = vi.fn(() => of({ state: pending, spec: null, agent: { available: true } }));
    await configure(get);
    const fixture = TestBed.createComponent(CardInterview);
    fixture.componentRef.setInput('cardId', '7');
    fixture.componentRef.setInput('canMutate', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your answer: Small');
    expect(fixture.nativeElement.textContent).toContain('Answer saved. AI is checking whether another question is needed.');

    fixture.destroy();
  });

  it('exposes retry when processing reports a failure', async () => {
    const failed = { ...pending, pendingOperation: { ...pending.pendingOperation!, failure: { message: 'Coder timed out', retryable: true, failedAt: '2026-08-20T01:02:00Z' } } };
    const get = vi.fn(() => of({ state: failed, spec: null, agent: { available: true } }));
    await configure(get);
    const fixture = TestBed.createComponent(CardInterview);
    fixture.componentRef.setInput('cardId', '7');
    fixture.componentRef.setInput('canMutate', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Coder timed out');
    expect(fixture.nativeElement.textContent).toContain('Retry AI response');
    fixture.destroy();
  });

  it('shows proposal progress and does not offer retry for terminal failures', async () => {
    const failed = { ...pending, pendingOperation: { ...pending.pendingOperation!, phase: 'proposal' as const, failure: { message: 'Question limit violated', retryable: false, failedAt: '2026-08-20T01:02:00Z' } } };
    const get = vi.fn(() => of({ state: failed, spec: null, agent: { available: true } }));
    await configure(get);
    const fixture = TestBed.createComponent(CardInterview);
    fixture.componentRef.setInput('cardId', '7');
    fixture.componentRef.setInput('canMutate', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Interview complete, but AI could not draft the specification.');
    expect(fixture.nativeElement.textContent).toContain('Question limit violated');
    expect(fixture.nativeElement.textContent).not.toContain('Retry AI response');
    fixture.destroy();
  });

  it('keeps the interview in Factory and confirms a completed retake', async () => {
    const done = { ...pending, pending: null, pendingOperation: null, done: true };
    const retake = vi.fn(() => of({ state: pending }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const get = vi.fn(() => of({ state: done, spec: null, agent: { available: true, chatUrl: 'https://coder.example/agents/chat-1' } }));
    await configure(get, { retake });
    const fixture = TestBed.createComponent(CardInterview);
    fixture.componentRef.setInput('cardId', '7');
    fixture.componentRef.setInput('canMutate', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('a[href="https://coder.example/agents/chat-1"]')).toBeNull();
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Restart'))!.click();
    expect(confirm).toHaveBeenCalledWith('Restarting discards this interview and its proposed specification. Continue?');
    expect(retake).toHaveBeenCalledWith({ team: 'factory', application: null }, '7');
  });

  it('keeps the completed interview when retake confirmation is declined', async () => {
    const done = { ...pending, pending: null, pendingOperation: null, done: true };
    const retake = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const get = vi.fn(() => of({ state: done, spec: null, agent: { available: true } }));
    await configure(get, { retake });
    const fixture = TestBed.createComponent(CardInterview);
    fixture.componentRef.setInput('cardId', '7');
    fixture.componentRef.setInput('canMutate', true);
    fixture.detectChanges();

    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Restart'))!.click();
    expect(retake).not.toHaveBeenCalled();
  });
});

async function configure(get: ReturnType<typeof vi.fn>, api: Record<string, unknown> = {}): Promise<void> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CardInterview, TranslocoTestingModule.forRoot({
      langs: { en: { card: { interviewReady: 'AI ready', submittedAnswer: 'Your answer:', answerPending: 'Answer saved. AI is checking whether another question is needed.', proposalPending: 'Interview complete. AI is drafting the specification.', answerFailed: 'Answer saved, but AI could not process it.', proposalFailed: 'Interview complete, but AI could not draft the specification.', retryResponse: 'Retry AI response', question: 'Question {{n}}', ownAnswer: 'Other', ownAnswerPh: '', chooseHint: '', enterHint: '', next: 'Next', errInterviewLoad: 'Interview could not be loaded.', openInterviewAgent: 'Open interview Agent Chat', restart: 'Restart', retakeConfirm: 'Restarting discards this interview and its proposed specification. Continue?', clarifiedDesc: 'Complete', sharpenAdd: 'Sharpen' }, board: { status: { reqClarified: 'Requirement clarified' } }, common: { cancel: 'Cancel' } } },
      translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
    })],
    providers: [{ provide: KanbanInterviewClient, useValue: { get, retry: vi.fn(), ...api } }],
  }).compileComponents();
}
