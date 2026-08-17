/**
 * Documents a meeting can be pointed at.
 *
 * Its own route rather than a field on `/api/collab/agents` because the two
 * answer different questions and are refetched at different times — the roster
 * changes when someone edits an agent, the corpus changes when someone uploads.
 *
 * This list narrows what a meeting retrieves; it grants nothing. Every
 * retrieval re-checks access against the meeting's creator at query time.
 */

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { document } from "@launchstack/core/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";

/** The picker is a chooser, not a browser — newest first, capped. */
const LIMIT = 200;

export async function GET() {
  const ctx = await requireWorkspaceContext();
  if (!ctx.success) return ctx.response;

  const rows = await db
    .select({
      id: document.id,
      title: document.title,
      category: document.category,
    })
    .from(document)
    .where(and(eq(document.companyId, ctx.data.companyId)))
    .orderBy(desc(document.id))
    .limit(LIMIT);

  return NextResponse.json({
    documents: rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      category: row.category,
    })),
    truncated: rows.length === LIMIT,
  });
}
