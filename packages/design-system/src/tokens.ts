/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

/**
 * Typed design tokens are the single source of truth.
 *
 * Every token value lives here exactly once. Two CSS artefacts are GENERATED
 * from this module by `scripts/generate.ts` (run `bun run generate`):
 *
 *   - `tokens.css` provides vanilla `:root { --brand-* }` custom properties.
 *   - `theme.css` provides a Tailwind v4 `@theme` block so token utilities
 *     resolve from these values.
 *
 * A vitest (`__tests__/tokens.test.ts`) regenerates into memory and asserts the
 * committed CSS files match, so the three representations cannot drift.
 *
 * These are the neutral default brand values (a mint primary, cool grays, and
 * system fonts). A deployment can override the same `--brand-*` custom
 * properties at runtime.
 * The `brand-*` token namespace is a legacy name kept to avoid churn; the values
 * are what carry the brand.
 */

/** Brand primary mint ramp. 500 is canonical; 600 hover, 700 active. */
export const brandMint = {
  50: '#edfffb',
  100: '#d2fff5',
  200: '#a8f7e8',
  300: '#7fead8',
  400: '#65d9c4',
  500: '#55ffd3',
  600: '#35d3b0',
  700: '#229f87',
  800: '#197665',
  900: '#115247',
} as const;

/** @deprecated Use `brandMint`. Kept for existing TypeScript consumers. */
export const brandYellow = brandMint;

/** Cool, blue-tinted neutral ramp (hue ~220). 900 = primary foreground. */
export const brandGray = {
  50: '#f3f8f9',
  100: '#e5eff1',
  200: '#d3e1e4',
  300: '#b7cbd0',
  400: '#8ba1a9',
  500: '#667e87',
  600: '#465d66',
  700: '#2d414b',
  800: '#172631',
  900: '#081016',
} as const;

export const brandSemantic = {
  success: '#229f87',
  warning: '#b96820',
  'warning-strong': '#914b0e',
  caution: '#d9912d',
  danger: '#cc3333',
  'danger-dark': '#921100',
  info: '#368baa',
} as const;

/** Semantic surface aliases used by the app shell + cards. `base` is the page. */
export const brandSurface = {
  base: '#ffffff',
  muted: '#f3f8f9',
  sunken: '#e5eff1',
} as const;

export const brandFonts = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  slab: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'Menlo', 'Monaco', 'Cascadia Mono', 'Roboto Mono', 'Courier New', monospace",
} as const;

export const brandRadius = {
  sm: '0.625rem',
  md: '0.9rem',
  lg: '1.25rem',
  xl: '1.5rem',
  '2xl': '1.875rem',
  input: '0.75rem',
} as const;

/** Spacing scale: 2/4/8/16/24/32/48/64/128. */
export const brandSpacing = {
  xxxs: '0.125rem',
  xxs: '0.25rem',
  xs: '0.5rem',
  s: '1rem',
  m: '1.5rem',
  l: '2rem',
  xl: '3rem',
  xxl: '4rem',
  xxxl: '8rem',
} as const;

/** Soft, low-contrast elevation tuned to the cool palette (shadow colour
 *  carries a hint of the 900 near-black); header/dropdown are heavier overlays. */
export const brandShadow = {
  xs: '0 1px 2px 0 rgba(24, 28, 40, 0.05)',
  card: '0 1px 2px 0 rgba(24, 28, 40, 0.04), 0 1px 1px 0 rgba(24, 28, 40, 0.03)',
  md: '0 4px 12px -2px rgba(24, 28, 40, 0.1), 0 2px 6px -2px rgba(24, 28, 40, 0.06)',
  lift: '0 12px 28px -8px rgba(24, 28, 40, 0.16), 0 4px 10px -4px rgba(24, 28, 40, 0.08)',
  header:
    '0 2px 4px -1px rgba(0, 0, 0, 0.2), 0 1px 10px 0 rgba(0, 0, 0, 0.12), 0 4px 5px 0 rgba(0, 0, 0, 0.14)',
  dropdown:
    '0 15px 15px -7px rgba(0, 0, 0, 0.2), 0 46px 46px 8px rgba(0, 0, 0, 0.12), 0 38px 38px 3px rgba(0, 0, 0, 0.14)',
} as const;

const brandDarkGray = {
  50: '#090c14',
  100: '#101522',
  200: '#23313d',
  300: '#354954',
  400: '#667e87',
  500: '#8ba1a9',
  600: '#b7cbd0',
  700: '#d3e1e4',
  800: '#e5eff1',
  900: '#f3f8f9',
} as const;

const brandDarkSemantic = {
  success: '#5cc463',
  warning: '#e0a44a',
  'warning-strong': '#f0b563',
  caution: '#f2a64d',
  danger: '#ef5a5a',
  'danger-dark': '#ff8f7a',
  info: '#71cfe5',
} as const;

const brandDarkSurface = {
  base: '#101522',
  muted: '#090c14',
  sunken: '#070a11',
} as const;

