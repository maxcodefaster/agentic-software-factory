/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { AuthShell } from './auth-shell';

describe('AuthShell', () => {
  it('renders product context and projected auth content with labelled regions', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthShell, TranslocoTestingModule.forRoot({
        langs: { en: { auth: { productName: 'Factory', eyebrow: 'Delivery', productHeading: 'Ship code', productText: 'Product copy', stagesLabel: 'Stages', stageClarify: 'Clarify', stageBuild: 'Build', stageReview: 'Review', stageMerge: 'Merge', accountAccess: 'Account' } } },
        translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
      })],
    }).compileComponents();
    const fixture = TestBed.createComponent(AuthShell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('#auth-product-heading')?.textContent).toContain('Ship code');
    expect(element.querySelector('section[aria-labelledby="auth-product-heading"]')).not.toBeNull();
    expect(element.querySelector('section[aria-label="Account"]')).not.toBeNull();
    expect(element.querySelectorAll('ol li')).toHaveLength(4);
  });
});
