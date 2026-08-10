import { NextResponse } from "next/server";
import { z } from "zod";

import { validateRequestBody } from "~/lib/validation";
import {
    deletePagePermanently,
    getBacklinks,
    getBreadcrumb,
    getPage,
    serializePage,
    snapshotPage,
    trashPage,
    updatePage,
} from "~/server/workspace/service";
import { getWorkspaceSession } from "~/server/workspace/session";

const IconSchema = z
    .object({ type: z.enum(["emoji", "image"]), value: z.string() })
    .nullable();

const CoverSchema = z
    .object({
        type: z.enum(["gradient", "image"]),
        value: z.string(),
        position: z.number().min(0).max(100),
    })
    .nullable();

const UpdatePageSchema = z.object({
    title: z.string().max(2000).optional(),
    icon: IconSchema.optional(),
    cover: CoverSchema.optional(),
    content: z.unknown().optional(),
    properties: z.record(z.unknown()).nullish(),
    font: z.enum(["default", "serif", "mono"]).optional(),
    smallText: z.boolean().optional(),
    fullWidth: z.boolean().optional(),
    locked: z.boolean().optional(),
    isFavorite: z.boolean().optional(),
    isTemplate: z.boolean().optional(),
    publicSlug: z.string().max(64).nullish(),
    /** Set when this save should also write a page-history snapshot. */
    snapshot: z.boolean().optional(),
});

export async function GET(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const page = await getPage(session.userId, pageId);
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        const url = new URL(request.url);
        const withMeta = url.searchParams.get("meta") !== "false";

        return NextResponse.json(
            {
                page: serializePage(page),
                ...(withMeta
                    ? {
                          breadcrumb: await getBreadcrumb(session.userId, pageId),
                          backlinks: await getBacklinks(session.userId, pageId),
                      }
                    : {}),
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("[workspace/pages/:id] GET failed:", error);
        return NextResponse.json({ error: "Failed to load page" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const validation = await validateRequestBody(request, UpdatePageSchema);
        if (!validation.success) return validation.response;
        const { snapshot, ...patch } = validation.data;

        const existing = await getPage(session.userId, pageId);
        if (!existing) {
            return NextResponse.json({ error: "Page not found" }, { status: 404 });
        }
        // A locked page rejects body edits but still accepts the unlock itself
        // and the display settings that live outside the document.
        if (existing.locked && patch.content !== undefined) {
            return NextResponse.json({ error: "Page is locked" }, { status: 409 });
        }

        // Snapshot the state *before* this write, so restoring a version
        // actually rewinds rather than replaying what was just saved.
        if (snapshot) await snapshotPage(session.userId, existing);

        const page = await updatePage(session.userId, pageId, patch);
        if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

        return NextResponse.json({ page: serializePage(page) }, { status: 200 });
    } catch (error) {
        console.error("[workspace/pages/:id] PATCH failed:", error);
        return NextResponse.json({ error: "Failed to update page" }, { status: 500 });
    }
}

/** Move to trash by default; `?permanent=true` deletes the row and subtree. */
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    try {
        const session = await getWorkspaceSession();
        if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { pageId } = await params;
        const permanent = new URL(request.url).searchParams.get("permanent") === "true";

        const ids = permanent
            ? await deletePagePermanently(session.userId, pageId)
            : await trashPage(session.userId, pageId);

        if (ids.length === 0) {
            return NextResponse.json({ error: "Page not found" }, { status: 404 });
        }

        return NextResponse.json({ deleted: ids, permanent }, { status: 200 });
    } catch (error) {
        console.error("[workspace/pages/:id] DELETE failed:", error);
        return NextResponse.json({ error: "Failed to delete page" }, { status: 500 });
    }
}