const brandDarkShadow = {
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.4)',
  card: '0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 1px 1px 0 rgba(0, 0, 0, 0.3)',
  md: '0 4px 12px -2px rgba(0, 0, 0, 0.5), 0 2px 6px -2px rgba(0, 0, 0, 0.4)',
  lift: '0 14px 30px -10px rgba(0, 0, 0, 0.65), 0 6px 12px -6px rgba(0, 0, 0, 0.5)',
  header: brandShadow.header,
  dropdown: '0 16px 40px -8px rgba(0, 0, 0, 0.65), 0 8px 16px -6px rgba(0, 0, 0, 0.5)',
} as const;

const spartanLight = {
  background: '#ffffff',
  foreground: '#181c28',
  card: '#ffffff',
  'card-foreground': '#181c28',
  popover: '#ffffff',
  'popover-foreground': '#181c28',
  primary: brandMint[500],
  'primary-foreground': brandGray[900],
  secondary: '#edf0f5',
  'secondary-foreground': '#232838',
  muted: '#f5f7fa',
  'muted-foreground': '#6b7385',
  accent: '#edf0f5',
  'accent-foreground': '#181c28',
  destructive: brandSemantic.danger,
  border: '#e3e7ee',
  input: '#e3e7ee',
  ring: '#181c28',
  sidebar: '#ffffff',
  'sidebar-foreground': '#181c28',
  'sidebar-primary': '#181c28',
  'sidebar-primary-foreground': '#ffffff',
  'sidebar-accent': '#edf0f5',
  'sidebar-accent-foreground': '#181c28',
  'sidebar-border': '#e3e7ee',
  'sidebar-ring': '#181c28',
} as const;

const spartanDark = {
  background: '#090c14',
  foreground: '#e5eff1',
  card: '#101522',
  'card-foreground': '#e5eff1',
  popover: '#171e2e',
  'popover-foreground': '#e5eff1',
  primary: brandMint[500],
  'primary-foreground': brandGray[900],
  secondary: '#171e2e',
  'secondary-foreground': '#e5eff1',
  muted: '#101522',
  'muted-foreground': '#8ba1a9',
  accent: '#18343d',
  'accent-foreground': '#e5eff1',
  destructive: brandSemantic.danger,
  border: '#363d4e',
  input: '#363d4e',
  ring: brandMint[500],
  sidebar: '#090c14',
  'sidebar-foreground': '#e5eff1',
  'sidebar-primary': brandMint[500],
  'sidebar-primary-foreground': brandGray[900],
  'sidebar-accent': '#101522',
  'sidebar-accent-foreground': '#e5eff1',
  'sidebar-border': '#363d4e',
  'sidebar-ring': '#f5b70a',
} as const;

const authLight = {
  ink: brandGray[900],
  muted: brandGray[600],
  canvas: brandSurface.muted,
  surface: brandSurface.base,
  field: brandGray[50],
  line: brandGray[200],
  accent: brandMint[500],
  'accent-border': brandMint[700],
  focus: brandGray[900],
  danger: brandSemantic['danger-dark'],
  'glow-accent': 'rgb(85 255 211 / 0.17)',
  'glow-info': 'rgb(54 139 170 / 0.1)',
  'shell-shadow': '0 1.5rem 5rem rgb(22 58 64 / 0.13)',
  'story-overlay': 'rgb(255 255 255 / 0.62)',
  'step-background': 'rgb(255 255 255 / 0.58)',
  'accent-shadow': 'rgb(34 159 135 / 0.2)',
} as const;

const authDark = {
  ink: '#effbfa',
  muted: '#b9cdd1',
  canvas: '#071113',
  surface: '#0d191c',
  field: '#132226',
  line: '#304449',
  accent: brandMint[500],
  'accent-border': brandMint[700],
  focus: '#83ffe0',
  danger: '#ffb4ab',
  'glow-accent': 'rgb(85 255 211 / 0.11)',
  'glow-info': 'rgb(54 139 170 / 0.08)',
  'shell-shadow': '0 1.5rem 5rem rgb(0 0 0 / 0.28)',
  'story-overlay': 'rgb(85 255 211 / 0.035)',
  'step-background': 'rgb(19 34 38 / 0.72)',
  'accent-shadow': 'rgb(34 159 135 / 0.2)',
} as const;

/** Mode-qualified semantic contracts consumed by the portal and auth pages. */
export const brandModes = {
  light: {
    gray: brandGray,
    semantic: brandSemantic,
    surface: brandSurface,
    shadow: brandShadow,
    scrim: 'rgb(24 28 40 / 0.42)',
    spartan: spartanLight,
    auth: authLight,
  },
  dark: {
    gray: brandDarkGray,
    semantic: brandDarkSemantic,
    surface: brandDarkSurface,
    shadow: brandDarkShadow,
    scrim: 'rgb(0 0 0 / 0.6)',
    spartan: spartanDark,
    auth: authDark,
  },
} as const;

/**
 * The complete token set, grouped — consumed by the CSS generator. Each group
 * declares its vanilla (`--brand-*`) prefix and its Tailwind (`@theme`) namespace
 * so both artefacts derive from one place.
 */
export const brandTokens = {
  mint: brandMint,
  gray: brandGray,
  semantic: brandSemantic,
  surface: brandSurface,
  fonts: brandFonts,
  radius: brandRadius,
  spacing: brandSpacing,
  shadow: brandShadow,
  modes: brandModes,
} as const;
