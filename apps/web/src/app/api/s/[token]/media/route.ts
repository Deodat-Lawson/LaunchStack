/**
 * GET /api/s/<token>/media — what the media viewer plays and shows for a
 * shared recording or transcript (`~/server/public-share/media`).
 */

import { publicMediaPreview, resolvePublicMedia } from "~/server/public-share/media";
import {
    PUBLIC_READ_LIMIT,
    publicError,
    publicJson,
    publicShareRoute,
} from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(request, params, PUBLIC_READ_LIMIT, "media", async ({ link, row }) => {
        const resolved = await resolvePublicMedia(link, row);
        if (!resolved) return publicError(request, 404, "noMedia");
        return publicJson(publicMediaPreview(resolved));
    });
}
