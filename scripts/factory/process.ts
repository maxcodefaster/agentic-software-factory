// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { fileURLToPath } from "node:url";
import { reconcileCoder } from "./reconcile-coder";

export type Command = {
  readonly component: string;
  readonly argv: readonly string[];
  readonly operation?: "reconcile-coder";
};

export type CommandResult = {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

export type Runner = (command: Command) => Promise<CommandResult>;

const root = fileURLToPath(new URL("../../", import.meta.url));

export const defaultRunner: Runner = async ({ argv, operation }) => {
  if (operation === "reconcile-coder") {
    try {
      await reconcileCoder();
      return { exitCode: 0 };
    } catch (error) {
      return { exitCode: 1, stderr: (error as Error).message };
    }
  }
  const child = Bun.spawn([...argv], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};
