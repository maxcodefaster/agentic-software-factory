// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import type { Command } from "./process";

export const subcommands = ["up", "down", "deploy", "prune", "reset", "status", "check", "e2e"] as const;
export type Subcommand = (typeof subcommands)[number];

const shell = (component: string, script: string): Command => ({ component, argv: ["sh", "-ceu", script] });

export const statusCommands: readonly Command[] = [shell("context", 'context=$(kubectl config current-context); printf \'%s\\n\' "$context"; test "$context" = orbstack'), shell("deployments", "test \"$(kubectl get deployment agentic-software-factory forgejo -n factory-platform -o json | jq '[.items[] | select((.status.availableReplicas // 0) != (.spec.replicas // 0))] | length')\" = 0; kubectl get deployment coder -n coder -o json | jq -e '(.status.availableReplicas // 0) == (.spec.replicas // 0)' >/dev/null"), shell("databases", 'kubectl get cluster coder-postgres -n coder -o json | jq -e \'.status.conditions | any(.type == "Ready" and .status == "True")\' >/dev/null; kubectl get cluster factory-postgres -n factory-platform -o json | jq -e \'.status.conditions | any(.type == "Ready" and .status == "True")\' >/dev/null'), shell("certificates", 'kubectl get certificate factory-tls -n factory-platform -o json | jq -e \'.status.conditions | any(.type == "Ready" and .status == "True")\' >/dev/null'), shell("factory-health", "curl -fsS http://factory.localhost/healthz >/dev/null"), shell("factory-ready", "curl -fsS http://factory.localhost/readyz >/dev/null"), shell("coder", "curl -fsS http://coder.localhost/healthz >/dev/null"), shell("coder-api", "token=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-token}' | base64 -d); curl -fsS -H \"Coder-Session-Token: $token\" http://coder.localhost/api/v2/users/me >/dev/null"), shell("forgejo", "curl -fsS http://forgejo-factory.localhost/api/healthz >/dev/null"), shell("forgejo-api", "token=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.forgejo-token}' | base64 -d); curl -fsS -H \"Authorization: token $token\" http://forgejo-factory.localhost/api/v1/user >/dev/null")];

export const downCommands: readonly Command[] = [{ component: "stack", argv: ["./deploy/local/down.sh"] }];

export const deployCommands = (dryRun = false): readonly Command[] => [
  {
    component: "factory",
    argv: ["./deploy/local/deploy-factory.sh", ...(dryRun ? ["--dry-run"] : [])],
  },
];

export const pruneCommands = (dryRun = false): readonly Command[] => [
  {
    component: "maintenance",
    argv: ["bun", "scripts/local-maintenance.ts", "prune", ...(dryRun ? ["--dry-run"] : [])],
  },
];

