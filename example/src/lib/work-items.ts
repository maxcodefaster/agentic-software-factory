/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { z } from "zod";

export const WORK_ITEM_TITLE_MAX_LENGTH = 120;
export const WORK_ITEM_NOTES_MAX_LENGTH = 1000;
export const workItemStatuses = ["todo", "doing", "done"] as const;

const title = z.string().trim().min(1).max(WORK_ITEM_TITLE_MAX_LENGTH);
const notes = z
  .string()
  .trim()
  .max(WORK_ITEM_NOTES_MAX_LENGTH)
  .nullable()
  .transform((value) => value || null)
  .optional();

export const createWorkItemSchema = z
  .object({
    title,
    notes,
    status: z.enum(workItemStatuses).optional(),
  })
  .strict();

export const updateWorkItemSchema = z
  .object({
    title: title.optional(),
    notes,
    status: z.enum(workItemStatuses).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const workItemIdSchema = z.uuid();

export type WorkItemStatus = (typeof workItemStatuses)[number];
export type WorkItem = {
  id: string;
  title: string;
  notes: string | null;
  status: WorkItemStatus;
  createdAt: string;
  updatedAt: string;
};
