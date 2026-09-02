/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, input, type Signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideArrowDown,
  lucideArrowRight,
  lucideBell,
  lucideBolt,
  lucideBookOpen,
  lucideBox,
  lucideBuilding2,
  lucideCheck,
  lucideChevronDown,
  lucideChevronRight,
  lucideChevronUp,
  lucideCircle,
  lucideCircleAlert,
  lucideCircleCheck,
  lucideCloud,
  lucideCode2,
  lucideCopy,
  lucideDatabase,
  lucideExternalLink,
  lucideFolderGit2,
  lucideGauge,
  lucideGitBranch,
  lucideGitPullRequest,
  lucideKanban,
  lucideLanguages,
  lucideLayers,
  lucideLayoutGrid,
  lucideListChecks,
  lucideLoaderCircle,
  lucideLock,
  lucideLogIn,
  lucideLogOut,
  lucideMenu,
  lucideMoon,
  lucideNetwork,
  lucidePackage,
  lucidePanelLeft,
  lucidePencil,
  lucidePlay,
  lucidePlus,
  lucideRocket,
  lucideRefreshCw,
  lucideSearch,
  lucideServer,
  lucideSettings,
  lucideShield,
  lucideSparkles,
  lucideSquare,
  lucideSun,
  lucideTerminal,
  lucideTrash2,
  lucideTriangleAlert,
  lucideTrophy,
  lucideUser,
  lucideX,
  lucideZap,
} from '@ng-icons/lucide';

/**
 * Thin wrapper over `@ng-icons/lucide` (the real, maintained lucide
 * library that Spartan/ui already uses) — keeps an ergonomic
 * `name="rocket"` API so call sites stay terse and stable, while the
 * actual glyphs come from the library (no hand-maintained SVG paths).
 *
 * Usage:  <factory-icon name="trophy" size="lg" />
 */

/**
 * One intentional size ladder instead of a spread of arbitrary px
 * (we had 11/12/13/14/15/16/18/20/22/24 scattered across the app —
 * differences nobody chose). Inline-with-text icons pick a rung by
 * name; only the one hero glyph keeps a raw number.
 *
 *   xs 12 · sm 14 · md 16 · lg 18 · xl 20 · 2xl 24
 */
export type IconSizeName = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type IconSize = IconSizeName | number;

export const ICON_SIZES: Record<IconSizeName, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
};

/** Friendly kebab name → @ng-icons/lucide registration key. */
const NAME_MAP: Record<string, string> = {
  rocket: 'lucideRocket',
  'refresh-cw': 'lucideRefreshCw',
  trophy: 'lucideTrophy',
  shield: 'lucideShield',
  'git-branch': 'lucideGitBranch',
  package: 'lucidePackage',
  activity: 'lucideActivity',
  zap: 'lucideZap',
  settings: 'lucideSettings',
  sparkles: 'lucideSparkles',
  'arrow-right': 'lucideArrowRight',
  'arrow-down': 'lucideArrowDown',
  bell: 'lucideBell',
  bolt: 'lucideBolt',
  box: 'lucideBox',
  copy: 'lucideCopy',
  database: 'lucideDatabase',
  layers: 'lucideLayers',
  network: 'lucideNetwork',
  search: 'lucideSearch',
  'circle-alert': 'lucideCircleAlert',
  'git-pull-request': 'lucideGitPullRequest',
  plus: 'lucidePlus',
  play: 'lucidePlay',
  square: 'lucideSquare',
  check: 'lucideCheck',
  circle: 'lucideCircle',
  'circle-check': 'lucideCircleCheck',
  'list-checks': 'lucideListChecks',
  'external-link': 'lucideExternalLink',
  'chevron-down': 'lucideChevronDown',
  'chevron-right': 'lucideChevronRight',
  'chevron-up': 'lucideChevronUp',
  'folder-git-2': 'lucideFolderGit2',
  'building-2': 'lucideBuilding2',
  user: 'lucideUser',
  'layout-grid': 'lucideLayoutGrid',
  languages: 'lucideLanguages',
  'book-open': 'lucideBookOpen',
  gauge: 'lucideGauge',
  loader: 'lucideLoaderCircle',
  lock: 'lucideLock',
  'log-in': 'lucideLogIn',
  'log-out': 'lucideLogOut',
  menu: 'lucideMenu',
  server: 'lucideServer',
  'triangle-alert': 'lucideTriangleAlert',
  cloud: 'lucideCloud',
  code: 'lucideCode2',
  kanban: 'lucideKanban',
  pencil: 'lucidePencil',
  x: 'lucideX',
  'trash-2': 'lucideTrash2',
  moon: 'lucideMoon',
  'panel-left': 'lucidePanelLeft',
  sun: 'lucideSun',
  terminal: 'lucideTerminal',
};

@Component({
  selector: 'factory-icon',
  standalone: true,
  imports: [NgIcon],
  providers: [
    provideIcons({
      lucideRocket,
      lucideRefreshCw,
      lucideTrophy,
      lucideShield,
      lucideGitBranch,
      lucidePackage,
      lucideActivity,
      lucideZap,
      lucideSettings,
      lucideSparkles,
      lucideSquare,
      lucideArrowRight,
      lucideArrowDown,
      lucideBell,
      lucideBolt,
      lucideBox,
      lucideCopy,
      lucideDatabase,
      lucideLayers,
      lucideNetwork,
      lucideSearch,
      lucideCircleAlert,
      lucideGitPullRequest,
      lucidePlus,
      lucidePlay,
      lucideCheck,
      lucideCircle,
      lucideCircleCheck,
      lucideExternalLink,
      lucideFolderGit2,
      lucideChevronDown,
      lucideChevronRight,
      lucideChevronUp,
      lucideBuilding2,
      lucideUser,
      lucideLayoutGrid,
      lucideLanguages,
      lucideListChecks,
      lucideBookOpen,
      lucideGauge,
      lucideLoaderCircle,
      lucideLock,
      lucideLogIn,
      lucideLogOut,
      lucideMenu,
      lucideServer,
      lucideTriangleAlert,
      lucideCloud,
      lucideCode2,
      lucideKanban,
      lucidePencil,
      lucideX,
      lucideTrash2,
      lucideMoon,
      lucideSun,
      lucideTerminal,
      lucidePanelLeft,
    }),
  ],
  template: '<ng-icon [name]="iconName()" [size]="sizePx()" [strokeWidth]="strokeWidth()" />',
  styles: [':host{display:inline-flex;line-height:0}'],
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input<IconSize>('md');
  readonly strokeWidth = input<number>(2);

  protected readonly iconName: Signal<string> = computed(() => NAME_MAP[this.name()] ?? '');
  protected readonly sizePx: Signal<string> = computed(() => {
    const s = this.size();
    const px = typeof s === 'number' ? s : ICON_SIZES[s];
    return `${px}px`;
  });
}
