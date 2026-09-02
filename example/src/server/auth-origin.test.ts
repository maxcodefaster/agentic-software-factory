/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { describe, expect, test } from "bun:test";
import { authOriginOptions } from "./auth-origin";

describe("auth origin configuration", () => {
  test("keeps a static local origin without trusting proxy headers", () => {
    expect(authOriginOptions("http://127.0.0.1:4173", undefined)).toEqual({
      baseURL: "http://127.0.0.1:4173",
      trustedOrigins: ["http://127.0.0.1:4173"],
      trustedProxyHeaders: false,
      useSecureCookies: false,
    });
  });

  test("trusts the exact Coder origin and its wildcard application origins", () => {
    expect(
      authOriginOptions("http://127.0.0.1:4173", "https://coder.example.test"),
    ).toEqual({
      baseURL: {
        allowedHosts: ["coder.example.test", "*.apps.coder.example.test"],
        protocol: "auto",
        fallback: "http://127.0.0.1:4173",
      },
      trustedOrigins: [
        "http://127.0.0.1:4173",
        "https://coder.example.test",
        "https://*.apps.coder.example.test",
      ],
      trustedProxyHeaders: true,
      useSecureCookies: true,
    });
  });

  test("allows rootless HTTP only for a localhost Coder origin", () => {
    expect(
      authOriginOptions("http://127.0.0.1:4173", "http://coder.localhost"),
    ).toEqual({
      baseURL: {
        allowedHosts: ["coder.localhost", "*.apps.coder.localhost"],
        protocol: "auto",
        fallback: "http://127.0.0.1:4173",
      },
      trustedOrigins: [
        "http://127.0.0.1:4173",
        "http://coder.localhost",
        "http://*.apps.coder.localhost",
      ],
      trustedProxyHeaders: true,
      useSecureCookies: false,
    });
  });

  test("rejects malformed and insecure Coder origins", () => {
    expect(() => authOriginOptions("http://127.0.0.1:4173", "*")).toThrow();
    expect(() =>
      authOriginOptions("http://127.0.0.1:4173", "http://coder.example.test"),
    ).toThrow();
    expect(() =>
      authOriginOptions(
        "http://127.0.0.1:4173",
        "https://coder.example.test/path",
      ),
    ).toThrow();
    expect(() =>
      authOriginOptions(
        "http://127.0.0.1:4173",
        "https://user@coder.example.test",
      ),
    ).toThrow();
    expect(() =>
      authOriginOptions("http://127.0.0.1:4173", "https://coder..example.test"),
    ).toThrow();
  });
});
