/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

/**
 * Design system — typed token export.
 *
 * The values themselves live in `./tokens.ts` (the single source of truth). The
 * runtime CSS artefacts (`./tokens.css`, `./theme.css`) are generated from the
 * same module — see `scripts/generate.ts`. This barrel re-exports the typed
 * tokens for the rare case where CSS-only access is not enough (e.g. chart
 * series colours or inline SVG fills).
 */

export {
  brandFonts,
  brandGray,
  brandMint,
  brandModes,
  brandRadius,
  brandSemantic,
  brandShadow,
  brandSpacing,
  brandSurface,
  brandTokens,
  brandYellow,
} from './tokens';
