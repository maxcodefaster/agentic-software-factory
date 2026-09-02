/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { describe, expect, test } from "bun:test";

describe("native Dev Container contract", () => {
  test("pins the native developer environment and exposes interactive tools", async () => {
    const config = await Bun.file(".devcontainer/devcontainer.json").json();
    const dockerfile = await Bun.file(".devcontainer/Dockerfile").text();

    expect(config.build).toEqual({
      dockerfile: "Dockerfile",
      context: "..",
      target: "developer",
      args: { DEVCONTAINER_STAGE: "developer" },
    });
    expect(config.features).toBeUndefined();
    expect(config.runArgs).toBeUndefined();
    expect(config.containerEnv.PGDATA).toBe(
      "$" +
        "{localEnv:FACTORY_STATE_DIR:/home/vscode/.local/share/devcontainer}/postgres",
    );
    expect(config.postCreateCommand).toEqual(["bun", "run", "setup"]);
    expect(config.postStartCommand).toEqual(["sh", ".devcontainer/start.sh"]);
    expect(config.containerEnv.CODER_URL).toBeUndefined();
    expect(config.containerEnv).not.toHaveProperty(
      "FACTORY_AUTH_ALLOWED_HOST_SUFFIX",
    );
    expect(dockerfile).toContain(
      "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0",
    );
    expect(dockerfile).toContain("BUN_VERSION=1.3.14");
    expect(dockerfile).toContain("PROCESS_COMPOSE_VERSION=1.122.0");
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/usr/local/bin/agentic-software-factory-entrypoint"]',
    );
    expect(dockerfile).not.toMatch(/sudo|NOPASSWD/);
    expect(
      config.customizations.vscode.extensions.every((extension: string) =>
        extension.includes("@"),
      ),
    ).toBe(true);
    expect(config.customizations.coder).toMatchObject({
      autoStart: true,
      name: "agentic-software-factory-example",
      apps: [
        {
          slug: "application",
          url: "http://127.0.0.1:4173",
          share: "owner",
          healthCheck: {
            url: "http://127.0.0.1:4173/api/health/ready",
          },
        },
      ],
    });
    expect(
      config.customizations.vscode.settings["task.allowAutomaticTasks"],
    ).toBe("on");
    expect(await Bun.file(".vscode/settings.json").json()).toMatchObject({
      "task.allowAutomaticTasks": "on",
      "terminal.integrated.cwd": "$" + "{workspaceFolder}",
    });
    expect(await Bun.file(".vscode/tasks.json").exists()).toBe(false);
    const system = await Bun.file(".factory/system.yaml").text();
    expect(system).toContain(
      "attach: process-compose --address 127.0.0.1 --port 8080 attach",
    );
    expect(system).toContain(
      "restart: process-compose --address 127.0.0.1 --port 8080 process restart application",
    );
  });

  test("has an authenticated verification app without a shell, editor, or command app", async () => {
    const verification = await Bun.file(
      ".devcontainer/verification/devcontainer.json",
    ).json();
    const coder = verification.customizations.coder;

    expect(verification.build).toEqual({
      dockerfile: "Dockerfile",
      context: "../..",
      target: "verification",
    });
    expect(verification.runArgs).toBeUndefined();
    expect(verification.workspaceMount).toBe(
      "source=$" +
        "{localWorkspaceFolder},target=/workspaces/project,type=bind,readonly",
    );
    expect(verification.workspaceFolder).toBe("/workspaces/project");
    expect(verification.mounts).toBeUndefined();
    expect(verification.forwardPorts).toBeUndefined();
    expect(verification.portsAttributes).toBeUndefined();
    expect(verification.otherPortsAttributes).toBeUndefined();
    expect(verification.containerEnv.BETTER_AUTH_ENABLE_SIGN_UP).toBe("false");
    expect(verification.containerEnv.FACTORY_VERIFICATION_MODE).toBe("fixture");
    expect(verification.containerEnv.PROCESS_COMPOSE_CONFIG).toBe(
      "/opt/factory-verification/project/.devcontainer/process-compose.yaml",
    );
    expect(verification.containerEnv.PROCESS_COMPOSE_LOG_DIRECTORY).toBe(
      "$" +
        "{localEnv:FACTORY_STATE_DIR:/home/vscode/.local/state/devcontainer-verification}/process-compose",
    );
    expect(verification.containerEnv.VITE_ENTRY).toBe(
      "/opt/factory-verification/node_modules/vite/bin/vite.js",
    );
    expect(verification.containerEnv.VITE_CONFIG).toBe(
      "/opt/factory-verification/project/vite.config.ts",
    );
    expect(verification.postCreateCommand).toBeUndefined();
    expect(
      await Bun.file(".devcontainer/prepare-verification.sh").exists(),
    ).toBe(false);
    const verificationDockerfile = await Bun.file(
      ".devcontainer/verification/Dockerfile",
    ).text();
    const dockerignore = await Bun.file(".dockerignore").text();
    const verificationStage = verificationDockerfile.slice(
      verificationDockerfile.indexOf("FROM base AS verification"),
    );
    expect(verificationDockerfile).toContain("FROM base AS verification");
    expect(verificationDockerfile).toContain(
      "RUN bun install --frozen-lockfile",
    );
    expect(verificationDockerfile).not.toContain(
      "/workspaces/agentic-software-factory-example",
    );
    expect(verificationStage.match(/^COPY .*$/gm)).toEqual([
      "COPY --chown=vscode:vscode package.json bun.lock ./",
      "COPY . /opt/factory-verification/project",
    ]);
    expect(dockerignore).toContain("**/.env");
    expect(dockerignore).toContain("**/.env.*");
    expect(dockerignore).toContain("!**/.env.example");
    expect(verification.postStartCommand).toEqual([
      "sh",
      "/opt/factory-verification/project/.devcontainer/start-verification.sh",
    ]);
    expect(coder.displayApps).toBeUndefined();
    expect(coder.apps).toEqual([
      {
        slug: "application",
        displayName: "Agentic Software Factory Example",
        url: "http://127.0.0.1:4173",
        openIn: "tab",
        share: "authenticated",
        healthCheck: {
          url: "http://127.0.0.1:4173/api/health/ready",
          interval: 5,
          threshold: 12,
        },
      },
    ]);
    expect(JSON.stringify(coder.apps)).not.toMatch(
      /code-server|terminal|command|process-manager/i,
    );
    expect(JSON.stringify(verification)).not.toMatch(
      /FACTORY_VERIFICATION_ROOT|prepare-verification|\.env/,
    );
  });

  test("orders PostgreSQL, migration, and the HMR application", async () => {
    const config = Bun.YAML.parse(
      await Bun.file(".devcontainer/process-compose.yaml").text(),
    ) as ProcessComposeConfig;

    expect(Object.keys(config.processes)).toEqual([
      "postgres",
      "migrate",
      "application",
    ]);
    expect(config.processes.postgres.readiness_probe.exec.command).toContain(
      "pg_isready",
    );
    expect(config.processes.migrate.command).toBe(
      "sh .devcontainer/migrate.sh",
    );
    expect(config.processes.migrate.depends_on.postgres.condition).toBe(
      "process_healthy",
    );
    expect(config.processes.application.depends_on.migrate.condition).toBe(
      "process_completed_successfully",
    );
    expect(config.processes.application.command).toBe(
      "exec bun --no-env-file $" +
        "{VITE_ENTRY:-node_modules/vite/bin/vite.js} --config $" +
        "{VITE_CONFIG:-vite.config.ts} --configLoader native --host 0.0.0.0 --port 4173",
    );
    expect(config.processes.application.readiness_probe.http_get).toMatchObject(
      {
        port: "4173",
        path: "/api/health/ready",
        status_code: 200,
      },
    );
    expect(config.processes.application.command).not.toContain(
      "bun --env-file",
    );
  });

  test("derives Coder hosts from CODER_URL and keeps local cookies insecure", async () => {
    const previous = process.env.CODER_URL;
    delete process.env.CODER_URL;
    try {
      const { default: local } = await import(
        `../vite.config.ts?local-host=${Date.now()}`
      );
      expect(local.server?.allowedHosts).toEqual([]);

      process.env.CODER_URL = "https://coder.example.test";
      const { default: coder } = await import(
        `../vite.config.ts?coder-host=${Date.now()}`
      );
      expect(coder.server?.allowedHosts).toEqual([".coder.example.test"]);
    } finally {
      if (previous === undefined) delete process.env.CODER_URL;
      else process.env.CODER_URL = previous;
    }
  }, 30_000);

  test("uses graceful process and PostgreSQL shutdown", async () => {
    const start = await Bun.file(".devcontainer/start.sh").text();
    const verificationStart = await Bun.file(
      ".devcontainer/start-verification.sh",
    ).text();
    const entrypoint = await Bun.file(
      ".devcontainer/container-entrypoint.sh",
    ).text();
    const processConfig = await Bun.file(
      ".devcontainer/process-compose.yaml",
    ).text();

    expect(start).not.toContain("sudo");
    expect(start).toContain('chmod 0700 "$PGDATA"');
    expect(verificationStart).toContain('chmod 0700 "$PGDATA"');
    expect(verificationStart).toContain("--read-only");
    expect(verificationStart).toContain("--disable-dotenv");
    expect(verificationStart).toContain("BETTER_AUTH_ENABLE_SIGN_UP=false");
    expect(verificationStart).not.toContain("bun run setup");
    expect(entrypoint).toContain("--ordered-shutdown down");
    expect(entrypoint).toContain("pg_ctl --pgdata");
    expect(processConfig).toContain(
      'command: pg_ctl --pgdata="$PGDATA" stop --mode=fast --wait',
    );
    expect(processConfig).toContain(
      "command: exec bun --no-env-file $" +
        "{VITE_ENTRY:-node_modules/vite/bin/vite.js} --config $" +
        "{VITE_CONFIG:-vite.config.ts}",
    );
  });

  test("runs setup after creating the developer container", async () => {
    const config = await Bun.file(".devcontainer/devcontainer.json").json();
    expect(config.postCreateCommand).toEqual(["bun", "run", "setup"]);
  });

  test("removes rejected runtime files", async () => {
    expect(await Bun.file(".factory/application.yaml").exists()).toBe(false);
    expect(await Bun.file(".factory/start-preview.sh").exists()).toBe(false);
    expect(await Bun.file(".coder/main.tf").exists()).toBe(false);
    expect(await Bun.file("scripts/init-template.ts").exists()).toBe(false);
    expect(await Bun.file(".factory/release.yaml").exists()).toBe(false);
    expect(await Bun.file("compose.yaml").exists()).toBe(false);
    expect(await Bun.file("Dockerfile").exists()).toBe(false);
  });
});

interface ProcessComposeConfig {
  log_location: string;
  processes: {
    postgres: { readiness_probe: { exec: { command: string } } };
    migrate: {
      command: string;
      depends_on: { postgres: { condition: string } };
    };
    application: {
      command: string;
      depends_on: { migrate: { condition: string } };
      readiness_probe: {
        http_get: { port: string; path: string; status_code: number };
      };
    };
  };
}
