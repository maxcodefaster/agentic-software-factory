// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { createInterface } from "node:readline/promises";
import { createHash } from "node:crypto";

const minimumAgeMs = 7 * 24 * 60 * 60 * 1_000;
const rollbackCount = 2;
const workspacePageSize = 1_000;
const stackOwnerAnnotation = "factory.application/local-stack-owner";
const stackOwnerValue = "created-by-factory-up-v1";

type Image = { id: string; refs: string[]; createdAt: string; factoryOwned: boolean };
type TemplateVersion = { id: string; created_at: string; archived?: boolean; job?: { status?: string } };
type Workspace = {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  template_id: string;
  template_name: string;
  updated_at?: string;
  last_used_at: string;
  latest_build: { id?: string; status: string; transition: string; template_version_id?: string };
  parameters: Record<string, string>;
};
type Pvc = { name: string; workspaceId: string; createdAt: string; mounted: boolean };
type AutomationKind = "verification" | "staging";
type AutomationOwner = { id: string; name: string };

export type PruneInventory = {
  now: Date;
  currentImage: string;
  images: Image[];
  templateId: string;
  templateName: string;
  activeTemplateVersionId: string;
  templateVersions: TemplateVersion[];
  automationOwners: Record<AutomationKind, AutomationOwner>;
  workspaces: Workspace[];
  pvcs: Pvc[];
};

export type PrunePlan = {
  imageIds: string[];
  templateVersionIds: string[];
  workspaceIds: string[];
  pvcNames: string[];
};

const age = (now: Date, value: string) => now.getTime() - new Date(value).getTime();
const newest = <T>(values: T[], date: (value: T) => string) =>
  [...values].sort((left, right) => new Date(date(right)).getTime() - new Date(date(left)).getTime());

export function planPrune(inventory: PruneInventory): PrunePlan {
  const factoryImages = newest(
    inventory.images.filter((image) => image.factoryOwned),
    (image) => image.createdAt,
  );
  const currentImage = factoryImages.find((image) => image.refs.includes(inventory.currentImage));
  const protectedImages = new Set(currentImage ? [currentImage.id] : []);
  for (const image of factoryImages.filter((image) => image.id !== currentImage?.id).slice(0, rollbackCount)) protectedImages.add(image.id);

  const usedVersions = new Set(
    inventory.workspaces.map((workspace) => workspace.latest_build.template_version_id).filter((id): id is string => Boolean(id)),
  );
  const protectedVersions = new Set([inventory.activeTemplateVersionId]);
  for (const version of
    newest(inventory.templateVersions, (version) => version.created_at)
      .filter((version) => version.id !== inventory.activeTemplateVersionId)
      .slice(0, rollbackCount)) protectedVersions.add(version.id);
  for (const id of usedVersions) protectedVersions.add(id);

  const workspaceIds = new Set(inventory.workspaces.map((workspace) => workspace.id));
  return {
    imageIds: factoryImages
      .filter((image) => !protectedImages.has(image.id) && age(inventory.now, image.createdAt) >= minimumAgeMs)
      .map((image) => image.id),
    templateVersionIds: inventory.templateVersions
      .filter((version) => !version.archived && !protectedVersions.has(version.id) && age(inventory.now, version.created_at) >= minimumAgeMs)
      .map((version) => version.id),
    workspaceIds: inventory.workspaces
      .filter((workspace) => isOwnedAutomationWorkspace(workspace, inventory))
      .filter((workspace) => ["stopped", "failed", "canceled"].includes(workspace.latest_build.status))
      .filter((workspace) => age(inventory.now, workspace.last_used_at || workspace.updated_at || "") >= minimumAgeMs)
      .map((workspace) => workspace.id),
    pvcNames: inventory.pvcs
      .filter((pvc) => pvc.workspaceId && !workspaceIds.has(pvc.workspaceId) && !pvc.mounted)
      .filter((pvc) => age(inventory.now, pvc.createdAt) >= minimumAgeMs)
      .map((pvc) => pvc.name),
  };
}

