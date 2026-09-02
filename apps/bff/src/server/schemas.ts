/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { t } from 'elysia';

const strict = { additionalProperties: false } as const;
const identifier = { minLength: 1, maxLength: 256 } as const;
const longText = { maxLength: 100_000 } as const;
const list = { maxItems: 100 } as const;
const listItem = t.String({ maxLength: 2_000 });

export const emptyBody = t.Object({}, strict);

export const createRequirementBody = t.Object(
  {
    title: t.String({ minLength: 1, maxLength: 256 }),
    body: t.String({ minLength: 1, ...longText }),
    team: t.Optional(t.String(identifier)),
    applicationIds: t.Optional(t.Array(t.String(identifier), { minItems: 1, maxItems: 1 })),
    assignee: t.Optional(t.Union([t.String(identifier), t.Null()])),
  },
  strict,
);

export const updateRequirementBody = t.Object(
  {
    title: t.Optional(t.String({ maxLength: 256 })),
    body: t.Optional(t.String(longText)),
    assignee: t.Optional(t.Union([t.String(identifier), t.Null()])),
    applicationIds: t.Optional(t.Array(t.String(identifier), { minItems: 1, maxItems: 1 })),
    expectedUpdatedAt: t.Optional(t.String({ format: 'date-time' })),
  },
  strict,
);

export const transitionBody = t.Object(
  {
    status: t.Union([
      t.Literal('ideation'),
      t.Literal('requirements'),
      t.Literal('implementation'),
      t.Literal('done'),
    ]),
    expectedUpdatedAt: t.Optional(t.String({ format: 'date-time' })),
  },
  strict,
);

export const requirementSpecBody = t.Object(
  {
    goal: t.String({ minLength: 1, maxLength: 10_000 }),
    users: t.Array(listItem, list),
    userStories: t.Array(listItem, list),
    acceptanceCriteria: t.Array(listItem, { minItems: 1, ...list }),
    nonFunctionalRequirements: t.Array(listItem, list),
    moscow: t.Object(
      {
        must: t.Array(listItem, list),
        should: t.Array(listItem, list),
        could: t.Array(listItem, list),
      },
      strict,
    ),
    openQuestions: t.Array(listItem, list),
    nonGoals: t.Array(listItem, list),
  },
  strict,
);

export const answerBody = t.Object(
  {
    questionId: t.String(identifier),
    expectedVersion: t.Integer({ minimum: 0 }),
    selected: t.Array(t.String(identifier), { maxItems: 50 }),
    customText: t.String({ maxLength: 10_000 }),
  },
  strict,
);

export const sharpenBody = t.Object({ note: t.String({ minLength: 1, maxLength: 10_000 }) }, strict);

export const numberParams = t.Object({ number: t.String({ pattern: '^[1-9][0-9]*$', maxLength: 10 }) }, strict);
export const runParams = t.Object({ id: t.String(identifier) }, strict);
export const applicationParams = t.Object({ id: t.String(identifier) }, strict);
export const applicationWorkspaceParams = t.Object({ id: t.String(identifier), workspaceId: t.String(identifier) }, strict);
export const registerApplicationBody = t.Object({
  repository: t.String({ minLength: 1, maxLength: 100 }),
  team: t.String(identifier),
}, strict);
export const reassignApplicationBody = t.Object({ team: t.String(identifier) }, strict);
export const startImplementationBody = t.Object({ applicationId: t.String(identifier) }, strict);
export const reviewImplementationBody = t.Object({
  decision: t.Union([t.Literal('approve'), t.Literal('request-changes')]),
  body: t.String({ maxLength: 50_000 }),
}, strict);
