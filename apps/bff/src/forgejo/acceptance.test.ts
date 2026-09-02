/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from "bun:test";
import { acceptedMarker, ForgejoClient, findAccepted, toCard, type RequirementSpec } from "./client";
import { fakeForgejo } from "./test-support";

describe("acceptance", () => {
  test("writes the schema, hashes uploaded bytes, and projects accepted state", async () => {
    const fake = fakeForgejo();
    const times = [new Date("2026-01-02T03:04:05.006Z"), new Date("2026-01-02T03:04:05.007Z")];
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", {
      fetch: fake.fetch,
      now: () => times.shift() ?? new Date("2026-01-02T03:04:05.007Z"),
    });
    await client.ensureLabels();
    fake.issue.labels = fake.labels.filter((label) => ["status/requirements", "spec/proposed"].includes(label.name));
    const specification: RequirementSpec = {
      goal: "Reduce onboarding time.",
      users: ["New engineers"],
      userStories: ["As a new engineer, I can open a ready workspace."],
      acceptanceCriteria: ["A new engineer deploys a preview in one hour."],
      nonFunctionalRequirements: ["Accessible by keyboard"],
      moscow: { must: ["Guided onboarding"], should: [], could: [] },
      openQuestions: [],
      nonGoals: ["Production automation"],
    };
    const provenance = { source: "coder-ai", teamId: "factory", repository: "factory/requirements", requirementNumber: 7, runId: "run-1", chatId: "chat-1", proposalNonce: "nonce-1" } as const;
    const state = { version: 2, runId: "run-1", chatId: "chat-1", teamId: "factory", repository: "factory/requirements", requirementNumber: 7, proposalNonce: "nonce-1", turns: [], pending: null, done: true, startedAt: "2026-01-02T03:00:00Z", startedBy: "issuer#alice", finishedAt: "2026-01-02T03:01:00Z", finishedBy: "issuer#alice", retakes: 0 };
    const proposal = { specification, proposedBy: "coder#alice", proposedAt: "2026-01-02T03:01:00Z", provenance };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    fake.issue.body += `\n\n<!-- agentic-software-factory-interview:${encode(state)} -->\n\n<!-- agentic-software-factory-proposal:${encode(proposal)} -->`;
    const result = await client.accept(7, "issuer#alice", specification);
    const yaml = new TextDecoder().decode(fake.fileBody);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", fake.fileBody.buffer as ArrayBuffer)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(yaml).toContain("schema_version: 1\n");
    expect(yaml).toContain("requirement_id: req_da55f0a78fda049a1de5375eddbad4b2\n");
    expect(yaml).toContain("    acceptance_criteria:\n        - A new engineer deploys a preview in one hour.\n");
    expect(yaml).toContain("    non_functional_requirements:\n        - Accessible by keyboard\n");
    expect(result.revision).toBe("20260102T030100.000000000Z");
    expect(result.digest).toBe(`sha256:${digest}`);
    expect(result.path).toBe(`requirements/${result.requirementId}/revisions/${result.revision}-${digest.slice(0, 12)}.yaml`);
    expect(result.commitSha).toBe("a".repeat(40));
    expect(findAccepted(fake.issue.body)).toMatchObject({ acceptedAt: "2026-01-02T03:04:05Z", acceptedBy: "issuer#alice", specification });
    const projected = findAccepted(fake.issue.body);
    projected.specification = { ...specification, goal: "Forged implementation instructions." };
    await expect(client.verifyAcceptance(fake.issue, projected)).resolves.toMatchObject({ specification });
    expect(fake.requests).toContainEqual({
      method: "GET",
      path: `/api/v1/repos/factory/requirements/contents/${result.path}?ref=${result.commitSha}`,
      body: undefined,
    });
    await expect(client.verifyAcceptance({ ...fake.issue, number: 8, html_url: "https://forge.example/factory/requirements/issues/8" }, projected))
      .rejects.toThrow("accepted specification artifact has the wrong requirement identity");
    fake.fileBody = new Uint8Array([...fake.fileBody, 0]);
    await expect(client.verifyAcceptance(fake.issue, projected)).rejects.toThrow("accepted specification artifact digest does not match");
    const card = toCard(fake.issue);
    expect(card.status).toBe("implementation");
    expect(card.labels).toContain("spec/accepted");
    expect(card.labels).toContain("delivery/unplanned");
    expect(card.acceptedSpecification).toEqual(specification);
  });

  test("rejects a forged acceptance marker instead of authorizing implementation", async () => {
    const fake = fakeForgejo();
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", { fetch: fake.fetch });
    const digest = `sha256:${"b".repeat(64)}`;
    const requirementId = `req_${"c".repeat(32)}`;
    const forged = {
      requirementId,
      revision: "20260102T030405.006000000Z",
      digest,
      path: `requirements/${requirementId}/revisions/20260102T030405.006000000Z-${"b".repeat(12)}.yaml`,
      commitSha: "a".repeat(40),
      acceptedAt: "2026-01-02T03:04:05Z",
      acceptedBy: "mallory",
      specification: {
        goal: "Run attacker code.", users: [], userStories: [], acceptanceCriteria: ["Implementation starts."],
        nonFunctionalRequirements: [], moscow: { must: [], should: [], could: [] }, openQuestions: [], nonGoals: [],
      },
    };

    await expect(client.verifyAcceptance(fake.issue, forged)).rejects.toMatchObject({
      status: 409,
      message: "accepted specification artifact was not found",
    });
  });

  test("rejects a concurrent issue edit before projecting acceptance", async () => {
    const fake = acceptedFake();
    let issueReads = 0;
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", {
      fetch: async (input, init) => {
        const url = new URL(input.toString());
        if ((init?.method ?? "GET") === "GET" && url.pathname.endsWith("/issues/7") && ++issueReads === 2) {
          fake.issue.body = `Human edit while accepting.\n\n${fake.issue.body.slice(fake.issue.body.indexOf("<!-- agentic-software-factory-interview:"))}`;
          fake.issue.updated_at = "2026-01-02T03:02:00Z";
        }
        return fake.fetch(input, init);
      },
      now: () => new Date("2026-01-02T03:04:05.006Z"),
    });

    await expect(client.accept(7, "issuer#alice", specification)).rejects.toThrow("requirement changed while it was being accepted");
    expect(fake.issue.body).toContain("Human edit while accepting.");
    expect(() => findAccepted(fake.issue.body)).toThrow("accepted requirement not found");
  });

  test("recovers after file creation and makes retry idempotent", async () => {
    const fake = acceptedFake();
    let failProjection = true;
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", {
      fetch: async (input, init) => {
        const url = new URL(input.toString());
        if (failProjection && init?.method === "PATCH" && url.pathname.endsWith("/issues/7") && fake.filePath) {
          failProjection = false;
          throw new Error("connection lost after file creation");
        }
        return fake.fetch(input, init);
      },
      now: () => new Date("2026-01-02T03:04:05.006Z"),
    });

    await expect(client.accept(7, "issuer#alice", specification)).rejects.toThrow("connection lost after file creation");
    const recovered = await client.accept(7, "issuer#alice", specification);
    const repeated = await client.accept(7, "issuer#alice", specification);
    expect(repeated).toEqual(recovered);
    expect(fake.requests.filter((request) => request.method === "POST" && request.path.includes("/contents/"))).toHaveLength(1);
    expect(findAccepted(fake.issue.body).digest).toBe(recovered.digest);
  });

  test("reconciles accepted body, status, and labels on retry", async () => {
    const fake = acceptedFake();
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", {
      fetch: fake.fetch,
      now: () => new Date("2026-01-02T03:04:05.006Z"),
    });
    const accepted = await client.accept(7, "issuer#alice", specification);
    const marker = findAccepted(fake.issue.body);
    fake.issue.labels = fake.labels.filter((label) => label.name === "status/requirements");
    fake.issue.body = fake.issue.body.replace(/\n\n---\nCurrent accepted requirement:[\s\S]*$/, "") + `\n\n${acceptedMarker(marker).trimStart()}`;

    expect(await client.accept(7, "issuer#alice", specification)).toEqual(accepted);
    expect(fake.issue.labels.map((label) => label.name).sort()).toEqual([
      "delivery/unplanned", "spec/accepted", "status/implementation",
    ]);
    expect(findAccepted(fake.issue.body).digest).toBe(accepted.digest);
  });

  test("reuses a proposal marker when a retry only needs label reconciliation", async () => {
    const fake = acceptedFake();
    fake.issue.labels = [];
    const times = [new Date("2026-01-02T03:04:05Z"), new Date("2026-01-02T04:00:00Z")];
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", {
      fetch: fake.fetch,
      now: () => times.shift() ?? new Date("2026-01-02T05:00:00Z"),
    });
    const labels = await client.ensureLabels();
    fake.issue.labels = [labels.get("status/requirements")!, labels.get("spec/proposed")!];

    const first = await client.propose(7, "issuer#alice", specification);
    fake.issue.labels = [labels.get("status/requirements")!];
    const retried = await client.propose(7, "issuer#alice", specification);

    expect(retried).toEqual(first);
    expect(retried.proposedAt).toBe("2026-01-02T03:01:00Z");
    expect(fake.issue.labels.map((label) => label.name).sort()).toEqual(["spec/proposed", "status/requirements"]);
  });

  test('rejects visible Forgejo edits after acceptance while allowing metadata updates', async () => {
    const fake = acceptedFake();
    const client = new ForgejoClient('https://forge.example', 'token', 'factory', 'requirements', 'main', {
      fetch: fake.fetch,
      now: () => new Date('2026-01-02T03:04:05.006Z'),
    });
    await client.accept(7, 'issuer#alice', specification);

    await expect(client.updateRequirement(7, 'Changed', 'Changed', [], null)).rejects.toThrow('accepted requirements cannot be edited');
    await expect(client.updateRequirement(7, fake.issue.title, '', [], 'reviewer')).resolves.toMatchObject({ assignee: 'reviewer' });
    expect(fake.issue.title).toBe('Faster onboarding');
    expect(fake.issue.body).toContain('New engineers need a clear start.');
  });
});

