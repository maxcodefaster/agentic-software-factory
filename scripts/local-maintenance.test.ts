// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { describe, expect, test } from "bun:test";
import { planPrune, prune, resetData, type Exec, type PruneInventory } from "./local-maintenance";

const daysAgo = (days: number) => new Date(Date.UTC(2026, 8, 1) - days * 86_400_000).toISOString();

function inventory(): PruneInventory {
  return {
    now: new Date(Date.UTC(2026, 8, 1)),
    currentImage: "dev.local/agentic-software-factory-bff:current",
    images: [
      { id: "current", refs: ["dev.local/agentic-software-factory-bff:current"], createdAt: daysAgo(1), factoryOwned: true },
      { id: "rollback-1", refs: ["dev.local/agentic-software-factory-bff:r1"], createdAt: daysAgo(8), factoryOwned: true },
      { id: "rollback-2", refs: ["dev.local/agentic-software-factory-bff:r2"], createdAt: daysAgo(9), factoryOwned: true },
      { id: "old", refs: ["dev.local/agentic-software-factory-bff:old"], createdAt: daysAgo(10), factoryOwned: true },
      { id: "other", refs: ["other/image:old"], createdAt: daysAgo(20), factoryOwned: false },
    ],
    templateId: "template",
    templateName: "agentic-software-factory",
    activeTemplateVersionId: "active",
    templateVersions: [
      { id: "active", created_at: daysAgo(1), job: { status: "succeeded" } },
      { id: "rollback-1", created_at: daysAgo(8), job: { status: "succeeded" } },
      { id: "used", created_at: daysAgo(9), job: { status: "succeeded" } },
      { id: "old-version", created_at: daysAgo(10), job: { status: "failed" } },
    ],
    automationOwners: {
      verification: { id: "verification-owner", name: "factory-verification" },
      staging: { id: "stage-owner", name: "factory-stage" },
    },
    workspaces: [
      workspace("human-running", "alice", "alice-id", "work", "developer", "running", 30, "used"),
      workspace("human-stopped", "alice", "alice-id", "saved", "developer", "stopped", 30),
      workspace("automation-running", "factory-stage", "stage-owner", "staging-75ca8c094b", "staging", "running", 30),
      workspace("automation-recent", "factory-verification", "verification-owner", "verification-0123456789", "verification", "failed", 2),
      workspace("automation-old", "factory-verification", "verification-owner", "verification-abcdef0123", "verification", "failed", 10),
    ],
    pvcs: [
      { name: "human-pvc", workspaceId: "human-running", createdAt: daysAgo(30), mounted: false },
      { name: "mounted-orphan", workspaceId: "missing", createdAt: daysAgo(30), mounted: true },
      { name: "recent-orphan", workspaceId: "missing", createdAt: daysAgo(2), mounted: false },
      { name: "old-orphan", workspaceId: "missing", createdAt: daysAgo(30), mounted: false },
    ],
  };
}

function workspace(id: string, ownerName: string, ownerId: string, name: string, kind: string, status: string, days: number, version = "active") {
  return {
    id, owner_name: ownerName, owner_id: ownerId, name, template_id: "template", template_name: "agentic-software-factory",
    last_used_at: daysAgo(days), latest_build: { id: `build-${id}`, status, transition: "start", template_version_id: version },
    parameters: {
      workspace_kind: kind,
      workspace_namespace: "factory-workspaces",
      tenant_id: "factory",
      repository_url: "https://forgejo.factory-platform.svc.cluster.local:3000/factory/system.git",
      repository_ref: "a".repeat(40),
    },
  };
}