export function upCommands(systemSource: string): readonly Command[] {
  const quotedSource = JSON.stringify(systemSource);
  const work = `${process.env.TMPDIR ?? "/tmp"}/factory-stack-${process.pid}`;
  const system = `${work}/system`;
  return [
    {
      component: "prerequisites",
      argv: ["./scripts/install-local-prerequisites.sh", "--apply"],
    },
    shell("source", `mkdir -p ${JSON.stringify(work)}; FACTORY_ALLOW_DIRTY_SOURCE=true ./scripts/prepare-local-system-source.sh ${quotedSource} ${JSON.stringify(system)}`),
    shell("manifests", 'for namespace in coder factory-platform factory-workspaces; do if kubectl get namespace "$namespace" >/dev/null 2>&1; then kubectl get namespace "$namespace" -o json | jq -e \'.metadata.labels["factory.application/local-stack"] == "true"\' >/dev/null || { printf \'Refusing to use pre-existing namespace without Factory local-stack identity: %s\\n\' "$namespace" >&2; exit 1; }; else kubectl create namespace "$namespace" --dry-run=client -o json | jq \'.metadata.labels["factory.application/local-stack"]="true" | .metadata.annotations["factory.application/local-stack-owner"]="created-by-factory-up-v1"\' | kubectl create -f -; fi; done; kubectl get secret coder-forgejo-external-auth -n coder >/dev/null 2>&1 || kubectl create secret generic coder-forgejo-external-auth -n coder --from-literal=client-id=bootstrap-pending --from-literal=client-secret=bootstrap-pending; payload=$(mktemp); trap \'rm -f "$payload"\' EXIT; kubectl create --dry-run=client --validate=false -f deploy/local/platform.yaml -o json | jq -s \'{apiVersion:"v1",kind:"List",items:[.[] | if .kind == "List" then .items[] else . end | select(.kind != "Namespace") | select(.kind != "Deployment" or .metadata.name != "agentic-software-factory")]}\' > "$payload"; kubectl apply -f deploy/local/coder-database.yaml; kubectl apply --server-side -f "$payload"; kubectl wait --for=condition=Ready cluster/coder-postgres -n coder --timeout=300s; kubectl wait --for=condition=Ready cluster/factory-postgres -n factory-platform --timeout=300s; kubectl wait --for=condition=Ready certificate/factory-tls -n factory-platform --timeout=180s'),
    shell("credentials", "bun scripts/local-secrets.ts; ./deploy/local/reconcile-secret-rollout.sh forgejo"),
    { component: "coder", argv: [], operation: "reconcile-coder" },
    shell("forgejo", `FACTORY_SYSTEM_SOURCE=${JSON.stringify(system)} FACTORY_SYSTEM_REPOSITORY=$(basename ${quotedSource}) ./deploy/local/bootstrap-forgejo.sh`),
    { component: "factory", argv: ["./deploy/local/deploy-factory.sh", "--full-stack"] },
    shell("coder-auth", '. deploy/local/versions.env; helm upgrade coder oci://ghcr.io/coder/chart/coder --version "$CODER_CHART_VERSION" -n coder -f deploy/local/coder-values.yaml --force-conflicts --wait --timeout 5m; ./deploy/local/reconcile-secret-rollout.sh coder'),
    shell("template", `token=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-token}' | base64 -d); kubectl get secret factory-runtime -n factory-platform -o json | jq -e '{apiVersion:"v1",kind:"Secret",metadata:{name:"factory-forgejo-clone",namespace:"factory-workspaces"},type:"Opaque",data:{token:.data["forgejo-clone-token"]}}' | kubectl apply -f - >/dev/null; ref=$(git -C ${JSON.stringify(system)} rev-parse HEAD); repository=$(basename ${quotedSource}); origin=https://forgejo.factory-platform.svc.cluster.local:3000; url="$origin/factory/$repository.git"; digest=$(FACTORY_ROOT=. FACTORY_REPOSITORY_ORIGIN="$origin" FACTORY_DEFAULT_REPOSITORY_URL="$url" FACTORY_DEFAULT_REPOSITORY_REF="$ref" ./deploy/local/coder-template-identity.sh); message="factory-$digest-$ref"; active=$(curl -fsS -H "Coder-Session-Token: $token" http://coder.localhost/api/v2/templates | jq -r 'first(.[] | select(.name=="agentic-software-factory")) | .active_version_id // empty'); current=$([ -z "$active" ] || curl -fsS -H "Coder-Session-Token: $token" "http://coder.localhost/api/v2/templateversions/$active" | jq -r '.message // empty'); if [ "$current" != "$message" ]; then CODER_URL=http://127.0.0.1:8080 CODER_TOKEN="$token" FACTORY_REPOSITORY_ORIGIN="$origin" FACTORY_DEFAULT_REPOSITORY_URL="$url" FACTORY_DEFAULT_REPOSITORY_REF="$ref" FACTORY_TEMPLATE_MESSAGE="$message" ./scripts/push-coder-template.sh; else printf 'Coder template already matches %s.\n' "$message"; fi; ./deploy/local/repair-coder-template-acl.sh --apply`),
    shell("onboarding", `cookie=$(mktemp); response=$(mktemp); trap 'rm -f "$cookie" "$response"; rm -rf ${JSON.stringify(work)}' EXIT; password=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.bootstrap-user-password}' | base64 -d); curl -fsS -c "$cookie" -H 'Origin: http://factory.localhost' -H 'Content-Type: application/json' -d "$(jq -cn --arg email developer@example.test --arg password "$password" '{email:$email,password:$password}')" http://factory.localhost/sign-in/email >/dev/null; repository="factory/$(basename ${quotedSource})"; code=$(curl -sS -o "$response" -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' -d "$(jq -cn --arg repository "$repository" '{repository:$repository,team:"factory"}')" http://factory.localhost/api/v1/applications/onboarding/register); test "$code" = 202 -o "$code" = 409; for attempt in $(seq 1 180); do state=$(curl -fsS -b "$cookie" 'http://factory.localhost/api/v1/applications?team=factory' | jq -c --arg id "$repository" 'first(.applications[] | select(.id==$id)) // {}'); if printf '%s' "$state" | jq -e '.healthy == true and .status == "running" and (.apps | length > 0) and all(.apps[]; .health == "healthy")' >/dev/null; then printf 'System %s staging is healthy.\n' "$repository"; exit 0; fi; phase=$(printf '%s' "$state" | jq -r '.stagingPhase // "pending"'); [ "$phase" != failed ] || { printf 'Staging failed: %s\n' "$state" >&2; exit 1; }; sleep 5; done; printf 'Timed out waiting for System staging: %s\n' "$state" >&2; exit 1`),
  ];
}

