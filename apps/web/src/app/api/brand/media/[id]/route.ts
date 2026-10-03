// GET /api/brand/media/[id] — the image, for a member of the workspace that owns it
import type { NextRequest } from "next/server";

import { getBrandMediaRow, readBrandMedia } from "~/server/brand/media";

import { brandContext, error, handleBrandError } from "../../_http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const row = await getBrandMediaRow(auth.ctx.companyId, id);
        if (!row) return error("Image not found", 404);
        const bytes = await readBrandMedia(row);
        return new Response(Buffer.from(bytes), {
            headers: {
                "Content-Type": row.mimeType,
                "Content-Length": String(bytes.byteLength),
                // Ids are never reused, so the bytes never change.
                "Cache-Control": "private, max-age=86400, immutable",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (err) {
        return handleBrandError("GET media", err);
    }
}
