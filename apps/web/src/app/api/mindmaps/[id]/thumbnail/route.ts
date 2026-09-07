/**
 * The map's thumbnail as an image.
 *
 * Thumbnails are stored as data URIs on the row (the editor rasterises the
 * live canvas on save), which is convenient to write and terrible to list:
 * one can run to a couple of megabytes, and the workspace lists every map on
 * first paint. So the list omits them and a card asks for one here, with an
 * ETag so a revisit costs a 304.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getMindmap } from "~/server/mindmap/repository";

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const row = await getMindmap(id, ctx.data.companyId);
    if (!row?.thumbnail) return new NextResponse(null, { status: 404 });

    const match = DATA_URI.exec(row.thumbnail);
    if (!match) return new NextResponse(null, { status: 404 });

    const updated = row.updatedAt instanceof Date ? row.updatedAt.getTime() : String(row.updatedAt);
    const etag = `"${row.id}-${row.revision}-${updated}"`;
    if (request.headers.get("if-none-match") === etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    return new NextResponse(new Uint8Array(Buffer.from(match[2]!, "base64")), {
        status: 200,
        headers: {
            "Content-Type": match[1]!,
            ETag: etag,
            "Cache-Control": "private, max-age=0, must-revalidate",
        },
    });
}
