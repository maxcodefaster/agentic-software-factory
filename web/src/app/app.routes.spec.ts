/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { boardMatcher, routes } from './app.routes';

@Component({ template: '' })
class RoutedBoardStub {
  static instances = 0;
  readonly requirementId = input<string>();
  readonly team = input<string>();
  readonly application = input<string>();

  constructor() {
    RoutedBoardStub.instances += 1;
  }
}

describe('board routes', () => {
  it('places lazy public auth routes before the board matcher', () => {
    expect(routes[0].path).toBe('login');
    expect(routes[0].loadComponent).toBeTypeOf('function');
    expect(routes[1].path).toBe('consent');
    expect(routes[1].loadComponent).toBeTypeOf('function');
    expect(routes[2].matcher).toBe(boardMatcher);
  });

  it('reuses the board component across detail URLs and keeps team and System context', async () => {
    const boardRoute = routes.find((route) => route.matcher);
    expect(boardRoute?.matcher).toBeDefined();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ matcher: boardRoute!.matcher, component: RoutedBoardStub }],
          withComponentInputBinding(),
        ),
      ],
    });
    RoutedBoardStub.instances = 0;
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    let component = await harness.navigateByUrl('/?team=factory&application=factory%2Forders', RoutedBoardStub);
    expect(component.team()).toBe('factory');
    expect(component.application()).toBe('factory/orders');
    expect(component.requirementId()).toBeUndefined();

    component = await harness.navigateByUrl('/board/42?team=factory&application=factory%2Forders', RoutedBoardStub);
    expect(component.team()).toBe('factory');
    expect(component.application()).toBe('factory/orders');
    expect(component.requirementId()).toBe('42');
    expect(RoutedBoardStub.instances).toBe(1);

    component = await harness.navigateByUrl('/?team=factory&application=factory%2Forders', RoutedBoardStub);
    expect(component.team()).toBe('factory');
    expect(component.application()).toBe('factory/orders');
    expect(component.requirementId()).toBeUndefined();
    expect(router.url).toBe('/?team=factory&application=factory%2Forders');
    expect(RoutedBoardStub.instances).toBe(1);
  });
});
