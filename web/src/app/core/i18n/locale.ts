/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

/**
 * German is the product default; English remains an optional runtime switch.
 */
export const AVAILABLE_LOCALES = ['en', 'de'] as const;
export type Locale = (typeof AVAILABLE_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
export const FALLBACK_LOCALE: Locale = 'en';
const STORAGE_KEY = 'factory-locale-v2';

/** The locale to boot with: the persisted choice, else the default. */
export function initialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'de') return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LOCALE;
}

/** Thin, signal-backed wrapper over Transloco for the active UI locale. */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);
  /** The active locale as a signal, so the chrome can react. */
  readonly active = signal<Locale>((this.transloco.getActiveLang() as Locale) ?? DEFAULT_LOCALE);

  constructor() {
    // Keep <html lang> in sync with the active locale (a11y + correct hyphenation).
    this.syncHtmlLang(this.active());
    this.syncDocumentTitle();
  }

  set(locale: Locale): void {
    this.transloco.setActiveLang(locale);
    this.active.set(locale);
    this.syncHtmlLang(locale);
    this.syncDocumentTitle();
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* storage unavailable */
    }
  }

  toggle(): void {
    this.set(this.active() === 'de' ? 'en' : 'de');
  }

  private syncHtmlLang(locale: Locale): void {
    try {
      document.documentElement.lang = locale;
    } catch {
      /* non-DOM environment */
    }
  }

  private syncDocumentTitle(): void {
    try {
      const key = location.pathname.startsWith('/board/') ? 'document.requirement' : 'document.requirements';
      document.title = this.transloco.translate(key);
    } catch {
      /* non-DOM environment */
    }
  }
}
