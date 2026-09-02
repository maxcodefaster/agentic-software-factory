/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';

import { ContextListbox } from './context-listbox';

function keydown(key: string, keyCode: number): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  return event;
}

describe('ContextListbox', () => {
  it('supports listbox navigation, selection, Escape, and focus restoration', async () => {
    await TestBed.configureTestingModule({ imports: [ContextListbox] }).compileComponents();
    const fixture = TestBed.createComponent(ContextListbox);
    fixture.componentRef.setInput('ariaLabel', 'Select team');
    fixture.componentRef.setInput('triggerText', 'Factory');
    fixture.componentRef.setInput('options', [
      { value: 'factory', label: 'Factory' },
      { value: 'platform', label: 'Platform' },
      { value: 'product', label: 'Product' },
    ]);
    fixture.componentRef.setInput('value', 'platform');
    const selected = vi.fn();
    fixture.componentInstance.valueChange.subscribe(selected);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;

    trigger.dispatchEvent(keydown('ArrowDown', 40));
    fixture.detectChanges();
    await fixture.whenStable();
    const listbox = root.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
    expect(document.activeElement?.textContent).toContain('Platform');

    document.activeElement?.dispatchEvent(keydown('Home', 36));
    expect(document.activeElement?.textContent).toContain('Factory');
    document.activeElement?.dispatchEvent(keydown('End', 35));
    expect(document.activeElement?.textContent).toContain('Product');
    document.activeElement?.dispatchEvent(keydown('ArrowUp', 38));
    expect(document.activeElement?.textContent).toContain('Platform');
    document.activeElement?.dispatchEvent(keydown('ArrowUp', 38));
    expect(document.activeElement?.textContent).toContain('Factory');
    document.activeElement?.dispatchEvent(keydown('Enter', 13));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selected).toHaveBeenCalledWith('factory');
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    root.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    document.activeElement?.dispatchEvent(keydown('Escape', 27));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Tab and focus-out, and runs the create action with keyboard focus restoration', async () => {
    await TestBed.configureTestingModule({ imports: [ContextListbox] }).compileComponents();
    const fixture = TestBed.createComponent(ContextListbox);
    fixture.componentRef.setInput('ariaLabel', 'Select application');
    fixture.componentRef.setInput('triggerText', 'Orders');
    fixture.componentRef.setInput('options', [{ value: 'orders', label: 'Orders' }]);
    fixture.componentRef.setInput('value', 'orders');
    fixture.componentRef.setInput('actionLabel', 'Create application');
    const action = vi.fn();
    fixture.componentInstance.action.subscribe(action);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const outside = document.createElement('button');
    document.body.append(outside);
    document.activeElement?.dispatchEvent(keydown('Tab', 9));
    outside.focus();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    outside.remove();

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const actionButton = root.querySelector<HTMLButtonElement>('[data-context-action]')!;
    actionButton.focus();
    actionButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(action).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const option = root.querySelector<HTMLButtonElement>('[role="option"]')!;
    option.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });
});
