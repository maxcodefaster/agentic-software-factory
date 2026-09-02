/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { InterviewResponse } from '@agentic-software-factory/api-contracts/kanban';

const baseUrl = process.env.FACTORY_URL?.trim() || 'http://factory.localhost';
const origin = process.env.FACTORY_ORIGIN?.trim() || baseUrl;
const password = process.env.BUSINESS_PASSWORD;
const systemId = process.env.FACTORY_SYSTEM_ID?.trim() || 'factory/example';
const keepRequirement = process.env.KEEP_REQUIREMENT === 'true';
const acceptRequirement = process.env.ACCEPT_REQUIREMENT === 'true';
const scope = `team=factory${systemId ? `&application=${encodeURIComponent(systemId)}` : ''}`;
if (!password) throw new Error('BUSINESS_PASSWORD is required');

let cookie = '';
let requirementNumber: number | null = null;

try {
  const login = await request('/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: 'business@example.test', password }),
  }, false);
  cookie = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error('Factory login returned no session cookie');

  const created = await json<{ number: number }>(`/api/v1/requirements?${scope}`, {
    method: 'POST',
    body: JSON.stringify({
      title: `Coder MCP interview gate ${crypto.randomUUID().slice(0, 8)}`,
      body: 'A business user needs a small, testable change with one clear outcome and no technical design decisions.',
      team: 'factory',
      ...(systemId ? { applicationIds: [systemId] } : {}),
    }),
  });
  requirementNumber = created.number;

  let interview = await json<InterviewResponse>(`/api/v1/requirements/${requirementNumber}/interview/start?${scope}`, {
    method: 'POST', body: '{}',
  });
  assertQuestion(interview);
  const chatId = interview.state.chatId;
  if (!chatId) throw new Error('Coder returned no chat ID');

  for (let turn = 1; turn <= 8 && !interview.state.done; turn += 1) {
    const question = interview.state.pending;
    if (!question) throw new Error(`interview turn ${turn} has no question`);
    const selected = question.options[0]?.value;
    if (!selected) throw new Error(`interview turn ${turn} has no selectable answer`);

    await json(`/api/v1/requirements/${requirementNumber}/interview?${scope}`, {
      method: 'POST',
      body: JSON.stringify({ questionId: question.id, expectedVersion: interview.state.version, selected: [selected], customText: '' }),
    });
    interview = await waitForTurn(requirementNumber, interview.state.version);
  }

  if (!interview.state.done || interview.state.pendingOperation || interview.state.pending || !interview.spec) {
    throw new Error('Coder and MCP did not complete the interview');
  }
  if (interview.state.chatId !== chatId || interview.state.turns.length < 1 || interview.state.turns.length > 8) {
    throw new Error('completed interview has invalid Coder provenance');
  }
  if (!interview.agent?.chatUrl?.includes(`/agents/${chatId}`)) throw new Error('completed interview has no bound Coder Chat link');

  if (acceptRequirement) {
    await json(`/api/v1/requirements/${requirementNumber}/accept?${scope}`, {
      method: 'POST', body: JSON.stringify(interview.spec),
    });
  }
  console.log(JSON.stringify({ requirementNumber, systemId: systemId || null, chatId, turns: interview.state.turns.length, done: true, specStored: true, accepted: acceptRequirement }));
} finally {
  if (!keepRequirement && requirementNumber !== null && cookie) {
    await request(`/api/v1/requirements/${requirementNumber}?${scope}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

async function waitForTurn(number: number, previousVersion: number): Promise<InterviewResponse> {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const interview = await json<InterviewResponse>(`/api/v1/requirements/${number}/interview?${scope}`);
    const failure = interview.state.pendingOperation?.failure;
    if (failure) throw new Error(`interview failed: ${failure.message}`);
    if (interview.state.done || (!interview.state.pendingOperation && interview.state.version > previousVersion)) return interview;
    await Bun.sleep(1_000);
  }
  throw new Error('interview turn did not complete within six minutes');
}

function assertQuestion(interview: InterviewResponse): void {
  const question = interview.state.pending;
  if (!question || question.type !== 'single' || question.options.length < 2 || question.options.length > 4) {
    throw new Error('Coder did not return a valid structured question');
  }
}

async function json<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  return response.json() as Promise<T>;
}

async function request(path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
  let response: Response;
  for (;;) {
    response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        ...(authenticated && cookie ? { cookie } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      tls: { rejectUnauthorized: false },
      redirect: 'manual',
    });
    if (response.status !== 429) break;
    await response.body?.cancel();
    await Bun.sleep(Math.max(1, Number(response.headers.get('retry-after') ?? '1')) * 1_000);
  }
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}
