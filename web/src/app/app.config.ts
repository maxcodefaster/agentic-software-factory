/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { provideTransloco, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorResponseInterceptor } from './core/api/error-response.interceptor';
import { AuthService } from './core/auth/auth.service';
import { isPublicAuthPath } from './core/auth/public-auth-route';
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  initialLocale,
} from './core/i18n/locale';
import { localeInterceptor } from './core/i18n/locale.interceptor';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    // Modern zoneless change detection — no zone.js shipped.
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),

    provideRouter(
      routes,
      withComponentInputBinding(),
      // The product uses one restrained page entrance animation.
      // (per-page fade-up). Running both gave every route a double animation.
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),

    provideHttpClient(withFetch(), withInterceptors([authInterceptor, localeInterceptor, errorResponseInterceptor])),

    // Runtime i18n (Transloco). German default + an optional English pack;
    // the active language is persisted and switchable without a rebuild.
    provideTransloco({
      config: {
        availableLangs: [...AVAILABLE_LOCALES],
        defaultLang: DEFAULT_LOCALE,
        fallbackLang: FALLBACK_LOCALE,
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      },
      loader: TranslocoHttpLoader,
    }),

    // Preload the active locale so the first paint isn't a flash of keys, then
    // hydrate the session (chrome + team context) before the first view.
    provideAppInitializer(() => {
      const transloco = inject(TranslocoService);
      const lang = initialLocale();
      transloco.setActiveLang(lang);
      return firstValueFrom(transloco.load(lang));
    }),
    provideAppInitializer(() => isPublicAuthPath(window.location.pathname) ? undefined : inject(AuthService).hydrate()),
  ],
};
