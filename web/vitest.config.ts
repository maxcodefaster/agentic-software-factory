/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the portal — used via
 * `ng test --runner-config=vitest.config.ts`.
 *
 * A single worker keeps Angular TestBed + JSDOM serial. Use a thread rather
 * than a child process: Vitest's fork handshake has a fixed five-second
 * startup deadline and flakes when the Angular builder or the host is busy.
 */
export default defineConfig({
  test: {
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
    isolate: true,
    testTimeout: 30_000,
    restoreMocks: true,
    // Avoid extra worker spin-up that the angular @angular/build:unit-test
    // builder sometimes triggers under bun's stdio redirection.
    fileParallelism: false,
  },
});
