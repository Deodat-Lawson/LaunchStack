/**
 * GET /api/s/<token>/media/content — the recording that plays for a shared
 * transcript or recording, ranged so the player can seek. Which recording is
 * worked out again here from the token; the caller never names one.
 */

import { storedBytesResponse } from "~/server/public-share/bytes";
import { resolvePublicMedia } from "~/server/public-share/media";
import {
    PUBLIC_BYTES_LIMIT,
    PUBLIC_SHARE_HEADERS,
    publicError,
    publicShareRoute,
} from "~/server/public-share/http";
import { mediaMimeFromName } from "~/lib/media-document";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(
        request,
        params,
        PUBLIC_BYTES_LIMIT,
        "media/content",
        async ({ link, row }) => {
            const resolved = await resolvePublicMedia(link, row);
            const media = resolved?.playbackDocument;
            if (!media) return publicError(request, 404, "noMedia");
            const response = await storedBytesResponse(request, {
                url: media.url,
                companyId: link.companyId,
                title: media.title,
                fallbackMimeType:
                    media.mimeType ?? mediaMimeFromName(media.title) ?? "application/octet-stream",
                disposition: "inline",
                headers: { ...PUBLIC_SHARE_HEADERS },
            });
            return response ?? publicError(request, 404, "noMedia");
        }
    );
}
