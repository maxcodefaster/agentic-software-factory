/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, provideRouter, Router, type RouterStateSnapshot, UrlTree } from '@angular/router';

import { authGuard } from './auth.guard';
import { AuthService, type AuthState } from './auth.service';

describe('authGuard', () => {
  it.each(['loading', 'anonymous', 'unavailable'] as const)('returns a login UrlTree for %s', (state) => {
    const preserveRequestedUrl = vi.fn();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: { state: signal<AuthState>(state), preserveRequestedUrl } }] });

    const url = '/board/42?team=operations&application=operations%2Forders&view=activity';
    const result = TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login?return_to=%2Fboard%2F42%3Fteam%3Doperations%26application%3Doperations%252Forders%26view%3Dactivity');
    expect(preserveRequestedUrl).toHaveBeenCalledWith(url);
  });

  it('allows an authenticated session', () => {
    const preserveRequestedUrl = vi.fn();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: { state: signal<AuthState>('authenticated'), preserveRequestedUrl } }] });

    const result = TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url: '/board/42' } as RouterStateSnapshot));

    expect(result).toBe(true);
    expect(preserveRequestedUrl).not.toHaveBeenCalled();
  });
});
