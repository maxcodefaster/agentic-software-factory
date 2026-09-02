/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderThemeCss, renderTokensCss } from '../scripts/generate';
import { brandMint, brandModes, brandYellow } from '../src/tokens';

/**
 * Drift guard: the committed CSS artefacts must equal what the generator emits
 * from src/tokens.ts. If this fails, run `bun run generate` and commit the
 * result — the tokens were edited without regenerating, or a CSS file was hand
 * edited (it must not be).
 */
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const readRepo = (f: string) => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');

describe('design tokens are the single source of truth', () => {
  it('src/tokens.css is up to date with src/tokens.ts', () => {
    expect(read('tokens.css')).toBe(renderTokensCss());
  });

  it('src/theme.css is up to date with src/tokens.ts', () => {
    expect(read('theme.css')).toBe(renderThemeCss());
  });

  it('defines complete light and dark contracts for each consumer', () => {
    expect(Object.keys(brandModes.light.spartan)).toEqual(Object.keys(brandModes.dark.spartan));
    expect(Object.keys(brandModes.light.auth)).toEqual(Object.keys(brandModes.dark.auth));
  });

  it('keeps yellow as an exact compatibility alias for the mint ramp', () => {
    expect(brandYellow).toBe(brandMint);
    expect(renderTokensCss()).toContain('--brand-yellow-500: var(--brand-mint-500);');
  });

  it('maps every portal Spartan variable to the generated mode contracts', () => {
    const css = readRepo('web/src/styles.css');
    const spartanVariables = Object.keys(brandModes.light.spartan);

    for (const mode of ['light', 'dark'] as const) {
      for (const variable of spartanVariables) {
        expect(css).toContain(`--${variable}: var(--brand-${mode}-spartan-${variable});`);
      }
    }
  });
});