function isOwnedAutomationWorkspace(workspace: Workspace, inventory: PruneInventory): boolean {
  const kind = workspace.parameters.workspace_kind;
  if (kind !== "verification" && kind !== "staging") return false;
  const owner = inventory.automationOwners[kind];
  if (workspace.owner_id !== owner.id || workspace.owner_name !== owner.name) return false;
  if (workspace.template_id !== inventory.templateId || workspace.template_name !== inventory.templateName) return false;
  if (workspace.parameters.workspace_namespace !== "factory-workspaces" || workspace.parameters.tenant_id !== "factory") return false;
  if (!/^https:\/\/forgejo\.factory-platform\.svc\.cluster\.local:3000\/factory\/[A-Za-z0-9._-]+\.git$/.test(workspace.parameters.repository_url ?? "")) return false;
  if (!/^[0-9a-f]{40}$/.test(workspace.parameters.repository_ref ?? "")) return false;
  if (kind === "staging") return workspace.name === `staging-${createHash("sha256").update(workspace.parameters.repository_url).digest("hex").slice(0, 10)}`;
  return /^verification-[0-9a-f]{10}$/.test(workspace.name);
}

export type CommandResult = { exitCode: number; stdout: string; stderr: string };
export type Exec = (argv: readonly string[]) => Promise<CommandResult>;

