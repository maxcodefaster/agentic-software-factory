/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'vitest';
import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';

describe('translations', () => {
  const retiredNamespaces = ['theme', 'settings', 'system', 'admin', 'notifications', 'notif'];

  test.each([
    ['en', en, 'Import a private Forgejo repository with developer and verification Dev Container configurations and a process-compose contract.'],
    ['de', de, 'Importiere ein privates Forgejo-Repository mit Dev-Container-Konfigurationen fuer Entwicklung und Verifizierung sowie einem process-compose-Vertrag.'],
  ])('%s describes the native repository contract', (_locale, translations, expected) => {
    expect(translations.applications.onboarding.intro).toBe(expected);
  });

  test('keeps locale keys equal and retired namespaces absent', () => {
    expect(flattenKeys(de)).toEqual(flattenKeys(en));
    for (const translations of [en, de]) {
      for (const namespace of retiredNamespaces) expect(translations).not.toHaveProperty(namespace);
    }
  });
});

function flattenKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? flattenKeys(child, path) : [path];
  }).sort();
}