export const checkCommands: readonly Command[] = [
  { component: "dependencies", argv: ["bun", "install", "--frozen-lockfile"] },
  { component: "dependencies", argv: ["bun", "audit"] },
  {
    component: "db",
    argv: ["bun", "run", "--filter=@agentic-software-factory/db", "typecheck"],
  },
  {
    component: "db",
    argv: ["bun", "run", "--filter=@agentic-software-factory/db", "test"],
  },
  {
    component: "bff",
    argv: ["bun", "run", "--filter=@agentic-software-factory/bff", "typecheck"],
  },
  { component: "api-generation", argv: ["bun", "run", "api:check"] },
  { component: "coder-pins", argv: ["bun", "scripts/check-coder-pins.ts"] },
  {
    component: "bff-auth",
    argv: ["bun", "test", "apps/bff/src/auth/auth.integration.test.ts"],
  },
  {
    component: "bff",
    argv: ["env", "AUTH_INTEGRATION_SKIP=true", "bun", "test", "apps/bff/src"],
  },
  {
    component: "bff",
    argv: ["bun", "run", "--filter=@agentic-software-factory/bff", "build"],
  },
  { component: "web", argv: ["bun", "run", "web:typecheck"] },
  { component: "web", argv: ["bun", "run", "web:test"] },
  { component: "web", argv: ["bun", "run", "web:build"] },
  {
    component: "api-contracts",
    argv: ["bun", "run", "--filter=@agentic-software-factory/api-contracts", "typecheck"],
  },
  {
    component: "design-system",
    argv: ["bun", "run", "--filter=@agentic-software-factory/design-system", "typecheck"],
  },
  {
    component: "design-system",
    argv: ["bun", "run", "--filter=@agentic-software-factory/design-system", "test"],
  },
  {
    component: "example",
    argv: ["bun", "install", "--frozen-lockfile", "--cwd", "example"],
  },
  { component: "example", argv: ["bun", "run", "--cwd", "example", "check"] },
  { component: "example", argv: ["bun", "audit", "--cwd", "example"] },
  {
    component: "terraform",
    argv: ["terraform", "-chdir=templates/agentic-software-factory", "fmt", "-check"],
  },
  {
    component: "terraform",
    argv: ["terraform", "-chdir=templates/agentic-software-factory", "init", "-backend=false"],
  },
  {
    component: "terraform",
    argv: ["terraform", "-chdir=templates/agentic-software-factory", "validate"],
  },
  {
    component: "terraform",
    argv: ["terraform", "-chdir=templates/agentic-software-factory", "test"],
  },
  {
    component: "contracts",
    argv: ["sh", "templates/agentic-software-factory/tests/devcontainer_contract_test.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "templates/agentic-software-factory/tests/publisher_archive_test.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/bootstrap-coder-verification-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/deploy-factory-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/down-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/install-local-prerequisites-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/oidc-bootstrap-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/prepare-local-system-source-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/recover-coder-owner-token-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/rollout-factory-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/local/tests/secret-rollout-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "scripts/production-coupling-check.sh"],
  },
  { component: "contracts", argv: ["sh", "deploy/production/validate.sh"] },
  {
    component: "contracts",
    argv: ["sh", "deploy/production/tests/backup-restore-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/production/tests/workspace-snapshot-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/production/tests/upgrade-contract.sh"],
  },
  {
    component: "contracts",
    argv: ["sh", "deploy/production/tests/validate-contract.sh"],
  },
  { component: "license", argv: ["bun", "run", "license:check"] },
  {
    component: "orchestration",
    argv: ["bun", "test", "scripts/factory.test.ts", "scripts/factory/reconcile-coder.test.ts", "scripts/local-maintenance.test.ts", "scripts/local-secrets.test.ts", "scripts/coder-template-identity.test.ts"],
  },
];