export const defaultExec: Exec = async (argv) => {
  const child = Bun.spawn([...argv], { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

async function required(exec: Exec, argv: readonly string[]): Promise<string> {
  const result = await exec(argv);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `${argv.join(" ")} failed`);
  return result.stdout.trim();
}

async function assertLocalStack(exec: Exec): Promise<void> {
  const context = await required(exec, ["kubectl", "config", "current-context"]);
  if (context !== "orbstack") throw new Error("Refusing local maintenance outside the orbstack Kubernetes context.");
  for (const namespace of ["coder", "factory-platform", "factory-workspaces"]) {
    const output = await required(exec, ["kubectl", "get", "namespace", namespace, "-o", "json"]);
    const label = (JSON.parse(output) as { metadata?: { labels?: Record<string, string> } }).metadata?.labels?.["factory.application/local-stack"];
    if (label !== "true") throw new Error(`Refusing maintenance because namespace ${namespace} is not labeled as a local Factory stack.`);
  }
}

async function assertResetOwnership(exec: Exec): Promise<void> {
  for (const namespace of ["coder", "factory-platform", "factory-workspaces"]) {
    const output = await required(exec, ["kubectl", "get", "namespace", namespace, "-o", "json"]);
    const metadata = (JSON.parse(output) as { metadata?: { annotations?: Record<string, string> } }).metadata;
    if (metadata?.annotations?.[stackOwnerAnnotation] !== stackOwnerValue) {
      throw new Error(`Refusing reset because namespace ${namespace} lacks the Factory create-time ownership marker.`);
    }
  }
}

async function coderRequest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`http://coder.localhost${path}`, {
    ...init,
    headers: { "Coder-Session-Token": token, "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`Coder ${init?.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

type CoderRequest = (token: string, path: string, init?: RequestInit) => Promise<unknown>;

async function allWorkspaces(token: string, request: CoderRequest): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  const ids = new Set<string>();
  let expectedCount: number | undefined;
  while (expectedCount === undefined || workspaces.length < expectedCount) {
    const path = `/api/v2/workspaces?limit=${workspacePageSize}&offset=${workspaces.length}`;
    const envelope = await request(token, path) as { count?: unknown; workspaces?: unknown };
    if (!Number.isSafeInteger(envelope.count) || (envelope.count as number) < 0 || !Array.isArray(envelope.workspaces)) {
      throw new Error("Coder returned an invalid workspace inventory envelope.");
    }
    if (expectedCount === undefined) expectedCount = envelope.count as number;
    if (envelope.count !== expectedCount) throw new Error("Coder workspace count changed during pagination; refusing maintenance.");
    if (envelope.workspaces.length > workspacePageSize || workspaces.length + envelope.workspaces.length > expectedCount) {
      throw new Error("Coder returned an inconsistent workspace page; refusing maintenance.");
    }
    if (envelope.workspaces.length === 0 && workspaces.length < expectedCount) {
      throw new Error(`Coder workspace inventory is incomplete: received ${workspaces.length} of ${expectedCount}.`);
    }
    for (const workspace of envelope.workspaces as Workspace[]) {
      if (!workspace?.id || ids.has(workspace.id)) throw new Error("Coder workspace inventory contains a missing or duplicate ID.");
      ids.add(workspace.id);
      workspaces.push({ ...workspace, parameters: {} });
    }
  }
  if (workspaces.length !== expectedCount) throw new Error(`Coder workspace inventory is incomplete: received ${workspaces.length} of ${expectedCount}.`);
  return workspaces;
}

async function allTemplateVersions(token: string, templateId: string, request: CoderRequest): Promise<TemplateVersion[]> {
  const versions: TemplateVersion[] = [];
  for (let offset = 0; ; offset += workspacePageSize) {
    const page = await request(token, `/api/v2/templates/${templateId}/versions?include_archived=true&limit=${workspacePageSize}&offset=${offset}`) as unknown;
    if (!Array.isArray(page) || page.length > workspacePageSize) throw new Error("Coder returned an invalid template version page.");
    versions.push(...page as TemplateVersion[]);
    if (page.length < workspacePageSize) return versions;
  }
}

async function inventory(exec: Exec, request: CoderRequest): Promise<{ value: PruneInventory; token: string }> {
  const token = await required(exec, ["sh", "-ceu", "kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-token}' | base64 -d"]);
  const templates = await request(token, "/api/v2/templates") as Array<{ id: string; name: string; active_version_id: string }>;
  if (!Array.isArray(templates)) throw new Error("Coder returned an invalid template inventory.");
  const matches = templates.filter((candidate) => candidate.name === "agentic-software-factory");
  if (matches.length !== 1 || !matches[0]?.id || !matches[0].active_version_id) {
    throw new Error(`Expected exactly one complete Coder template named agentic-software-factory; found ${matches.length}.`);
  }
  const template = matches[0];
  const versions = await allTemplateVersions(token, template.id, request);
  const workspaceItems = await allWorkspaces(token, request);
  const automationOwners: Record<AutomationKind, AutomationOwner> = {
    verification: {
      id: await required(exec, ["sh", "-ceu", "kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-verification-owner-id}' | base64 -d"]),
      name: process.env.FACTORY_CODER_VERIFICATION_OWNER ?? "factory-verification",
    },
    staging: {
      id: await required(exec, ["sh", "-ceu", "kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-staging-owner-id}' | base64 -d"]),
      name: process.env.FACTORY_CODER_STAGING_OWNER ?? "factory-stage",
    },
  };
  if (Object.values(automationOwners).some((owner) => !owner.id || !owner.name)) {
    throw new Error("Coder automation owner identity is incomplete; refusing maintenance.");
  }
  for (const workspace of workspaceItems) {
    const ownerMatches = Object.values(automationOwners).some((owner) => workspace.owner_id === owner.id && workspace.owner_name === owner.name);
    if (!ownerMatches || !workspace.latest_build.id) continue;
    const parameters = await request(token, `/api/v2/workspacebuilds/${encodeURIComponent(workspace.latest_build.id)}/parameters`) as Array<{ name: string; value: string }>;
    if (!Array.isArray(parameters)) throw new Error(`Coder returned invalid parameters for workspace ${workspace.id}.`);
    workspace.parameters = Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.value]));
  }

  const defaultImageIds = await required(exec, ["docker", "image", "ls", "dev.local/agentic-software-factory-bff", "--no-trunc", "--format", "{{.ID}}"]);
  const labeledImageIds = await required(exec, ["docker", "image", "ls", "--filter", "label=factory.application/dev-image=true", "--no-trunc", "--format", "{{.ID}}"]);
  const imageIds = [...new Set(`${defaultImageIds}\n${labeledImageIds}`.split("\n").filter(Boolean))];
  const images = imageIds.length === 0 ? [] : JSON.parse(await required(exec, ["docker", "image", "inspect", ...imageIds])) as Array<{ Id: string; RepoTags: string[] | null; RepoDigests: string[] | null; Created: string; Config?: { Labels?: Record<string, string> | null } }>;
  const currentImage = await required(exec, ["kubectl", "get", "deployment", "agentic-software-factory", "-n", "factory-platform", "-o", "jsonpath={.spec.template.spec.containers[?(@.name==\"bff\")].image}"]);
  const pvcList = JSON.parse(await required(exec, ["kubectl", "get", "pvc", "-n", "factory-workspaces", "-o", "json"])) as {
    items: Array<{ metadata: { name: string; creationTimestamp: string; labels?: Record<string, string> } }>;
  };
  const podList = JSON.parse(await required(exec, ["kubectl", "get", "pods", "-n", "factory-workspaces", "-o", "json"])) as {
    items: Array<{ spec?: { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } }>;
  };
  const mounted = new Set(podList.items.flatMap((pod) => pod.spec?.volumes?.map((volume) => volume.persistentVolumeClaim?.claimName).filter(Boolean) ?? []) as string[]);

  return {
    token,
    value: {
      now: new Date(),
      currentImage,
      images: images.map((image) => ({
        id: image.Id,
        refs: [...(image.RepoTags ?? []), ...(image.RepoDigests ?? [])],
        createdAt: image.Created,
        factoryOwned: image.Config?.Labels?.["factory.application/dev-image"] === "true"
          || (image.RepoTags ?? []).some((ref) => ref.startsWith("dev.local/agentic-software-factory-bff:")),
      })),
      templateId: template.id,
      templateName: template.name,
      activeTemplateVersionId: template.active_version_id,
      templateVersions: versions,
      automationOwners,
      workspaces: workspaceItems,
      pvcs: pvcList.items
        .filter((pvc) => pvc.metadata.labels?.["app.kubernetes.io/name"] === "agentic-software-factory-workspace"
          && pvc.metadata.labels?.["app.kubernetes.io/managed-by"] === "coder"
          && pvc.metadata.labels?.["factory.application/tenant"] === "factory"
          && Boolean(pvc.metadata.labels?.["coder.com/workspace-id"])
          && Boolean(pvc.metadata.labels?.["coder.com/user-id"]))
        .map((pvc) => ({
          name: pvc.metadata.name,
          workspaceId: pvc.metadata.labels?.["coder.com/workspace-id"] ?? "",
          createdAt: pvc.metadata.creationTimestamp,
          mounted: mounted.has(pvc.metadata.name),
        })),
    },
  };
}

