/**
 * GET /api/s/<token> — what a public link shows about its file (ADR-016):
 * title, how to view it, its workspace's name, and the URLs under this
 * token the viewers read. Never the folder, the document id, or who added
 * it. No session; the token is the credential (`~/server/public-share/http`).
 */

import { publicShareRoute, publicJson, PUBLIC_READ_LIMIT } from "~/server/public-share/http";
import { toPublicDocument } from "~/server/public-share/document";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
    return publicShareRoute(request, params, PUBLIC_READ_LIMIT, "meta", async ({ link, row }) =>
        publicJson(await toPublicDocument(link, row))
    );
}