describe("local prune planning", () => {
  test("keeps current and recent rollback resources plus every user workspace", () => {
    expect(planPrune(inventory())).toEqual({
      imageIds: ["old"],
      templateVersionIds: ["old-version"],
      workspaceIds: ["automation-old"],
      pvcNames: ["old-orphan"],
    });
  });

  test("keeps any template version still referenced by a workspace", () => {
    const value = inventory();
    value.workspaces[0]!.latest_build.template_version_id = "old-version";
    expect(planPrune(value).templateVersionIds).toEqual([]);
  });

  test("does not infer Factory ownership from an automation username", () => {
    const value = inventory();
    value.workspaces.push(
      workspace("wrong-owner-id", "factory-verification", "attacker-id", "verification-fedcba9876", "verification", "failed", 30),
      { ...workspace("wrong-template", "factory-verification", "verification-owner", "verification-fedcba9875", "verification", "failed", 30), template_id: "foreign-template" },
      { ...workspace("wrong-kind", "factory-verification", "verification-owner", "verification-fedcba9874", "developer", "failed", 30) },
      { ...workspace("wrong-namespace", "factory-verification", "verification-owner", "verification-fedcba9873", "verification", "failed", 30), parameters: { ...workspace("x", "x", "x", "x", "verification", "failed", 30).parameters, workspace_namespace: "shared" } },
    );

    expect(planPrune(value).workspaceIds).toEqual(["automation-old"]);
  });

  test("includes labeled custom-repository images in rollback pruning", () => {
    const value = inventory();
    value.currentImage = "registry.example/team/factory:dev-current";
    value.images = [
      { id: "current", refs: [value.currentImage], createdAt: daysAgo(1), factoryOwned: true },
      { id: "one", refs: ["registry.example/team/factory:dev-one"], createdAt: daysAgo(8), factoryOwned: true },
      { id: "two", refs: ["registry.example/team/factory:dev-two"], createdAt: daysAgo(9), factoryOwned: true },
      { id: "old", refs: ["registry.example/team/factory:dev-old"], createdAt: daysAgo(30), factoryOwned: true },
      { id: "foreign", refs: ["registry.example/team/other:old"], createdAt: daysAgo(30), factoryOwned: false },
    ];

    expect(planPrune(value).imageIds).toEqual(["old"]);
  });

  test("dry-run inventories resources without sending any mutation", async () => {
    const commands: string[][] = [];
    const requests: Array<{ path: string; method: string }> = [];
    const exec: Exec = async (argv) => {
      commands.push([...argv]);
      const command = argv.join(" ");
      if (command === "kubectl config current-context") return { exitCode: 0, stdout: "orbstack\n", stderr: "" };
      if (command.startsWith("kubectl get namespace")) return { exitCode: 0, stdout: '{"metadata":{"labels":{"factory.application/local-stack":"true"}}}', stderr: "" };
      if (command.includes("coder-token")) return { exitCode: 0, stdout: "token", stderr: "" };
      if (command.includes("coder-verification-owner-id")) return { exitCode: 0, stdout: "verification-owner", stderr: "" };
      if (command.includes("coder-staging-owner-id")) return { exitCode: 0, stdout: "stage-owner", stderr: "" };
      if (command.startsWith("docker image ls dev.local")) return { exitCode: 0, stdout: "sha256:old\n", stderr: "" };
      if (command.startsWith("docker image ls --filter")) return { exitCode: 0, stdout: "", stderr: "" };
      if (command.startsWith("docker image inspect")) return { exitCode: 0, stdout: JSON.stringify([{ Id: "sha256:old", RepoTags: ["dev.local/agentic-software-factory-bff:old"], RepoDigests: [], Created: daysAgo(30), Config: { Labels: {} } }]), stderr: "" };
      if (command.startsWith("kubectl get deployment")) return { exitCode: 0, stdout: "dev.local/agentic-software-factory-bff:current", stderr: "" };
      if (command === "kubectl get pvc -n factory-workspaces -o json") return { exitCode: 0, stdout: '{"items":[]}', stderr: "" };
      if (command === "kubectl get pods -n factory-workspaces -o json") return { exitCode: 0, stdout: '{"items":[]}', stderr: "" };
      throw new Error(`unexpected command: ${command}`);
    };
    const request = async (_token: string, path: string, init?: RequestInit): Promise<unknown> => {
      requests.push({ path, method: init?.method ?? "GET" });
      if (path === "/api/v2/templates") return [{ id: "template", name: "agentic-software-factory", active_version_id: "active" }];
      if (path.startsWith("/api/v2/templates/template/versions")) return [{ id: "active", created_at: daysAgo(1) }];
      if (path === "/api/v2/workspaces?limit=1000&offset=0") return { count: 0, workspaces: [] };
      throw new Error(`unexpected request: ${path}`);
    };

    expect(await prune(true, exec, request)).toBe(0);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
    expect(commands.some((argv) => argv.includes("delete") || argv.includes("rm"))).toBe(false);
    expect(commands).toContainEqual(["docker", "image", "ls", "--filter", "label=factory.application/dev-image=true", "--no-trunc", "--format", "{{.ID}}"]);
  });

  test("paginates the complete workspace inventory before planning any deletion", async () => {
    const mutations: string[] = [];
    const requests: string[] = [];
    const commands: string[][] = [];
    const exec = maintenanceExec(commands);
    const request = async (_token: string, path: string, init?: RequestInit): Promise<unknown> => {
      requests.push(path);
      if (init?.method && init.method !== "GET") mutations.push(path);
      if (path === "/api/v2/templates") return [{ id: "template", name: "agentic-software-factory", active_version_id: "active" }];
      if (path.startsWith("/api/v2/templates/template/versions")) return [
        { id: "active", created_at: daysAgo(1) },
        { id: "old-version", created_at: daysAgo(30) },
      ];
      if (path === "/api/v2/workspaces?limit=1000&offset=0") return { count: 1001, workspaces: Array.from({ length: 1000 }, (_, index) => workspace(`workspace-${index}`, "alice", `alice-${index}`, `work-${index}`, "developer", "stopped", 30)) };
      if (path === "/api/v2/workspaces?limit=1000&offset=1000") return { count: 1001, workspaces: [workspace("last-workspace", "alice", "last-owner", "last", "developer", "stopped", 30, "old-version")] };
      throw new Error(`unexpected request: ${path}`);
    };

    expect(await prune(false, exec, request)).toBe(0);
    expect(requests).toContain("/api/v2/workspaces?limit=1000&offset=1000");
    expect(mutations).toEqual([]);
    expect(commands.some((argv) => argv.includes("delete") || argv.includes("rm"))).toBe(false);
  });

  test("fails closed when Coder count says the workspace inventory is incomplete", async () => {
    const mutations: string[] = [];
    const request = async (_token: string, path: string, init?: RequestInit): Promise<unknown> => {
      if (init?.method && init.method !== "GET") mutations.push(path);
      if (path === "/api/v2/templates") return [{ id: "template", name: "agentic-software-factory", active_version_id: "active" }];
      if (path.startsWith("/api/v2/templates/template/versions")) return [{ id: "active", created_at: daysAgo(1) }];
      if (path === "/api/v2/workspaces?limit=1000&offset=0") return { count: 1001, workspaces: [] };
      throw new Error(`unexpected request: ${path}`);
    };

    expect(await prune(false, maintenanceExec(), request)).toBe(1);
    expect(mutations).toEqual([]);
  });

  test("fails closed when an automation workspace cannot be attested", async () => {
    const mutations: string[] = [];
    const request = async (_token: string, path: string, init?: RequestInit): Promise<unknown> => {
      if (init?.method && init.method !== "GET") mutations.push(path);
      if (path === "/api/v2/templates") return [{ id: "template", name: "agentic-software-factory", active_version_id: "active" }];
      if (path.startsWith("/api/v2/templates/template/versions")) return [{ id: "active", created_at: daysAgo(1) }];
      if (path === "/api/v2/workspaces?limit=1000&offset=0") return { count: 1, workspaces: [workspace("automation", "factory-verification", "verification-owner", "verification-abcdef0123", "verification", "failed", 30)] };
      if (path === "/api/v2/workspacebuilds/build-automation/parameters") throw new Error("parameters unavailable");
      throw new Error(`unexpected request: ${path}`);
    };

    expect(await prune(false, maintenanceExec(), request)).toBe(1);
    expect(mutations).toEqual([]);
  });
});

