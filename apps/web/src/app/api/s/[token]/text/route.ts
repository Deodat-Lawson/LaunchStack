/**
 * GET /api/s/<token>/text — the shared file's words as Markdown, for the
 * public page's viewers (`{ markdown, available, truncated }`, the shape
 * `/api/documents/:id/text?format=markdown` gives the website viewer).
 */

import { getDocumentDisplayType } from "~/app/employer/documents/types/document";
import { publicDocumentText } from "~/server/public-share/document";
import { publicJson, publicShareRoute, PUBLIC_READ_LIMIT } from "~/server/public-share/http";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(request, params, PUBLIC_READ_LIMIT, "text", async ({ link, row }) => {
        const displayType = getDocumentDisplayType({
            title: row.title,
            url: row.url,
            mimeType: row.mimeType ?? undefined,
            ocrMetadata: row.ocrMetadata,
        });
        return publicJson(await publicDocumentText(link, row, displayType));
    });
}
