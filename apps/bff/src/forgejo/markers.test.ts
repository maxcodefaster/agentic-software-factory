/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from "bun:test";
import {
  acceptedMarker,
  applicationMarker,
  findAssignee,
  findAccepted,
  findApplications,
  findTeam,
  factoryAssigneeMarker,
  teamMarker,
  toCard,
  visibleIssueBody,
  type AcceptanceMetadata,
  type Issue,
  type RequirementSpec,
} from "./client";

const specification: RequirementSpec = {
  goal: "Support café users.",
  users: ["Customers"],
  userStories: [],
  acceptanceCriteria: ["The result is visible."],
  nonFunctionalRequirements: [],
  moscow: { must: ["Onboarding"], should: [], could: [] },
  openQuestions: [],
  nonGoals: [],
};

describe("issue markers", () => {
  test("stores a Factory assignee independently of a Forgejo account", () => {
    const body = `Description${factoryAssigneeMarker("future-user")}`;
    expect(findAssignee(body)).toBe("future-user");
    expect(visibleIssueBody(body)).toBe("Description");
    expect(toCard(issueWithBody(body)).assignee).toBe("future-user");
  });
  test("stores the team board outside the visible issue body", () => {
    const body = `Description${teamMarker("payments")}`;
    expect(findTeam(body)).toBe("payments");
    expect(visibleIssueBody(body)).toBe("Description");
    expect(toCard(issueWithBody(body)).team).toBe("payments");
    expect(findTeam("Legacy description")).toBeNull();
  });
  test("uses unpadded Base64URL and hides marker projections", () => {
    const acceptance: AcceptanceMetadata = {
      requirementId: "req_123",
      revision: "20260102T030405.006000000Z",
      digest: "sha256:abc",
      path: "requirements/req_123/revisions/revision.yaml",
      commitSha: "abc123",
      acceptedAt: "2026-01-02T03:04:05Z",
      acceptedBy: "issuer#alice",
      specification,
    };
    const applications = applicationMarker(["app-one", "app/two"]);
    const accepted = acceptedMarker(acceptance);
    expect(applications).not.toContain("=");
    expect(accepted.match(/agentic-software-factory-accepted:([^ ]+)/)?.[1]).not.toContain("=");
    const body = `Visible description${applications}${accepted}`;
    expect(visibleIssueBody(body)).toBe("Visible description");
    expect(findApplications(body)).toEqual([
      { id: "app-one", name: "app-one" },
      { id: "app/two", name: "app/two" },
    ]);
    expect(findAccepted(body)).toEqual(acceptance);
  });

  test("only projects accepted specification while its label is active", () => {
    const acceptance: AcceptanceMetadata = {
      requirementId: "req_123", revision: "r1", digest: "sha256:abc", path: "p", commitSha: "c",
      acceptedAt: "2026-01-02T03:04:05Z", acceptedBy: "alice", specification,
    };
    const issue = issueWithBody(`Description${acceptedMarker(acceptance)}`);
    expect(toCard(issue).acceptance).toEqual(acceptance);
    expect(toCard(issue).acceptedSpecification).toBeUndefined();
    issue.labels = [{ id: 1, name: "spec/accepted", color: "fff", exclusive: true }];
    expect(toCard(issue).acceptedSpecification).toEqual(specification);
  });
});

function issueWithBody(body: string): Issue {
  return {
    id: 1, number: 7, title: "Title", body, html_url: "https://forge/issues/7", state: "open", labels: [], assignee: null,
    user: { login: "alice", full_name: "Alice", avatar_url: "" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}
