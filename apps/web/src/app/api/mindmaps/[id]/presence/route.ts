/**
 * Presence heartbeat.
 *
 * One POST both announces this client and returns everyone else who is looking
 * at the same document, plus the document's current revision. A single
 * round-trip keeps the polling cheap, and the revision is what lets a client
 * discover a colleague's save *before* it tries to write over it.
 *
 * This is awareness, not co-editing: the document is still written whole with
 * an optimistic-concurrency check on `revision`.
 */

import { NextResponse } from "next/server";
import { and, eq, gt, ne, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { mindmapPresence, mindmaps } from "~/server/db/schema";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError } from "~/lib/validation";

/** A client is "here" if it checked in within this window. */
const PRESENCE_TTL_MS = 20_000;
/** Cap on reported peers, so a big class opening one map stays cheap. */
const MAX_PEERS = 24;

export interface PresencePeer {
    userId: string;
    displayName: string | null;
    pageId: string | null;
    cursor: { x: number; y: number } | null;
    selection: string[];
    revisionSeen: number;
    lastSeenAt: string;
}

interface HeartbeatBody {
    displayName?: unknown;
    pageId?: unknown;
    cursor?: unknown;
    selection?: unknown;
    revisionSeen?: unknown;
}

function toInt(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        const body = ((await request.json().catch(() => ({}))) ?? {}) as HeartbeatBody;

        // Scope check and revision read in one query: a caller who cannot see
        // the document must not be able to join its presence list either.
        const [row] = await db
            .select({ id: mindmaps.id, revision: mindmaps.revision })
            .from(mindmaps)
            .where(and(eq(mindmaps.id, id), eq(mindmaps.companyId, ctx.data.companyId)))
            .limit(1);
        if (!row) return NextResponse.json({ error: "Mindmap not found" }, { status: 404 });

        const cursor =
            body.cursor && typeof body.cursor === "object"
                ? (body.cursor as { x?: unknown; y?: unknown })
                : null;
        const selection = Array.isArray(body.selection)
            ? body.selection.filter((s): s is string => typeof s === "string").slice(0, 50)
            : [];

        const now = new Date();
        await db
            .insert(mindmapPresence)
            .values({
                mindmapId: id,
                userId: ctx.data.authUserId,
                displayName:
                    typeof body.displayName === "string" ? body.displayName.slice(0, 256) : null,
                pageId: typeof body.pageId === "string" ? body.pageId.slice(0, 64) : null,
                cursorX: cursor ? toInt(cursor.x) : null,
                cursorY: cursor ? toInt(cursor.y) : null,
                selection,
                revisionSeen: toInt(body.revisionSeen) ?? 0,
                lastSeenAt: now,
            })
            .onConflictDoUpdate({
                target: [mindmapPresence.mindmapId, mindmapPresence.userId],
                set: {
                    displayName: sql`excluded.display_name`,
                    pageId: sql`excluded.page_id`,
                    cursorX: sql`excluded.cursor_x`,
                    cursorY: sql`excluded.cursor_y`,
                    selection: sql`excluded.selection`,
                    revisionSeen: sql`excluded.revision_seen`,
                    lastSeenAt: sql`excluded.last_seen_at`,
                },
            });

        const cutoff = new Date(now.getTime() - PRESENCE_TTL_MS);
        const rows = await db
            .select()
            .from(mindmapPresence)
            .where(
                and(
                    eq(mindmapPresence.mindmapId, id),
                    ne(mindmapPresence.userId, ctx.data.authUserId),
                    gt(mindmapPresence.lastSeenAt, cutoff)
                )
            )
            .limit(MAX_PEERS);

        const peers: PresencePeer[] = rows.map(peer => ({
            userId: peer.userId,
            displayName: peer.displayName,
            pageId: peer.pageId,
            cursor:
                peer.cursorX !== null && peer.cursorY !== null
                    ? { x: peer.cursorX, y: peer.cursorY }
                    : null,
            selection: Array.isArray(peer.selection) ? (peer.selection as string[]) : [],
            revisionSeen: peer.revisionSeen,
            lastSeenAt:
                peer.lastSeenAt instanceof Date
                    ? peer.lastSeenAt.toISOString()
                    : new Date(peer.lastSeenAt).toISOString(),
        }));

        return NextResponse.json({ peers, revision: row.revision }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] presence failed:", error);
        return serverError("Failed to update presence");
    }
}

/** Called on unload so a colleague's avatar disappears promptly. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const id = Number.parseInt((await params).id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        await db
            .delete(mindmapPresence)
            .where(
                and(
                    eq(mindmapPresence.mindmapId, id),
                    eq(mindmapPresence.userId, ctx.data.authUserId)
                )
            );
        return NextResponse.json({ left: true }, { status: 200 });
    } catch (error) {
        console.error("[mindmaps] presence leave failed:", error);
        return serverError("Failed to leave");
    }
}
