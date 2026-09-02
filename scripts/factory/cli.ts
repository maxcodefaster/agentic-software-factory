// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { checkCommands, deployCommands, e2eCommands, parseCommand, pruneCommands, statusCommands, upCommands } from "./commands";
import { defaultRunner, type Command, type Runner } from "./process";

async function runCommands(commands: readonly Command[], runner: Runner): Promise<boolean> {
  for (const command of commands) {
    const result = await runner(command);
    console.log(`${command.component}: ${result.exitCode === 0 ? "ready" : command.optional ? "unavailable (optional)" : "failed"}`);
    if (result.stdout?.trim()) console.log(result.stdout.trim());
    if (result.exitCode && !command.optional) {
      if (result.stderr?.trim()) console.error(result.stderr.trim());
      return false;
    }
  }
  return true;
}

export async function run(args: readonly string[], runner: Runner = defaultRunner): Promise<number> {
  let parsed: ReturnType<typeof parseCommand>;
  try {
    parsed = parseCommand(args);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  const dryRun = parsed.args.includes("--dry-run");
  const commands =
    parsed.command === "up"
      ? upCommands(parsed.args[0]!)
      : parsed.command === "down"
        ? [{ component: "stack", argv: ["./deploy/local/down.sh", ...(dryRun ? ["--dry-run"] : [])] }]
        : parsed.command === "deploy"
          ? deployCommands(dryRun)
          : parsed.command === "prune"
            ? pruneCommands(dryRun)
            : parsed.command === "reset"
              ? [{ component: "reset", argv: ["bun", "scripts/local-maintenance.ts", "reset", ...parsed.args] }]
              : parsed.command === "status"
                ? statusCommands
                : parsed.command === "check"
                  ? checkCommands
                  : null;
  if (commands) return (await runCommands(commands, runner)) ? 0 : 1;
  if (!(await runCommands(statusCommands, runner))) {
    console.error("e2e preflight failed");
    return 1;
  }
  return (await runCommands(e2eCommands, runner)) ? 0 : 1;
}
