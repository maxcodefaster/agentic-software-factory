/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { resolve, sep } from "node:path";

// @ts-expect-error generated build output has no declaration file
const start = (await import("../dist/server/server.js")).default as {
  fetch(request: Request): Promise<Response>;
};

const root = resolve(import.meta.dir, "../dist/client");
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || "4173");

Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname.startsWith("/assets/")) {
      const candidate = resolve(root, `.${pathname}`);
      if (!candidate.startsWith(`${root}${sep}`))
        return new Response("Not found", { status: 404 });
      const file = Bun.file(candidate);
      if (!(await file.exists()))
        return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : file, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return start.fetch(request);
  },
});

console.log(`Started server: http://${hostname}:${port}`);
