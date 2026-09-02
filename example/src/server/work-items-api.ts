/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { and, desc, eq } from "drizzle-orm";
import {
  createWorkItemSchema,
  updateWorkItemSchema,
  workItemIdSchema,
} from "@/lib/work-items";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { workItem } from "@/server/db/schema";

const badRequest = () =>
  Response.json({ error: "Invalid request" }, { status: 400 });
const unauthorized = () =>
  Response.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () =>
  Response.json({ error: "Work item not found" }, { status: 404 });
const serverError = () =>
  Response.json({ error: "Unable to process work items" }, { status: 500 });
const readOnly = () =>
  Response.json(
    { error: "Verification fixture is read-only" },
    { status: 405 },
  );
const verificationItems = [
  {
    id: "3f43a83e-403d-4b65-9769-75bc25f2ab72",
    title: "Review the release candidate",
    notes: "Check the application flow and record any findings.",
    status: "doing",
    createdAt: "2026-01-15T09:00:00.000Z",
    updatedAt: "2026-01-15T10:30:00.000Z",
  },
  {
    id: "bf3bd9ed-f43d-47cf-a36b-794a366e5b64",
    title: "Confirm the readiness checks",
    notes: "Database migrations and the application probe are complete.",
    status: "done",
    createdAt: "2026-01-14T14:00:00.000Z",
    updatedAt: "2026-01-15T08:45:00.000Z",
  },
] as const;

const verificationMode = () =>
  process.env.FACTORY_VERIFICATION_MODE === "fixture";

async function getUserId(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function listWorkItems(request: Request) {
  if (verificationMode()) return Response.json({ items: verificationItems });
  try {
    const userId = await getUserId(request);
    if (!userId) return unauthorized();

    const items = await db
      .select({
        id: workItem.id,
        title: workItem.title,
        notes: workItem.notes,
        status: workItem.status,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
      })
      .from(workItem)
      .where(eq(workItem.userId, userId))
      .orderBy(desc(workItem.updatedAt), desc(workItem.createdAt));

    return Response.json({ items });
  } catch {
    return serverError();
  }
}

export async function createWorkItem(request: Request) {
  if (verificationMode()) return readOnly();
  try {
    const userId = await getUserId(request);
    if (!userId) return unauthorized();

    const parsed = createWorkItemSchema.safeParse(await readBody(request));
    if (!parsed.success) return badRequest();

    const [created] = await db
      .insert(workItem)
      .values({ userId, ...parsed.data })
      .returning({
        id: workItem.id,
        title: workItem.title,
        notes: workItem.notes,
        status: workItem.status,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
      });

    return Response.json({ item: created }, { status: 201 });
  } catch {
    return serverError();
  }
}

export async function updateWorkItem(request: Request, id: string) {
  if (verificationMode()) return readOnly();
  if (!workItemIdSchema.safeParse(id).success) return badRequest();

  try {
    const userId = await getUserId(request);
    if (!userId) return unauthorized();

    const parsed = updateWorkItemSchema.safeParse(await readBody(request));
    if (!parsed.success) return badRequest();

    const [updated] = await db
      .update(workItem)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(workItem.id, id), eq(workItem.userId, userId)))
      .returning({
        id: workItem.id,
        title: workItem.title,
        notes: workItem.notes,
        status: workItem.status,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
      });

    if (!updated) return notFound();
    return Response.json({ item: updated });
  } catch {
    return serverError();
  }
}

export async function deleteWorkItem(request: Request, id: string) {
  if (verificationMode()) return readOnly();
  if (!workItemIdSchema.safeParse(id).success) return badRequest();

  try {
    const userId = await getUserId(request);
    if (!userId) return unauthorized();

    const [deleted] = await db
      .delete(workItem)
      .where(and(eq(workItem.id, id), eq(workItem.userId, userId)))
      .returning({ id: workItem.id });

    if (!deleted) return notFound();
    return new Response(null, { status: 204 });
  } catch {
    return serverError();
  }
}
