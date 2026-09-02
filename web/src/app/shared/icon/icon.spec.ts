/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { Icon } from './icon';

/**
 * Verifies the <factory-icon> wrapper actually renders glyphs from
 * @ng-icons/lucide (it replaced the old hand-inlined SVG paths). Runs
 * in jsdom so it stands in for a browser check of the app-wide icon
 * refactor.
 */
function renderIcon(name: string): HTMLElement {
  const fixture = TestBed.createComponent(Icon);
  fixture.componentRef.setInput('name', name);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** The px the underlying <ng-icon> ends up rendering at (via --ng-icon__size). */
function renderedSize(size?: string | number): string {
  const fixture = TestBed.createComponent(Icon);
  fixture.componentRef.setInput('name', 'rocket');
  if (size !== undefined) fixture.componentRef.setInput('size', size);
  fixture.detectChanges();
  const ngIcon = (fixture.nativeElement as HTMLElement).querySelector('ng-icon');
  return (
    ngIcon
      ?.getAttribute('style')
      ?.match(/--ng-icon__size:\s*([^;]+)/)?.[1]
      ?.trim() ?? ''
  );
}

describe('Icon — @ng-icons/lucide wrapper', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Icon] }).compileComponents();
  });

  it('renders a real lucide <svg> for a mapped name', () => {
    const el = renderIcon('rocket');
    expect(el.querySelector('svg')).toBeTruthy();
    // lucide glyphs are stroke paths — at least one drawing element present.
    expect(el.querySelectorAll('svg path, svg circle, svg rect, svg line').length).toBeGreaterThan(
      0,
    );
  });

  it('renders every icon used across the app without error', () => {
    const names = [
      'rocket',
      'trophy',
      'shield',
      'git-branch',
      'package',
      'activity',
      'zap',
      'settings',
      'sparkles',
      'arrow-right',
      'plus',
      'check',
      'circle-check',
      'external-link',
      'chevron-down',
      'chevron-right',
      'building-2',
      'user',
      'layout-grid',
      'book-open',
      'gauge',
      'loader',
      'log-in',
      'server',
      'triangle-alert',
      'cloud',
      'code',
      'kanban',
      'pencil',
      'x',
      'trash-2',
    ];
    for (const name of names) {
      const el = renderIcon(name);
      expect(el.querySelector('svg'), `icon "${name}" should render an svg`).toBeTruthy();
    }
  });

  it('resolves named scale rungs to their px (xs12·sm14·md16·lg18·xl20·2xl24)', () => {
    expect(renderedSize('xs')).toBe('12px');
    expect(renderedSize('sm')).toBe('14px');
    expect(renderedSize('md')).toBe('16px');
    expect(renderedSize('lg')).toBe('18px');
    expect(renderedSize('xl')).toBe('20px');
    expect(renderedSize('2xl')).toBe('24px');
  });

  it('defaults to md (16px) when no size is given', () => {
    expect(renderedSize()).toBe('16px');
  });

  it('still accepts a raw number for the one-off hero glyph', () => {
    expect(renderedSize(120)).toBe('120px');
  });
});
