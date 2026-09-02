/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of } from 'rxjs';

import { CardCreate } from './card-create';
import { UsersClient } from '../../core/api/users.client';

describe('CardCreate', () => {
  it('uses the trimmed title as context when context is blank', async () => {
    await TestBed.configureTestingModule({
      imports: [CardCreate, TranslocoTestingModule.forRoot({
        langs: { en: { factory: { newRequirement: 'New requirement', ideaQuestion: 'What should change?', title: 'Title', context: 'Context', addBacklog: 'Add' }, common: { close: 'Close', cancel: 'Cancel' } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
      providers: [{ provide: UsersClient, useValue: { list: () => of({ users: [{ id: 'u1', username: 'alex', displayName: 'Alex', initials: 'AL' }] }) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CardCreate);
    const created = vi.fn();
    fixture.componentRef.setInput('column', 'ideation');
    fixture.componentInstance.create.subscribe(created);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const title = root.querySelector<HTMLInputElement>('#new-requirement-title')!;
    title.value = '  Audit invoices  ';
    title.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('footer button:last-child')!.click();

    expect(created).toHaveBeenCalledWith(expect.objectContaining({ title: 'Audit invoices', description: 'Audit invoices' }));
  });

  it('allows an optional assignee to be selected before creation', async () => {
    await TestBed.configureTestingModule({
      imports: [CardCreate, TranslocoTestingModule.forRoot({ langs: { en: { factory: { newRequirement: 'New requirement', ideaQuestion: 'What should change?', title: 'Title', context: 'Context', addBacklog: 'Add', responsibleOptional: 'Responsible optional', searchPeople: 'Search people', unassigned: 'Unassigned', noPeople: 'No people', peopleLoading: 'Loading people' }, common: { close: 'Close', cancel: 'Cancel' } } }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [{ provide: UsersClient, useValue: { list: () => of({ users: [{ id: 'u1', username: 'alex', displayName: 'Alex', initials: 'AL' }] }) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CardCreate);
    const created = vi.fn();
    fixture.componentRef.setInput('column', 'ideation');
    fixture.componentInstance.create.subscribe(created);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const title = root.querySelector<HTMLInputElement>('#new-requirement-title')!;
    title.value = 'Assigned ticket';
    title.dispatchEvent(new Event('input'));
    root.querySelector<HTMLInputElement>('#new-requirement-assignee')!.focus();
    fixture.detectChanges();
    [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((button) => button.textContent?.includes('Alex'))!.click();
    root.querySelector<HTMLButtonElement>('footer button:last-child')!.click();

    expect(created).toHaveBeenCalledWith(expect.objectContaining({ assignee: 'alex' }));
  });
});
