/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function isValidPkceVerifier(verifier: string): boolean {
  return PKCE_VERIFIER.test(verifier);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  if (!isValidPkceVerifier(verifier)) throw new Error('Invalid PKCE verifier');
  return sha256Base64Url(verifier);
}

export function assertRequestOrigin(request: Request, trustedOrigins: readonly string[]): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  const origin = request.headers.get('origin');
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== requestOrigin && !trustedOrigins.includes(origin))) {
    const error = new Error('Untrusted request origin') as Error & { status: number };
    error.status = 403;
    throw error;
  }
}
