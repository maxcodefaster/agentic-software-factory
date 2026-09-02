/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { describe, expect, test } from "bun:test";
import {
  createWorkItemSchema,
  updateWorkItemSchema,
  WORK_ITEM_NOTES_MAX_LENGTH,
  WORK_ITEM_TITLE_MAX_LENGTH,
  workItemIdSchema,
} from "./work-items";

describe("work item input", () => {
  test("trims values and normalizes empty notes", () => {
    expect(
      createWorkItemSchema.parse({ title: "  Ship release  ", notes: "  " }),
    ).toEqual({ title: "Ship release", notes: null });
  });

  test("accepts exact maximum lengths", () => {
    expect(
      createWorkItemSchema.safeParse({
        title: "t".repeat(WORK_ITEM_TITLE_MAX_LENGTH),
        notes: "n".repeat(WORK_ITEM_NOTES_MAX_LENGTH),
        status: "doing",
      }).success,
    ).toBe(true);
  });

  test("rejects oversized, unknown, and invalid status values", () => {
    expect(
      createWorkItemSchema.safeParse({
        title: "t".repeat(WORK_ITEM_TITLE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      createWorkItemSchema.safeParse({ title: "Valid", unexpected: true })
        .success,
    ).toBe(false);
    expect(updateWorkItemSchema.safeParse({ status: "blocked" }).success).toBe(
      false,
    );
  });

  test("requires an update field without injecting omitted notes", () => {
    expect(updateWorkItemSchema.safeParse({}).success).toBe(false);
    expect(updateWorkItemSchema.parse({ status: "done" })).toEqual({
      status: "done",
    });
  });

  test("accepts only UUID identifiers", () => {
    expect(
      workItemIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000")
        .success,
    ).toBe(true);
    expect(workItemIdSchema.safeParse("not-an-id").success).toBe(false);
  });
});
