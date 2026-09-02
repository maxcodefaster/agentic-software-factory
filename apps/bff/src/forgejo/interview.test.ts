/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from "bun:test";
import { ForgejoClient, type RequirementSpec } from "./client";
import { fakeForgejo } from "./test-support";
import { ApplicationError } from '../errors';

const question = {
  id: "question-1", header: "Users", prompt: "Who needs this?", type: "single" as const,
  options: [
    { value: "option-0", label: "Customers", description: null },
    { value: "option-1", label: "Employees", description: null },
  ],
  allowCustom: true, hint: null,
};
const binding = {
  teamId: "factory", repository: "factory/requirements", runId: "run-1", chatId: "chat-1", proposalNonce: "nonce-1",
};
const specification: RequirementSpec = {
  goal: "Enable faster onboarding.", users: ["Engineers"], userStories: ["As an engineer, I can onboard."],
  acceptanceCriteria: ["An engineer can complete onboarding."], nonFunctionalRequirements: [],
  moscow: { must: ["Onboarding"], should: [], could: [] }, openQuestions: [], nonGoals: [],
};

describe("AI interview provenance", () => {
  test("requires a complete AI binding and validated question", async () => {
    const fake = fakeForgejo();
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", { fetch: fake.fetch });
    await expect(client.beginInterview(7, "alice", false, { ...binding, chatId: "" }, question, 0)).rejects.toThrow("binding is incomplete");
    await expect(client.beginInterview(7, "alice", false, binding, { ...question, options: [] }, 0)).rejects.toThrow("valid interview question");
  });

  test("rejects proposal and acceptance without matching AI provenance", async () => {
    const fake = fakeForgejo();
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", { fetch: fake.fetch });
    await client.ensureLabels();
    fake.issue.labels = fake.labels.filter((label) => ["status/requirements", "spec/draft"].includes(label.name));
    await client.beginInterview(7, "alice", false, binding, question, 0);
    await expect(client.propose(7, "alice", specification)).rejects.toThrow("finish the AI interview");
    await expect(client.propose(7, "coder", specification, {
      source: "coder-ai", ...binding, requirementNumber: 7, runId: "other-run",
    })).rejects.toThrow("completed AI interview");
    await expect(client.accept(7, "alice", specification)).rejects.toThrow("finish the AI interview");
  });

  test("rejects direct proposal and acceptance when no AI interview exists", async () => {
    const fake = fakeForgejo();
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", { fetch: fake.fetch });
    await client.ensureLabels();
    fake.issue.labels = fake.labels.filter((label) => ["status/requirements", "spec/draft"].includes(label.name));
    await expect(client.propose(7, "alice", specification)).rejects.toThrow("bound AI interview");
    await expect(client.accept(7, "alice", specification)).rejects.toThrow("completed AI interview proposal");
  });

  test("persists an answer operation before completion and rejects a changed answer", async () => {
    const fake = fakeForgejo();
    const client = new ForgejoClient("https://forge.example", "token", "factory", "requirements", "main", { fetch: fake.fetch });
    await client.beginInterview(7, "alice", false, binding, question, 0);
    const answer = { questionId: question.id, expectedVersion: 1, selected: ["option-0"], customText: "" };
    const stale = await client.prepareInterviewAnswer(7, "alice", { ...answer, expectedVersion: 0 }, "Customers", "operation-0")
      .catch((error: unknown) => error);
    expect(stale).toBeInstanceOf(ApplicationError);
    expect(stale).toMatchObject({ code: 'conflict', status: 409, message: 'interview changed; refresh before answering' });

    const saved = await client.prepareInterviewAnswer(7, "alice", answer, "Customers", "operation-1");

    expect(saved.pendingOperation).toMatchObject({
      operationId: "operation-1",
      answer,
      payload: "Customers",
      previousQuestionId: question.id,
      expectedVersion: 1,
      phase: "answer",
    });
    expect((await client.getInterview(7)).state.pendingOperation?.operationId).toBe("operation-1");
    expect(await client.reconcilableInterviews()).toEqual([
      { number: 7, state: expect.objectContaining({ pendingOperation: expect.objectContaining({ operationId: "operation-1", createdBy: "alice" }) }) },
    ]);
    expect(fake.requests.at(-1)?.path).toContain("labels=status%2Frequirements");
    const failed = await client.setInterviewOperationFailure(7, "operation-1", { message: "Coder timed out", retryable: true });
    expect(await client.reconcilableInterviews()).toEqual([]);
    expect(failed.pendingOperation?.failure).toEqual({
      message: "Coder timed out",
      retryable: true,
      failedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });
    expect((await client.setInterviewOperationFailure(7, "operation-1", null)).pendingOperation?.failure).toBeUndefined();
    await expect(client.prepareInterviewAnswer(7, "alice", { ...answer, selected: ["option-1"] }, "Employees", "operation-2"))
      .rejects.toThrow("a different answer is already saved");

    const next = { ...question, id: "question-2", prompt: "What happens next?" };
    const completed = await client.completeInterviewAnswer(7, "operation-1", next, false);
    expect(completed.pendingOperation).toBeNull();
    expect(completed.pending).toEqual(next);
    expect(completed.turns).toHaveLength(1);
    expect(completed.turns[0]?.answer).toEqual(answer);
  });
});
