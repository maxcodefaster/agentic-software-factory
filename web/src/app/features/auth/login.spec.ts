/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AuthFlowService } from '../../core/auth/auth-flow.service';
import { Login } from './login';

const translations = { auth: { productName: 'Factory', eyebrow: 'Delivery', productHeading: 'Ship code', productText: 'Product copy', stagesLabel: 'Stages', stageClarify: 'Clarify', stageBuild: 'Build', stageReview: 'Review', stageMerge: 'Merge', accountAccess: 'Account', loginTitle: 'Sign in', loginText: 'Use your account', organizationSignIn: 'Use SSO', or: 'or', email: 'Email', emailInvalid: 'Bad email', password: 'Password', passwordRequired: 'Password needed', signingIn: 'Signing in', managedAccess: 'Managed access', configFailed: 'Config failed', loginFailed: 'Login failed', noMethods: 'No methods' }, common: { loading: 'Loading', signIn: 'Sign in' } };

describe('Login', () => {
  async function setup(config: { localEmailPassword: boolean; organizationSignIn: boolean; postLoginRedirect: string }) {
    const authFlow = {
      config: vi.fn().mockResolvedValue(config),
      returnTo: vi.fn().mockReturnValue('/board/42'),
      oauthQuery: vi.fn().mockReturnValue(undefined),
      signInWithEmail: vi.fn().mockResolvedValue('/board/42'),
      signInWithOrganization: vi.fn().mockResolvedValue('/sso'),
      follow: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [Login, TranslocoTestingModule.forRoot({ langs: { en: translations }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [{ provide: AuthFlowService, useValue: authFlow }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, authFlow };
  }

  it('shows local and organization methods from config', async () => {
    const { fixture } = await setup({ localEmailPassword: true, organizationSignIn: true, postLoginRedirect: '/' });
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('form')).not.toBeNull();
    expect(Array.from(element.querySelectorAll('button')).some((button) => button.textContent?.includes('Use SSO'))).toBe(true);
  });

  it('validates the local form before posting credentials', async () => {
    const { fixture, authFlow } = await setup({ localEmailPassword: true, organizationSignIn: false, postLoginRedirect: '/' });
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(authFlow.signInWithEmail).not.toHaveBeenCalled();
    expect(element.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);

    const email = element.querySelector<HTMLInputElement>('#auth-email')!;
    const password = element.querySelector<HTMLInputElement>('#auth-password')!;
    email.value = 'user@example.test';
    email.dispatchEvent(new Event('input'));
    password.value = 'secret';
    password.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(authFlow.signInWithEmail).toHaveBeenCalledWith('user@example.test', 'secret', '/board/42', undefined);
    expect(authFlow.follow).toHaveBeenCalledWith('/board/42');
  });
});