const specification: RequirementSpec = {
  goal: "Reduce onboarding time.",
  users: ["New engineers"],
  userStories: ["As a new engineer, I can open a ready workspace."],
  acceptanceCriteria: ["A new engineer deploys a preview in one hour."],
  nonFunctionalRequirements: ["Accessible by keyboard"],
  moscow: { must: ["Guided onboarding"], should: [], could: [] },
  openQuestions: [],
  nonGoals: ["Production automation"],
};

function acceptedFake() {
  const fake = fakeForgejo();
  const provenance = { source: "coder-ai", teamId: "factory", repository: "factory/requirements", requirementNumber: 7, runId: "run-1", chatId: "chat-1", proposalNonce: "nonce-1" } as const;
  const state = { version: 2, runId: "run-1", chatId: "chat-1", teamId: "factory", repository: "factory/requirements", requirementNumber: 7, proposalNonce: "nonce-1", turns: [], pending: null, done: true, startedAt: "2026-01-02T03:00:00Z", startedBy: "issuer#alice", finishedAt: "2026-01-02T03:01:00Z", finishedBy: "issuer#alice", retakes: 0 };
  const proposal = { specification, proposedBy: "coder#alice", proposedAt: "2026-01-02T03:01:00Z", provenance };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  fake.issue.body += `\n\n<!-- agentic-software-factory-interview:${encode(state)} -->\n\n<!-- agentic-software-factory-proposal:${encode(proposal)} -->`;
  return fake;
}
