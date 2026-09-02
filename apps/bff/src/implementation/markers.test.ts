/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { parsePullMarker, parseReviewMarker, parseVerificationDescription, pullMarker, reviewMarker, verificationDescription } from './markers';

describe('delivery markers', () => {
  test('round-trips pull identity and review evidence', () => {
    const pull = {
      version: 1 as const, deliveryId: 'delivery-1', tenantId: 'tenant', systemId: 'factory/payments', requirementNumber: 7,
      acceptedDigest: 'sha256:accepted', artifactPath: 'factory/requirements/req-7.md', artifactSha256: 'a'.repeat(64),
    };
    const verification = { version: 1 as const, deliveryId: pull.deliveryId, headSha: 'b'.repeat(40), defaultSha: 'c'.repeat(40), workspaceId: 'verification-1' };
    const review = { ...verification, version: 2 as const, reviewerIssuer: 'https://factory.example', reviewerSubject: 'business-1' };

    expect(parsePullMarker(`text\n${pullMarker(pull)}`)).toEqual(pull);
    expect(parseReviewMarker(reviewMarker(review))).toEqual(review);
    expect(parseVerificationDescription(verificationDescription(verification, 'healthy'))).toEqual(verification);
    expect(verificationDescription(verification, 'healthy').length).toBeLessThanOrEqual(255);
  });

  test('rejects malformed evidence', () => {
    expect(parsePullMarker('<!-- agentic-software-factory-delivery:not-base64 -->')).toBeNull();
    expect(parseReviewMarker('<!-- agentic-software-factory-delivery-review:e30 -->')).toBeNull();
    expect(parseVerificationDescription('ordinary check output')).toBeNull();
  });
});
