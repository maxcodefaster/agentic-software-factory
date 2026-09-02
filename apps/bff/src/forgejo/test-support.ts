/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { Fetch, Issue, Label } from "./client";

export interface FakeForgejo {
  fetch: Fetch;
  issue: Issue;
  labels: Label[];
  filePath: string;
  fileBody: Uint8Array;
  requests: Array<{ method: string; path: string; body: unknown }>;
}

export function fakeForgejo(): FakeForgejo {
  const state: FakeForgejo = {
    fetch: async () => new Response(null, { status: 500 }),
    labels: [],
    issue: {
      id: 1,
      number: 7,
      title: "Faster onboarding",
      body: "New engineers need a clear start.",
      html_url: "https://forge.example/factory/requirements/issues/7",
      state: "open",
      labels: [],
      assignee: null,
      user: { login: "alice", full_name: "Alice", avatar_url: "" },
      created_at: "2026-01-02T03:00:00Z",
      updated_at: "2026-01-02T03:01:00Z",
    },
    filePath: "",
    fileBody: new Uint8Array(),
    requests: [],
  };
  state.fetch = async (input, init = {}) => {
    const url = new URL(input.toString());
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    state.requests.push({ method, path: `${url.pathname}${url.search}`, body });
    const repo = "/api/v1/repos/factory/requirements";
    if (method === "GET" && url.pathname === `${repo}/labels`) return json(state.labels);
    if (method === "POST" && url.pathname === `${repo}/labels`) {
      const created = { ...(body as Omit<Label, "id">), id: state.labels.length + 1 };
      state.labels.push(created);
      return json(created);
    }
    if (method === "GET" && url.pathname === `${repo}/issues`) return json([state.issue]);
    if (method === "GET" && url.pathname === `${repo}/issues/7`) return json(state.issue);
    if (method === "PUT" && url.pathname === `${repo}/issues/7/labels`) {
      const ids = (body as { labels: number[] }).labels;
      state.issue.labels = ids.flatMap((id) => state.labels.filter((label) => label.id === id));
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH" && url.pathname === `${repo}/issues/7`) {
      const patch = body as { body?: string; title?: string; state?: string; assignees?: string[] };
      if (patch.body !== undefined) state.issue.body = patch.body;
      if (patch.title !== undefined) state.issue.title = patch.title;
      if (patch.state !== undefined) state.issue.state = patch.state;
      if (patch.assignees !== undefined) {
        state.issue.assignee = patch.assignees[0]
          ? { login: patch.assignees[0], full_name: "", avatar_url: "" }
          : null;
      }
      return json(state.issue);
    }
    if (method === "POST" && url.pathname.startsWith(`${repo}/contents/`)) {
      const request = body as { content: string };
      if (state.filePath) return new Response("file exists", { status: 422 });
      state.filePath = url.pathname.slice(`${repo}/contents/`.length);
      state.fileBody = Uint8Array.from(atob(request.content), (character) => character.charCodeAt(0));
      return json({ commit: { sha: "a".repeat(40) } });
    }
    if (method === "GET" && url.pathname === `${repo}/contents/${state.filePath.split("/").slice(0, -1).join("/")}`
      && url.searchParams.get("ref") === "main") {
      return state.filePath
        ? json([{ name: state.filePath.split("/").at(-1), path: state.filePath, type: "file" }])
        : new Response("not found", { status: 404 });
    }
    if (method === "GET" && url.pathname === `${repo}/contents/${state.filePath}`
      && ["main", "a".repeat(40)].includes(url.searchParams.get("ref") ?? "")) {
      return json({ content: Buffer.from(state.fileBody).toString("base64") });
    }
    if (method === "GET" && url.pathname === `${repo}/branches/main`) return json({ commit: { id: "a".repeat(40) } });
    return new Response(`not found: ${method} ${url.pathname}${url.search}`, { status: 404 });
  };
  return state;
}

function json(value: unknown): Response {
  return Response.json(value);
}
