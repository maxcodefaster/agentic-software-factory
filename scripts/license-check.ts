/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

type CommentStyle = "block" | "hash" | "html" | "sql";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const fix = Bun.argv.includes("--fix");
const generatedFiles = new Set([
  "packages/design-system/src/theme.css",
  "packages/design-system/src/tokens.css",
  "example/src/routeTree.gen.ts",
]);
const spartanFiles = new Set([
  "web/src/app/shared/ui/button/src/index.ts",
  "web/src/app/shared/ui/button/src/lib/hlm-button.token.ts",
  "web/src/app/shared/ui/button/src/lib/hlm-button.ts",
  "web/src/app/shared/ui/input/src/index.ts",
  "web/src/app/shared/ui/input/src/lib/hlm-input.ts",
  "web/src/app/shared/ui/utils/src/index.ts",
  "web/src/app/shared/ui/utils/src/lib/hlm.ts",
]);
const blockExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".mjs",
  ".cjs",
  ".proto",
  ".rs",
  ".scss",
  ".swift",
  ".ts",
  ".tsx",
]);
const hashExtensions = new Set([
  ".bash",
  ".conf",
  ".fish",
  ".hcl",
  ".ini",
  ".pl",
  ".pm",
  ".properties",
  ".ps1",
  ".py",
  ".rb",
  ".sh",
  ".tf",
  ".tfvars",
  ".toml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const htmlExtensions = new Set([".htm", ".html", ".svelte", ".vue", ".xml"]);
const sqlExtensions = new Set([".lua", ".sql"]);
const hashNames = new Set([
  ".dockerignore",
  ".editorconfig",
  ".gitignore",
  "Justfile",
  "Makefile",
]);
const lockNames = new Set([
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const imageExtensions = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

function extractExhibitA(license: string): string {
  const match = license.match(
    /EXHIBIT A\r?\n\r?\nThe License Notice below must appear[^\n]*:\r?\n\r?\n([\s\S]*?)\r?\n\r?\nEXHIBIT B/,
  );
  if (!match) throw new Error("Could not extract Exhibit A notice from LICENSE");
  return `${match[1].replaceAll("\r\n", "\n").trim()}\n`;
}

function styleFor(path: string): CommentStyle | undefined {
  const name = basename(path);
  const extension = extname(path).toLowerCase();
  if (name === "Dockerfile" || name.startsWith("Dockerfile.") || extension === ".dockerfile") return "hash";
  if (hashNames.has(name) || hashExtensions.has(extension)) return "hash";
  if (blockExtensions.has(extension)) return "block";
  if (htmlExtensions.has(extension)) return "html";
  if (sqlExtensions.has(extension)) return "sql";
  return undefined;
}

function renderHeader(notice: string, style: CommentStyle): string {
  const lines = notice.trimEnd().split("\n");
  if (style === "block") {
    return `/*\n${lines.map((line) => (line ? ` * ${line}` : " *")).join("\n")}\n */\n\n`;
  }
  if (style === "html") return `<!--\n${notice.trimEnd()}\n-->\n\n`;
  const marker = style === "sql" ? "--" : "#";
  return `${lines.map((line) => (line ? `${marker} ${line}` : marker)).join("\n")}\n\n`;
}

function endOfLine(content: string, offset: number): number {
  const newline = content.indexOf("\n", offset);
  return newline === -1 ? content.length : newline + 1;
}

function insertionOffset(path: string, content: string, style: CommentStyle): number {
  let offset = content.startsWith("\uFEFF") ? 1 : 0;
  if (content.startsWith("#!", offset)) offset = endOfLine(content, offset);

  const extension = extname(path).toLowerCase();
  if (style === "hash" && (extension === ".yaml" || extension === ".yml")) {
    while (content.startsWith("%", offset)) offset = endOfLine(content, offset);
    if (content.startsWith("---", offset) && /^(---)(?:\r?\n|$)/.test(content.slice(offset))) {
      offset = endOfLine(content, offset);
    }
  }

  if (style === "html") {
    if (/^<\?xml(?:\s|\?)/i.test(content.slice(offset))) offset = endOfLine(content, offset);
    if (/^<!doctype(?:\s|>)/i.test(content.slice(offset))) offset = endOfLine(content, offset);
  }

  if (basename(path) === "Dockerfile" || basename(path).startsWith("Dockerfile.")) {
    while (/^#\s*(?:syntax|escape|check)=/i.test(content.slice(offset))) {
      offset = endOfLine(content, offset);
    }
  }
  return offset;
}

function exclusionFor(path: string): string {
  const name = basename(path);
  const extension = extname(path).toLowerCase();
  if (generatedFiles.has(path)) return "generated files";
  if (lockNames.has(name) || name === ".terraform.lock.hcl") return "third-party lockfiles";
  if (imageExtensions.has(extension)) return "images and binary assets";
  if (extension === ".md" || extension === ".mdx") return "Markdown documentation";
  if (extension === ".json" || extension === ".jsonc" || name === ".prettierrc") {
    return "JSON and commentless manifests";
  }
  if (
    path === "LICENSE" ||
    path === "LICENSE-HEADER.txt" ||
    path === "NOTICE" ||
    path === "THIRD_PARTY_NOTICES" ||
    path.endsWith("/LICENSE") ||
    path.endsWith("/NOTICE")
  ) {
    return "canonical license and central notices";
  }
  return "other non-source or structurally non-commentable files";
}

async function repositoryFiles(): Promise<string[]> {
  const output = await Bun.$`git ls-files --cached --others --exclude-standard -z`.cwd(rootPath).text();
  return output
    .split("\0")
    .filter(Boolean)
    .sort();
}

const license = await readFile(new URL("LICENSE", root), "utf8");
const notice = extractExhibitA(license);
const template = await readFile(new URL("LICENSE-HEADER.txt", root), "utf8");
const centralNotice = await readFile(new URL("NOTICE", root), "utf8");
const exampleLicense = await readFile(new URL("example/LICENSE", root), "utf8");
const exampleNotice = await readFile(new URL("example/NOTICE", root), "utf8");
const noticeParagraphs = notice.trimEnd().split(/\n\s*\n/);
const thirdPartyNotices = await readFile(new URL("THIRD_PARTY_NOTICES", root), "utf8");
const failures: string[] = [];
if (template.replaceAll("\r\n", "\n") !== notice) {
  failures.push("LICENSE-HEADER.txt does not exactly match Exhibit A in LICENSE");
}
if (!centralNotice.replaceAll("\r\n", "\n").includes(notice.trimEnd())) {
  failures.push("NOTICE does not contain the canonical Exhibit A notice");
}
if (exampleLicense.replaceAll("\r\n", "\n") !== license.replaceAll("\r\n", "\n")) {
  failures.push("example/LICENSE does not exactly match LICENSE");
}
if (!exampleNotice.replaceAll("\r\n", "\n").includes(notice.trimEnd())) {
  failures.push("example/NOTICE does not contain the canonical Exhibit A notice");
}
if (!thirdPartyNotices.includes("Copyright (c) 2024 ROBIN GOETZ")
  || !thirdPartyNotices.includes("Permission is hereby granted, free of charge")) {
  failures.push("THIRD_PARTY_NOTICES does not contain the Spartan MIT copyright and license");
}
for (const path of spartanFiles) {
  if (!thirdPartyNotices.includes(`- ${path}`)) {
    failures.push(`THIRD_PARTY_NOTICES does not list ${path}`);
  }
}

let covered = 0;
let fixed = 0;
const styles = new Map<CommentStyle, number>();
const exclusions = new Map<string, number>();
for (const path of await repositoryFiles()) {
  if (!(await Bun.file(new URL(path, root)).exists())) continue;
  if (spartanFiles.has(path)) {
    const content = await readFile(new URL(path, root), "utf8");
    if (!content.includes("Spartan-derived portions of this file remain licensed under MIT")) {
      failures.push(`${path}: missing scoped Spartan MIT source notice`);
    }
    if (content.includes(notice.trimEnd())) {
      failures.push(`${path}: must not claim Spartan-derived code is RPL-1.5-only`);
    }
    exclusions.set("vendored Spartan UI files covered by MIT and RPL-1.5 modification notices", (exclusions.get("vendored Spartan UI files covered by MIT and RPL-1.5 modification notices") ?? 0) + 1);
    continue;
  }
  const excluded = exclusionFor(path);
  if (generatedFiles.has(path) || lockNames.has(basename(path)) || basename(path) === ".terraform.lock.hcl") {
    exclusions.set(excluded, (exclusions.get(excluded) ?? 0) + 1);
    continue;
  }
  const file = new URL(path, root);
  let style = styleFor(path);
  let content: string | undefined;
  if (!style && !extname(path) && ((await stat(file)).mode & 0o111) !== 0) {
    content = await readFile(file, "utf8");
    if (content.startsWith("#!") || content.startsWith("\uFEFF#!")) style = "hash";
  }
  if (!style) {
    const reason = exclusionFor(path);
    exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);
    continue;
  }

  content ??= await readFile(file, "utf8");
  const offset = insertionOffset(path, content, style);
  const header = renderHeader(notice, style);
  const source = content.slice(offset);
  const equivalentBlockNotice = style === "block" && source.startsWith(`/*\n${notice.trimEnd()}\n*/`);
  const canonicalParagraphsPresent = noticeParagraphs.every((paragraph) => source.slice(0, 5000).includes(paragraph));
  if (source.startsWith(header) || equivalentBlockNotice || canonicalParagraphsPresent) {
    covered++;
    styles.set(style, (styles.get(style) ?? 0) + 1);
    continue;
  }
  if (fix) {
    await writeFile(file, `${content.slice(0, offset)}${header}${content.slice(offset)}`);
    covered++;
    fixed++;
    styles.set(style, (styles.get(style) ?? 0) + 1);
  } else {
    failures.push(`${path}: missing canonical Exhibit A header`);
  }
}

if (fixed) console.log(`Added canonical Exhibit A headers to ${fixed} file(s).`);
console.log(`RPL-1.5 inline notice coverage: ${covered} file(s).`);
for (const [style, count] of [...styles].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`Inline ${style} comments: ${count} file(s).`);
}
for (const [reason, count] of [...exclusions].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`Central NOTICE coverage: ${reason}: ${count} file(s).`);
}
if (failures.length) {
  console.error(`\nLicense check failed with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
