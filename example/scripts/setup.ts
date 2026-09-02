/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { chmod, rename } from "node:fs/promises";

const install = Bun.spawn(["bun", "install", "--frozen-lockfile"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
if ((await install.exited) !== 0) process.exit(1);

const envFile = Bun.file(".env");
if (!(await envFile.exists())) {
  const example = await Bun.file(".env.example").text();
  const secret = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const temporary = `.env.${process.pid}.tmp`;
  await Bun.write(
    temporary,
    example
      .replace("GENERATED_BY_BUN_RUN_SETUP", secret)
      .replace(
        "BETTER_AUTH_ENABLE_SIGN_UP=false",
        "BETTER_AUTH_ENABLE_SIGN_UP=true",
      ),
  );
  await chmod(temporary, 0o600);
  await rename(temporary, ".env");
  console.log("Created .env with a generated BETTER_AUTH_SECRET.");
} else {
  console.log("Kept existing .env unchanged.");
}
