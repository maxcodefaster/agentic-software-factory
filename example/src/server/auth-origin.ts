/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/

export function authOriginOptions(
  configuredURL: string,
  coderURL: string | undefined,
) {
  const fallback = new URL(configuredURL);
  if (!["http:", "https:"].includes(fallback.protocol))
    throw new Error("BETTER_AUTH_URL must use http or https");

  if (!coderURL)
    return {
      baseURL: fallback.origin,
      trustedOrigins: [fallback.origin],
      trustedProxyHeaders: false,
      useSecureCookies: fallback.protocol === "https:",
    };

  const coder = new URL(coderURL);
  const hostname = coder.hostname.toLowerCase();
  const wildcardHostname = `*.apps.${hostname}`;
  const localHttp =
    coder.protocol === "http:" && hostname.endsWith(".localhost");
  if (
    (coder.protocol !== "https:" && !localHttp) ||
    coder.username ||
    coder.password ||
    coder.pathname !== "/" ||
    coder.search ||
    coder.hash
  )
    throw new Error(
      "CODER_URL must be an HTTPS origin or an HTTP .localhost origin",
    );
  if (
    hostname.length > 253 ||
    !hostname.includes(".") ||
    !hostname
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("CODER_URL must contain a valid DNS hostname");

  return {
    baseURL: {
      allowedHosts: [hostname, wildcardHostname],
      protocol: "auto" as const,
      fallback: fallback.origin,
    },
    trustedOrigins: [
      fallback.origin,
      coder.origin,
      `${coder.protocol}//${wildcardHostname}`,
    ],
    trustedProxyHeaders: true,
    useSecureCookies: coder.protocol === "https:",
  };
}