export async function prune(dryRun: boolean, exec: Exec = defaultExec, request: CoderRequest = coderRequest): Promise<number> {
  try {
    await assertLocalStack(exec);
    const { value, token } = await inventory(exec, request);
    const plan = planPrune(value);
    const actions = [
      ...plan.workspaceIds.map((id) => ({ label: `delete automation workspace ${id}`, apply: () => request(token, `/api/v2/workspaces/${id}/builds`, { method: "POST", body: JSON.stringify({ transition: "delete" }) }) })),
      ...plan.templateVersionIds.map((id) => ({ label: `archive inactive template version ${id}`, apply: () => request(token, `/api/v2/templateversions/${id}/archive`, { method: "POST", body: "{}" }) })),
      ...plan.pvcNames.map((name) => ({ label: `delete orphaned PVC ${name}`, apply: () => required(exec, ["kubectl", "delete", "pvc", name, "-n", "factory-workspaces", "--wait=false"]) })),
      ...plan.imageIds.map((id) => ({ label: `remove old BFF image ${id}`, apply: () => required(exec, ["docker", "image", "rm", id]) })),
    ];
    if (actions.length === 0) console.log("Nothing is old enough and safe to prune.");
    let failures = 0;
    for (const action of actions) {
      console.log(`${dryRun ? "would " : ""}${action.label}`);
      if (!dryRun) {
        try { await action.apply(); } catch (error) { failures++; console.error((error as Error).message); }
      }
    }
    return failures === 0 ? 0 : 1;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

export async function resetData(data: boolean, dryRun: boolean, yes: boolean, exec: Exec = defaultExec): Promise<number> {
  try {
    if (!data) throw new Error("Reset requires the explicit --data acknowledgement.");
    await assertLocalStack(exec);
    await assertResetOwnership(exec);
    if (!dryRun && !yes) {
      if (!process.stdin.isTTY) throw new Error("Reset requires an interactive terminal or the explicit --yes flag.");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await prompt.question('Type "delete local factory data" to continue: ')).trim();
      prompt.close();
      if (answer !== "delete local factory data") throw new Error("Reset canceled.");
    }
    const command = ["kubectl", "delete", "namespace", "coder", "factory-platform", "factory-workspaces", "--wait=true"] as const;
    if (dryRun) {
      console.log(`would run: ${command.join(" ")}`);
      return 0;
    }
    await required(exec, command);
    console.log("Local Factory namespaces and their persisted data were deleted.");
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (import.meta.main) {
  const [command, ...args] = Bun.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  if (command === "prune" && args.every((arg) => arg === "--dry-run")) process.exitCode = await prune(dryRun);
  else if (command === "reset" && args.includes("--data") && args.every((arg) => arg === "--data" || arg === "--dry-run" || arg === "--yes")) process.exitCode = await resetData(true, dryRun, yes);
  else { console.error("usage: local-maintenance.ts <prune [--dry-run]|reset --data [--dry-run] [--yes]>"); process.exitCode = 2; }
}
