/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

const pullPrefix = '<!-- agentic-software-factory-delivery:';
const reviewPrefix = '<!-- agentic-software-factory-delivery-review:';
const verificationPrefix = 'AFV ';

export interface DeliveryPullMarker {
  version: 1;
  deliveryId: string;
  tenantId: string;
  systemId: string;
  requirementNumber: number;
  acceptedDigest: string;
  artifactPath: string;
  artifactSha256: string;
}

export interface DeliveryVerificationMarker {
  version: 1;
  deliveryId: string;
  headSha: string;
  defaultSha: string;
  workspaceId: string;
}

export interface DeliveryReviewMarker extends Omit<DeliveryVerificationMarker, 'version'> {
  version: 2;
  reviewerIssuer: string;
  reviewerSubject: string;
}

export function pullMarker(value: DeliveryPullMarker): string {
  return `${pullPrefix}${encode(value)} -->`;
}

export function parsePullMarker(body: string): DeliveryPullMarker | null {
  return parse(body, pullPrefix, validPullMarker);
}

export function reviewMarker(value: DeliveryReviewMarker): string {
  return `${reviewPrefix}${encode(value)} -->`;
}

export function parseReviewMarker(body: string): DeliveryReviewMarker | null {
  return parse(body, reviewPrefix, validReviewMarker);
}

export function verificationDescription(value: DeliveryVerificationMarker, message: string): string {
  void message;
  return `${verificationPrefix}${encode([value.deliveryId, value.headSha, value.defaultSha, value.workspaceId])}`;
}

export function parseVerificationDescription(description: string): DeliveryVerificationMarker | null {
  if (!description.startsWith(verificationPrefix)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(description.slice(verificationPrefix.length), 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 4 || !parsed.every((item) => typeof item === 'string')) return null;
    const marker = { version: 1 as const, deliveryId: parsed[0]!, headSha: parsed[1]!, defaultSha: parsed[2]!, workspaceId: parsed[3]! };
    return validVerificationMarker(marker) ? marker : null;
  } catch {
    return null;
  }
}

function parse<T>(body: string, prefix: string, valid: (value: unknown) => value is T): T | null {
  const start = body.lastIndexOf(prefix);
  if (start < 0) return null;
  const end = body.indexOf(' -->', start + prefix.length);
  if (end < 0) return null;
  return decode(body.slice(start + prefix.length, end), valid);
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode<T>(value: string, valid: (input: unknown) => input is T): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validPullMarker(value: unknown): value is DeliveryPullMarker {
  if (!object(value)) return false;
  return value.version === 1
    && strings(value, ['deliveryId', 'tenantId', 'systemId', 'acceptedDigest', 'artifactPath', 'artifactSha256'])
    && Number.isSafeInteger(value.requirementNumber)
    && /^[0-9a-f]{64}$/.test(String(value.artifactSha256));
}

function validVerificationMarker(value: unknown): value is DeliveryVerificationMarker {
  if (!object(value)) return false;
  return value.version === 1
    && strings(value, ['deliveryId', 'headSha', 'defaultSha', 'workspaceId'])
    && /^[0-9a-f]{40}$/.test(String(value.headSha))
    && /^[0-9a-f]{40}$/.test(String(value.defaultSha));
}

function validReviewMarker(value: unknown): value is DeliveryReviewMarker {
  if (!object(value)) return false;
  return value.version === 2
    && strings(value, ['deliveryId', 'headSha', 'defaultSha', 'workspaceId', 'reviewerIssuer', 'reviewerSubject'])
    && /^[0-9a-f]{40}$/.test(String(value.headSha))
    && /^[0-9a-f]{40}$/.test(String(value.defaultSha));
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: Record<string, unknown>, names: string[]): boolean {
  return names.every((name) => typeof value[name] === 'string' && String(value[name]).length > 0);
}
