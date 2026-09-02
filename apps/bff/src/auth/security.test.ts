/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import {
  isValidPkceVerifier,
  pkceChallenge,
} from './security';

describe('PKCE S256', () => {
  test('matches RFC 7636 appendix B', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(isValidPkceVerifier(verifier)).toBe(true);
    expect(await pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('enforces verifier and challenge boundaries', () => {
    expect(isValidPkceVerifier('a'.repeat(42))).toBe(false);
    expect(isValidPkceVerifier('a'.repeat(43))).toBe(true);
    expect(isValidPkceVerifier('a'.repeat(128))).toBe(true);
    expect(isValidPkceVerifier('a'.repeat(129))).toBe(false);
    expect(isValidPkceVerifier(`${'a'.repeat(42)}=`)).toBe(false);
  });
});
