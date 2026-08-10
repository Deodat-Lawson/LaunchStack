import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { workspacePageVersions } from "~/server/db/schema/workspace";
import {
    getPage,
    serializePage,
    serializeVersion,
    snapshotPage,
    updatePage,
} from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

async function loadVersion(userId: string, pageId: string, versionId: number) {
    const [row] = await db
        .select()
        .from(workspacePageVersions)
        .where(
            and(
                eq(workspacePageVersions.id, versionId),
                eq(workspacePageVersions.pageId, pageId),
                eq(workspacePageVersions.userId, userId)
            )
        );
    return row ?? null;
}

/** One snapshot, body included — the history panel previews from this. */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ pageId: string; versionId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId, versionId } = await params;
        const id = Number.parseInt(versionId, 10);
        if (Number.isNaN(id)) {
            return NextResponse.json({ error: "Invalid version id" }, { status: 400 });
        }

        const version = await loadVersion(session.userId, pageId, id);
        if (!version) {
            return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        return NextResponse.json(
            { version: serializeVersion(version, true) },
            { status: 200 }
        );
    } catch (error) {
        console.error("[workspace/versions/:id] GET failed:", error);
        return NextResponse.json({ error: "Failed to load version" }, { status: 500 });
    }
}

/** Restore this snapshot over the live page, snapshotting the live state first. */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ pageId: string; versionId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId, versionId } = await params;
        const id = Number.parseInt(versionId, 10);
        if (Number.isNaN(id)) {
            return NextResponse.json({ error: "Invalid version id" }, { status: 400 });
        }

        const version = await loadVersion(session.userId, pageId, id);
        if (!version) {
            return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const live = await getPage(session.userId, pageId);
        if (!live) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        // Restoring is itself an edit worth being able to undo.
        await snapshotPage(session.userId, live, "Before restore");

        const page = await updatePage(session.userId, pageId, {
            title: version.title ?? live.title,
            content: version.content,
        });
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        return NextResponse.json({ page: serializePage(page) }, { status: 200 });
    } catch (error) {
        console.error("[workspace/versions/:id] POST failed:", error);
        return NextResponse.json({ error: "Failed to restore version" }, { status: 500 });
    }
}
