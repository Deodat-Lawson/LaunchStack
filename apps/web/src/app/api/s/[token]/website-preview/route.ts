/**
 * GET /api/s/<token>/website-preview — the stored picture of a shared web
 * page, if one was taken. A public link never takes a new one (that runs
 * Chromium on the workspace's behalf); without a stored picture the viewer
 * shows the page's text instead.
 */

import { websiteMarkerOf } from "~/lib/website-document";
import {
    WEBSITE_PREVIEW_CONTENT_TYPE,
    readStoredPreview,
    websitePreviewOf,
} from "~/server/website-preview";
import { PUBLIC_READ_LIMIT, publicError, publicShareRoute } from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(
        request,
        params,
        PUBLIC_READ_LIMIT,
        "website-preview",
        async ({ row }) => {
            if (!websiteMarkerOf(row.ocrMetadata)) return publicError(request, 404, "noPreview");
            const stored = websitePreviewOf(row.ocrMetadata);
            if (!stored || stored.source !== row.url) return publicError(request, 404, "noPreview");
            const image = await readStoredPreview(stored);
            if (!image) return publicError(request, 404, "noPreview");
            return new Response(new Uint8Array(image), {
                status: 200,
                headers: {
                    "Content-Type": WEBSITE_PREVIEW_CONTENT_TYPE,
                    "Content-Length": String(image.byteLength),
                    "X-Content-Type-Options": "nosniff",
                    "X-Preview-Truncated": String(stored.truncated),
                },
            });
        }
    );
}
