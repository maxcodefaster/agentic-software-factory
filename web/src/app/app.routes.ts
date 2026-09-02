/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { inject } from '@angular/core';
import type { Routes, UrlMatcher } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { authGuard } from './core/auth/auth.guard';
import { BoardStore } from './features/kanban/board.store';

export const boardMatcher: UrlMatcher = (segments) => {
  if (segments.length === 0) return { consumed: [] };
  if (segments.length === 2 && segments[0].path === 'board') {
    return { consumed: segments, posParams: { requirementId: segments[1] } };
  }
  return null;
};

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
    title: () => inject(TranslocoService).translate('auth.loginTitle'),
  },
  {
    path: 'consent',
    loadComponent: () => import('./features/auth/consent').then((m) => m.Consent),
    title: () => inject(TranslocoService).translate('auth.consentTitle'),
  },
  {
    matcher: boardMatcher,
    canActivate: [authGuard],
    providers: [BoardStore],
    loadComponent: () => import('./features/kanban/kanban-board').then((m) => m.KanbanBoard),
    title: (route) => inject(TranslocoService).translate(route.paramMap.has('requirementId') ? 'document.requirement' : 'document.requirements'),
  },
  {
    path: 'board',
    pathMatch: 'full',
    redirectTo: '',
  },
  { path: '**', redirectTo: '' },
];
