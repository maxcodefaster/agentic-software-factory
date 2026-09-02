/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { Subject } from 'rxjs';

import type { CardEvent } from '@agentic-software-factory/api-contracts/kanban';
import { KanbanInterviewClient } from '../../core/api/kanban-interview.client';
import { CardActivity } from './card-activity';

describe('CardActivity', () => {
  it('reloads for card changes and ignores stale responses', async () => {
    const responses = new Map<string, Subject<{ events: CardEvent[] }>>();
    const getEvents = vi.fn((_context: unknown, cardId: string) => {
      const response = new Subject<{ events: CardEvent[] }>();
      responses.set(cardId, response);
      return response;
    });
    await TestBed.configureTestingModule({
      imports: [
        CardActivity,
        TranslocoTestingModule.forRoot({ langs: { en: {} }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } }),
      ],
      providers: [{ provide: KanbanInterviewClient, useValue: { getEvents } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CardActivity);
    const component = fixture.componentInstance as unknown as { events(): CardEvent[]; loading(): boolean; error(): boolean };

    fixture.componentRef.setInput('cardId', 'orders#1');
    fixture.detectChanges();
    fixture.componentRef.setInput('cardId', 'orders#2');
    fixture.detectChanges();

    const current = event('current');
    responses.get('orders#2')!.next({ events: [current] });
    responses.get('orders#1')!.next({ events: [event('stale')] });

    expect(getEvents.mock.calls.map(([, cardId]) => cardId)).toEqual(['orders#1', 'orders#2']);
    expect(component.events()).toEqual([current]);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBe(false);
  });
});

function event(id: string): CardEvent {
  return { id, type: 'created', actor: 'alice', payload: {}, createdAt: '2026-01-01T00:00:00Z' };
}
