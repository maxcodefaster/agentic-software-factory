/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { authOriginOptions } from "./auth-origin";
import { db } from "./db";
import * as schema from "./db/auth-schema";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32 || secret === "GENERATED_BY_BUN_RUN_SETUP")
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");

const configuredURL = process.env.BETTER_AUTH_URL;
if (!configuredURL) throw new Error("BETTER_AUTH_URL is required");

const origin = authOriginOptions(configuredURL, process.env.CODER_URL);
if (
  process.env.NODE_ENV === "production" &&
  new URL(configuredURL).protocol !== "https:" &&
  !["localhost", "127.0.0.1", "::1"].includes(
    new URL(configuredURL).hostname,
  ) &&
  !process.env.CODER_URL
)
  throw new Error("BETTER_AUTH_URL must use https in production");

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret,
  baseURL: origin.baseURL,
  trustedOrigins: origin.trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.BETTER_AUTH_ENABLE_SIGN_UP !== "true",
  },
  rateLimit: { enabled: true, window: 60, max: 100 },
  plugins: [tanstackStartCookies()],
  advanced: {
    trustedProxyHeaders: origin.trustedProxyHeaders,
    useSecureCookies: origin.useSecureCookies,
  },
});
