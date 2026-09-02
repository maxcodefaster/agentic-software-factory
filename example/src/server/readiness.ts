/*
Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.

All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
*/
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseURL } from "./db";

const readinessDb = drizzle(
  postgres(databaseURL, { max: 1, connect_timeout: 1, idle_timeout: 5 }),
);

export async function readinessResponse() {
  try {
    await readinessDb.execute(sql`select 1`);
    return Response.json({ status: "ready", checks: { database: "ok" } });
  } catch {
    return Response.json(
      { status: "not_ready", checks: { database: "unavailable" } },
      { status: 503 },
    );
  }
}