function maintenanceExec(commands: string[][] = []): Exec {
  return async (argv) => {
    commands.push([...argv]);
    const command = argv.join(" ");
    if (command === "kubectl config current-context") return { exitCode: 0, stdout: "orbstack\n", stderr: "" };
    if (command.startsWith("kubectl get namespace")) return { exitCode: 0, stdout: '{"metadata":{"labels":{"factory.application/local-stack":"true"}}}', stderr: "" };
    if (command.includes("coder-token")) return { exitCode: 0, stdout: "token", stderr: "" };
    if (command.includes("coder-verification-owner-id")) return { exitCode: 0, stdout: "verification-owner", stderr: "" };
    if (command.includes("coder-staging-owner-id")) return { exitCode: 0, stdout: "stage-owner", stderr: "" };
    if (command.startsWith("docker image ls") || command.startsWith("kubectl get deployment")) return { exitCode: 0, stdout: "", stderr: "" };
    if (command === "kubectl get pvc -n factory-workspaces -o json" || command === "kubectl get pods -n factory-workspaces -o json") return { exitCode: 0, stdout: '{"items":[]}', stderr: "" };
    throw new Error(`unexpected command: ${command}`);
  };
}

describe("local reset guard", () => {
  const ownedLocalExec = (seen: string[][]): Exec => async (argv) => {
    seen.push([...argv]);
    if (argv.join(" ") === "kubectl config current-context") return { exitCode: 0, stdout: "orbstack\n", stderr: "" };
    if (argv.includes("namespace")) return { exitCode: 0, stdout: '{"metadata":{"annotations":{"factory.application/local-stack-owner":"created-by-factory-up-v1"},"labels":{"factory.application/local-stack":"true"}}}', stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  test("dry-run validates OrbStack and creation markers without deleting namespaces", async () => {
    const seen: string[][] = [];
    expect(await resetData(true, true, false, ownedLocalExec(seen))).toBe(0);
    expect(seen.some((argv) => argv.includes("delete"))).toBe(false);
  });

  test("explicit reset deletes only the three tool-created local namespaces", async () => {
    const seen: string[][] = [];
    expect(await resetData(true, false, true, ownedLocalExec(seen))).toBe(0);
    expect(seen.at(-1)).toEqual(["kubectl", "delete", "namespace", "coder", "factory-platform", "factory-workspaces", "--wait=true"]);
  });

  test("refuses legacy labels because labels can be applied to pre-existing namespaces", async () => {
    const seen: string[][] = [];
    const exec: Exec = async (argv) => {
      seen.push([...argv]);
      if (argv.join(" ") === "kubectl config current-context") return { exitCode: 0, stdout: "orbstack\n", stderr: "" };
      return { exitCode: 0, stdout: '{"metadata":{"labels":{"factory.application/local-stack":"true"}}}', stderr: "" };
    };
    expect(await resetData(true, true, false, exec)).toBe(1);
    expect(seen.some((argv) => argv.includes("delete"))).toBe(false);
  });

  test("requires the data acknowledgement even when called directly", async () => {
    const seen: string[][] = [];
    expect(await resetData(false, true, true, ownedLocalExec(seen))).toBe(1);
    expect(seen).toEqual([]);
  });

  test("direct maintenance CLI rejects reset without --data", async () => {
    const result = Bun.spawnSync(["bun", new URL("local-maintenance.ts", import.meta.url).pathname, "reset", "--dry-run"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("reset --data");
  });

  test("refuses any non-OrbStack context before reading or deleting data", async () => {
    const seen: string[][] = [];
    const exec: Exec = async (argv) => { seen.push([...argv]); return { exitCode: 0, stdout: "production\n", stderr: "" }; };
    expect(await resetData(true, true, false, exec)).toBe(1);
    expect(seen).toEqual([["kubectl", "config", "current-context"]]);
  });
});
