/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { effect, Injectable, signal } from '@angular/core';
import { brandModes } from '@agentic-software-factory/design-system';

export type ThemePref = 'light' | 'dark' | 'system';

/**
 * Light/dark theming. The generated design-system contract owns both palettes;
 * this service toggles the `.dark` class, persists the preference, and follows
 * the OS when set to system.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private static readonly KEY = 'factory-theme';

  /** The user's preference (light / dark / follow system). */
  readonly pref = signal<ThemePref>(this.read());
  /** The resolved state actually applied to the document. */
  readonly isDark = signal(false);

  private readonly media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  constructor() {
    this.media?.addEventListener('change', () => {
      if (this.pref() === 'system') this.apply();
    });
    // Re-apply whenever the preference changes (also runs once on init).
    effect(() => {
      this.pref();
      this.apply();
    });
  }

  /** Flip between an explicit light and dark theme. */
  toggle(): void {
    this.set(this.isDark() ? 'light' : 'dark');
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    try {
      localStorage.setItem(ThemeService.KEY, pref);
    } catch {
      /* storage unavailable — preference is in-memory only */
    }
  }

  private apply(): void {
    const dark = this.pref() === 'dark' || (this.pref() === 'system' && !!this.media?.matches);
    this.isDark.set(dark);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', dark ? brandModes.dark.surface.muted : brandModes.light.surface.muted);
    }
  }

  private read(): ThemePref {
    try {
      const v = localStorage.getItem(ThemeService.KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      /* ignore */
    }
    return 'system';
  }
}
