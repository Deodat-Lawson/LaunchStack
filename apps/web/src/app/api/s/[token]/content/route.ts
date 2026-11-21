/**
 * GET /api/s/<token>/content — the shared file's current bytes, ranged so a
 * player can seek. `?download=1` asks for a download, refused when the link
 * has downloads off; viewing always works (a browser that shows a file can
 * save it, so "downloads off" removes the button, it does not lock bytes).
 */

import { storedBytesResponse } from "~/server/public-share/bytes";
import { fallbackMimeType } from "~/server/public-share/document";
import {
    PUBLIC_BYTES_LIMIT,
    PUBLIC_SHARE_HEADERS,
    publicError,
    publicShareRoute,
} from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(
        request,
        params,
        PUBLIC_BYTES_LIMIT,
        "content",
        async ({ link, row }) => {
            const download = new URL(request.url).searchParams.get("download") === "1";
            if (download && !link.allowDownload) return publicError(request, 403, "downloadOff");
            const response = await storedBytesResponse(request, {
                url: row.url,
                companyId: link.companyId,
                title: row.title,
                fallbackMimeType: fallbackMimeType(row),
                disposition: download ? "attachment" : "inline",
                headers: { ...PUBLIC_SHARE_HEADERS },
            });
            return response ?? publicError(request, 404, "notAvailable");
        }
    );
}
