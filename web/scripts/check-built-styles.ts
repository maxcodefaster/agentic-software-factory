/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

const directory = "dist/portal/browser";
const styles = [...new Bun.Glob("styles-*.css").scanSync(directory)];
if (styles.length !== 1) throw new Error("expected one built global stylesheet");

const css = await Bun.file(`${directory}/${styles[0]}`).text();
for (const selector of [".flex{", ".mx-auto{", ".overflow-x-auto{", ".rounded-brand-lg{"]) {
  if (!css.includes(selector)) throw new Error(`built stylesheet is missing ${selector}`);
}

const html = await Bun.file(`${directory}/index.html`).text();
if (html.includes('media="print"')) {
  throw new Error("built global stylesheet is print-gated and requires a CSP-blocked inline onload handler");
}

console.log("Built stylesheet contains required layout utilities and loads without inline handlers.");
