/**
 * GET /api/s/<token>/media/transcript — the plain transcript of a shared
 * recording or transcript, as text, for the transcript panel when it has no
 * timed segments.
 */

import { storedBytesResponse } from "~/server/public-share/bytes";
import { resolvePublicMedia } from "~/server/public-share/media";
import {
    PUBLIC_READ_LIMIT,
    PUBLIC_SHARE_HEADERS,
    publicError,
    publicShareRoute,
} from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(
        request,
        params,
        PUBLIC_READ_LIMIT,
        "media/transcript",
        async ({ link, row }) => {
            const resolved = await resolvePublicMedia(link, row);
            const transcript = resolved?.transcriptDocument;
            if (!transcript) return publicError(request, 404, "noMedia");
            const response = await storedBytesResponse(request, {
                url: transcript.url,
                companyId: link.companyId,
                title: transcript.title,
                fallbackMimeType: "text/plain; charset=utf-8",
                disposition: "inline",
                headers: { ...PUBLIC_SHARE_HEADERS },
            });
            return response ?? publicError(request, 404, "noMedia");
        }
    );
}
