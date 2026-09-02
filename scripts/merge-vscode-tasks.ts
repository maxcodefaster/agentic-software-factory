/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

const path = process.argv[2];
if (!path) throw new Error('Usage: bun scripts/merge-vscode-tasks.ts <tasks.json>');

const document = Bun.JSONC.parse(await Bun.file(path).text()) as { version?: unknown; tasks?: unknown };
if (!document || typeof document !== 'object' || !Array.isArray(document.tasks)) throw new Error(`${path} must contain a VS Code tasks array`);

type Task = Record<string, unknown> & { label?: unknown; command?: unknown };
const tasks = document.tasks.filter((task): task is Task => Boolean(task && typeof task === 'object' && !Array.isArray(task)));
const processView = tasks.find((task) => task.label === 'Dev: Process View')
  ?? tasks.find((task) => task.label === 'Dev: Processes' && typeof task.command === 'string');
if (!processView) process.exit(0);

processView.label = 'Dev: Process View';
delete processView.runOptions;
const preserved = tasks.filter((task) => !['Dev: Processes', 'Dev: Browser Apps'].includes(String(task.label)) || task === processView);
const browserApps: Task = {
  label: 'Dev: Browser Apps', type: 'shell', command: '/workspace-state/ide/browser-apps',
  options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
  presentation: { reveal: 'always', panel: 'dedicated', focus: false, showReuseMessage: false, clear: true, close: false },
};
const automatic: Task = {
  label: 'Dev: Processes', dependsOrder: 'sequence', dependsOn: ['Dev: Browser Apps', 'Dev: Process View'],
  runOptions: { runOn: 'folderOpen' }, problemMatcher: [],
};
await Bun.write(path, `${JSON.stringify({ ...document, version: '2.0.0', tasks: [...preserved, browserApps, automatic] }, null, 2)}\n`);
