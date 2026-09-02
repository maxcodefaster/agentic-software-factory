#!/usr/bin/env bun
/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

/**
 * Emit the two CSS artefacts from `src/tokens.ts`.
 *
 *   src/tokens.css  vanilla `:root { --brand-* }` custom properties
 *   src/theme.css   Tailwind v4 `@theme` token definitions
 *
 * Run `bun run generate` from `packages/design-system`. The renderers are pure
 * and exported so `__tests__/tokens.test.ts` can check the committed files.
 */
import { writeFile } from 'node:fs/promises';
import { brandTokens } from '../src/tokens';

const banner = (note: string) =>
  `/* AUTO-GENERATED from src/tokens.ts by scripts/generate.ts — DO NOT EDIT BY HAND.
 * Edit the tokens in src/tokens.ts, then run \`bun run generate\`.
 * ${note}
 * The drift test (__tests__/tokens.test.ts) fails if this file is stale.
 */`;

const line = (name: string, value: string) => `  ${name}: ${value};`;

/** Vanilla custom properties for non-Tailwind consumers. */
export function renderTokensCss(t = brandTokens): string {
  const block = (label: string, lines: string[]) => [`  /* ${label} */`, ...lines].join('\n');
  const modeBlocks = Object.entries(t.modes).flatMap(([mode, values]) => [
    block(
      `${mode} mode: color ramp`,
      Object.entries(values.gray).map(([k, v]) => line(`--brand-${mode}-gray-${k}`, v)),
    ),
    block(`${mode} mode: surfaces`, [
      line(`--brand-${mode}-surface`, values.surface.base),
      line(`--brand-${mode}-surface-muted`, values.surface.muted),
      line(`--brand-${mode}-surface-sunken`, values.surface.sunken),
    ]),
    block(
      `${mode} mode: status colors`,
      Object.entries(values.semantic).map(([k, v]) => line(`--brand-${mode}-${k}`, v)),
    ),
    block(
      `${mode} mode: shadows`,
      Object.entries(values.shadow).map(([k, v]) => line(`--brand-${mode}-shadow-${k}`, v)),
    ),
    block(`${mode} mode: overlays`, [line(`--brand-${mode}-scrim`, values.scrim)]),
    block(
      `${mode} mode: Spartan adapter contract`,
      Object.entries(values.spartan).map(([k, v]) => line(`--brand-${mode}-spartan-${k}`, v)),
    ),
    block(
      `${mode} mode: authentication pages`,
      Object.entries(values.auth).map(([k, v]) => line(`--brand-${mode}-auth-${k}`, v)),
    ),
  ]);
  const sections = [
    block(
      'Brand mint',
      Object.entries(t.mint).map(([k, v]) => line(`--brand-mint-${k}`, v)),
    ),
    block(
      'Legacy yellow aliases; use --brand-mint-* in new CSS',
      Object.keys(t.mint).map((k) => line(`--brand-yellow-${k}`, `var(--brand-mint-${k})`)),
    ),
    block(
      'Neutrals — cool/blue-tinted ramp; 900 is the primary foreground',
      Object.keys(t.gray).map((k) => line(`--brand-gray-${k}`, `var(--brand-light-gray-${k})`)),
    ),
    block(
      'Semantic',
      Object.keys(t.semantic).map((k) => line(`--brand-${k}`, `var(--brand-light-${k})`)),
    ),
    block(
      'Typography',
      Object.entries(t.fonts).map(([k, v]) => line(`--brand-font-${k}`, v)),
    ),
    block(
      'Radii',
      Object.entries(t.radius).map(([k, v]) => line(`--brand-radius-${k}`, v)),
    ),
    block('Semantic surfaces', [
      line('--brand-surface', 'var(--brand-light-surface)'),
      line('--brand-surface-muted', 'var(--brand-light-surface-muted)'),
      line('--brand-surface-sunken', 'var(--brand-light-surface-sunken)'),
    ]),
    block(
      'Spacing — spacing scale: 2/4/8/16/24/32/48/64/128',
      Object.entries(t.spacing).map(([k, v]) => line(`--brand-spacing-${k}`, v)),
    ),
    block(
      'Shadows',
      Object.keys(t.shadow).map((k) => line(`--brand-shadow-${k}`, `var(--brand-light-shadow-${k})`)),
    ),
    ...modeBlocks,
  ];
  return `${banner('Vanilla --brand-* custom properties; mount anywhere for the same look.')}\n:root {\n${sections.join('\n\n')}\n}\n`;
}

/** Tailwind v4 `@theme` block used to resolve token utilities. */
export function renderThemeCss(t = brandTokens): string {
  const block = (label: string, lines: string[]) => [`  /* ${label} */`, ...lines].join('\n');
  const sections = [
    block(
      'Brand mint; yellow is a compatibility alias',
      [
        ...Object.keys(t.mint).map((k) => line(`--color-brand-mint-${k}`, `var(--brand-mint-${k})`)),
        line('--color-brand-mint', 'var(--brand-mint-500)'),
        ...Object.keys(t.mint).map((k) => line(`--color-brand-yellow-${k}`, `var(--brand-yellow-${k})`)),
        line('--color-brand-yellow', 'var(--brand-yellow-500)'),
        line('--color-brand-ink', 'var(--brand-light-spartan-primary-foreground)'),
      ],
    ),
    block(
      'Neutrals',
      Object.keys(t.gray).map((k) => line(`--color-brand-gray-${k}`, `var(--brand-light-gray-${k})`)),
    ),
    block('Surfaces', [
      line('--color-brand-surface', 'var(--brand-light-surface)'),
      line('--color-brand-surface-muted', 'var(--brand-light-surface-muted)'),
      line('--color-brand-surface-sunken', 'var(--brand-light-surface-sunken)'),
    ]),
    block(
      'Semantic',
      Object.keys(t.semantic).map((k) => line(`--color-brand-${k}`, `var(--brand-light-${k})`)),
    ),
    block(
      'Fonts — font-sans resolves to the configured brand sans',
      Object.keys(t.fonts).map((k) => line(`--font-${k}`, `var(--brand-font-${k})`)),
    ),
    block(
      'Radii — rounded-brand-md, …',
      Object.keys(t.radius).map((k) => line(`--radius-brand-${k}`, `var(--brand-radius-${k})`)),
    ),
    block(
      'Shadows — shadow-brand-card, …',
      Object.keys(t.shadow).map((k) => line(`--shadow-brand-${k}`, `var(--brand-light-shadow-${k})`)),
    ),
    block(
      'Spacing',
      Object.keys(t.spacing).map((k) => line(`--spacing-brand-${k}`, `var(--brand-spacing-${k})`)),
    ),
  ];
  return `${banner('Tailwind v4 @theme token definitions.')}\n@import "./tokens.css";\n\n@theme {\n${sections.join('\n\n')}\n}\n`;
}

if (import.meta.main) {
  const here = new URL('..', import.meta.url).pathname;
  await writeFile(`${here}src/tokens.css`, renderTokensCss());
  await writeFile(`${here}src/theme.css`, renderThemeCss());
  console.log('wrote src/tokens.css + src/theme.css');
}