const e2eSystem = 'if [ -z "${FACTORY_SYSTEM_ID:-}" ]; then token=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath=\'{.data.forgejo-token}\' | base64 -d); FACTORY_SYSTEM_ID=$(curl -fsS -H "Authorization: token $token" http://forgejo-factory.localhost/api/v1/orgs/factory/repos | jq -er \'if length == 1 then .[0].full_name else error("Set FACTORY_SYSTEM_ID when Forgejo contains zero or multiple System repositories") end\'); export FACTORY_SYSTEM_ID; fi; ';

export const e2eCommands: readonly Command[] = [shell("smoke", e2eSystem + "SMOKE_AUTH_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-business-password}' | base64 -d) SMOKE_ADMIN_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.bootstrap-user-password}' | base64 -d) ./scripts/smoke.sh"), shell("personas", e2eSystem + "ADMIN_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.bootstrap-user-password}' | base64 -d) BUSINESS_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-business-password}' | base64 -d) DEVELOPER_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-developer-password}' | base64 -d) FORGEJO_TOKEN=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.forgejo-token}' | base64 -d) ./scripts/e2e-personas.sh"), shell("coder-sso", "BUSINESS_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-business-password}' | base64 -d) bun scripts/e2e-coder-sso.ts"), shell("lifecycle", e2eSystem + "ADMIN_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.bootstrap-user-password}' | base64 -d) BUSINESS_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-business-password}' | base64 -d) FORGEJO_TOKEN=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.forgejo-token}' | base64 -d) bun scripts/e2e-lifecycle.ts"), shell("browser", e2eSystem + "ADMIN_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.bootstrap-user-password}' | base64 -d) BUSINESS_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-business-password}' | base64 -d) DEVELOPER_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-developer-password}' | base64 -d) bun scripts/live-factory-audit.ts"), shell("applications", e2eSystem + "DEVELOPER_EMAIL=developer@example.test DEVELOPER_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.bootstrap-user-password}' | base64 -d) BUSINESS_PASSWORD=$(kubectl get secret factory-auth -n factory-platform -o jsonpath='{.data.e2e-business-password}' | base64 -d) bun scripts/live-application-audit.ts")];

export function parseCommand(args: readonly string[]): {
  command: Subcommand;
  args: readonly string[];
} {
  const [candidate, ...rest] = args;
  if (!subcommands.includes(candidate as Subcommand)) throw new Error(`Usage: bun scripts/factory.ts <${subcommands.join("|")}>`);
  if (["status", "check", "e2e"].includes(candidate ?? "") && rest.length) throw new Error(`${candidate} does not accept arguments`);
  if (candidate === "up" && rest.length > 1) throw new Error("up accepts at most one system repository path");
  if (["down", "deploy", "prune"].includes(candidate ?? "") && rest.some((arg) => arg !== "--dry-run")) throw new Error(`${candidate} accepts only --dry-run`);
  if (candidate === "reset" && (rest[0] !== "--data" || rest.slice(1).some((arg) => arg !== "--dry-run" && arg !== "--yes"))) throw new Error("reset requires --data and accepts optional --dry-run and --yes");
  return {
    command: candidate as Subcommand,
    args: candidate === "up" && rest.length === 0 ? ["./example"] : rest,
  };
}
