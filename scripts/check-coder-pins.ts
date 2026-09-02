/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

const root = new URL('../', import.meta.url).pathname;
const env = Object.fromEntries((await Bun.file(`${root}deploy/local/versions.env`).text()).split('\n')
  .filter((line) => /^[A-Z][A-Z0-9_]+=/.test(line)).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const required = ['CODER_CHART_VERSION', 'CODER_SERVER_VERSION', 'CODER_SERVER_DIGEST', 'CODER_TERRAFORM_PROVIDER_VERSION',
  'CODER_ENVBUILDER_VERSION', 'CODER_ENVBUILDER_DIGEST', 'CODER_CODE_SERVER_MODULE_VERSION', 'CODER_CODE_SERVER_VERSION',
  'FORGEJO_VERSION', 'FORGEJO_DIGEST'];
const failures = required.filter((key) => !env[key]).map((key) => `versions.env is missing ${key}`);
const exact: Array<[string, RegExp]> = [
  ['deploy/local/coder-values.yaml', new RegExp(`^    tag: ${env.CODER_SERVER_VERSION}$`, 'm')],
  ['templates/agentic-software-factory/main.tf', new RegExp(`version = "${env.CODER_TERRAFORM_PROVIDER_VERSION.replaceAll('.', '\\.')}"`)],
  ['templates/agentic-software-factory/main.tf', new RegExp(`coder/coder@sha256:${env.CODER_SERVER_DIGEST}`)],
  ['templates/agentic-software-factory/main.tf', new RegExp(`coder/envbuilder@sha256:${env.CODER_ENVBUILDER_DIGEST}`)],
  ['templates/agentic-software-factory/main.tf', new RegExp(`version         = "${env.CODER_CODE_SERVER_MODULE_VERSION.replaceAll('.', '\\.')}"`)],
  ['templates/agentic-software-factory/main.tf', new RegExp(`install_version = "${env.CODER_CODE_SERVER_VERSION.replaceAll('.', '\\.')}"`)],
  ['deploy/local/platform.yaml', new RegExp(`forgejo:${env.FORGEJO_VERSION}@sha256:${env.FORGEJO_DIGEST}`, 'g')],
];
for (const [path, pattern] of exact) {
  const source = await Bun.file(`${root}${path}`).text();
  const matches = source.match(pattern)?.length ?? 0;
  const expected = path === 'deploy/local/platform.yaml' ? 2 : 1;
  if (matches !== expected) failures.push(`${path}: expected ${expected} registered pin occurrence(s), found ${matches}`);
}
if (!env.FORGEJO_VERSION.startsWith('15.')) failures.push('Forgejo 15 is required by the downstream no-PKCE compatibility policy');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Upstream pins are consistent: Coder ${env.CODER_SERVER_VERSION}, chart ${env.CODER_CHART_VERSION}, provider ${env.CODER_TERRAFORM_PROVIDER_VERSION}; Forgejo ${env.FORGEJO_VERSION}.`);
