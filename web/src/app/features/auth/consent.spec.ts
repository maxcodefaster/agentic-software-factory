/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AuthFlowService } from '../../core/auth/auth-flow.service';
import { Consent } from './consent';

describe('Consent', () => {
  it('renders OAuth values as text and submits the decision', async () => {
    window.history.replaceState({}, '', '/consent?client_id=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&scope=openid%20%26%20admin');
    const authFlow = {
      consentContext: vi.fn().mockResolvedValue({ clientId: '<img src=x onerror=alert(1)>', clientName: '<img src=x onerror=alert(1)>', scope: 'openid & admin' }),
      submitConsent: vi.fn().mockResolvedValue('https://client.example/callback'),
      follow: vi.fn(),
    };
    const auth = { productName: 'Factory', eyebrow: 'Delivery', productHeading: 'Ship code', productText: 'Product copy', stagesLabel: 'Stages', stageClarify: 'Clarify', stageBuild: 'Build', stageReview: 'Review', stageMerge: 'Merge', accountAccess: 'Account', consentTitle: 'Authorize', consentText: 'Review', clientId: 'Client', scope: 'Scope', allow: 'Allow', deny: 'Deny', consentFailed: 'Failed' };
    await TestBed.configureTestingModule({
      imports: [Consent, TranslocoTestingModule.forRoot({ langs: { en: { auth } }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } })],
      providers: [{ provide: AuthFlowService, useValue: authFlow }],
    }).compileComponents();
    const fixture = TestBed.createComponent(Consent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(authFlow.consentContext).toHaveBeenCalled());
    await authFlow.consentContext.mock.results[0]!.value;
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="client-id"]')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(element.querySelector('[data-testid="client-id"] img')).toBeNull();
    expect(element.querySelector('[data-testid="scope"]')?.textContent).toBe('openid & admin');
    element.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(authFlow.submitConsent).toHaveBeenCalledWith(true, '?client_id=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&scope=openid%20%26%20admin');
    expect(authFlow.follow).toHaveBeenCalledWith('https://client.example/callback');
  });
});
