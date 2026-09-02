/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { ForgejoClient } from "./client";
import { findAccepted, findProposal } from "./client";
import { findInterview } from "./interview";

export interface CardEvent {
  id: string;
  type: string;
  actor: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function events(client: ForgejoClient, number: number, signal?: AbortSignal): Promise<CardEvent[]> {
  const issue = await client.getIssue(number, signal);
  const result: CardEvent[] = [{
    id: `issue-${number}-created`,
    type: "created",
    actor: stringRef(issue.user.login),
    payload: {},
    createdAt: formatRFC3339(issue.created_at),
  }];
  try {
    const interview = findInterview(issue.body);
    if (interview.startedAt) result.push({
      id: `${interview.runId}-started`, type: "interview-started", actor: stringRef(interview.startedBy),
      payload: { chatId: interview.chatId }, createdAt: interview.startedAt,
    });
    interview.turns.forEach((turn, index) => result.push({
      id: `${interview.runId}-turn-${index}`, type: "interview-answered", actor: stringRef(turn.answeredBy),
      payload: { question: turn.question.prompt }, createdAt: turn.answeredAt,
    }));
    if (interview.finishedAt) result.push({
      id: `${interview.runId}-finished`, type: "interview-finalized", actor: stringRef(interview.finishedBy ?? ""),
      payload: { questions: interview.turns.length }, createdAt: interview.finishedAt,
    });
  } catch {}
  try {
    const proposal = findProposal(issue.body);
    result.push({ id: `issue-${number}-proposal`, type: "spec-proposed", actor: stringRef(proposal.proposedBy), payload: {}, createdAt: proposal.proposedAt });
  } catch {}
  try {
    const accepted = findAccepted(issue.body);
    result.push({
      id: `issue-${number}-accepted-${accepted.revision}`,
      type: "spec-accepted",
      actor: stringRef(accepted.acceptedBy),
      payload: { revision: accepted.revision, path: accepted.path },
      createdAt: accepted.acceptedAt || formatRFC3339(issue.updated_at),
    });
  } catch {}
  return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function stringRef(value: string): string | null {
  return value || null;
}

function formatRFC3339(value: string): string {
  return `${new Date(value).toISOString().slice(0, 19)}Z`;
}
