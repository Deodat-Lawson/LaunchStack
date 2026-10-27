// GET /api/prospects/segments/suggestion — a first segment drafted from the
//   company profile: what it sells and where it is (who buys is the member's).
import type { NextRequest } from "next/server";

import { suggestSegment } from "~/server/prospects/service";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { handleProspectsError, json, prospectsContext } from "../../_http";

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        // The company profile can be filled in by a model; it runs on the workspace's.
        const suggestion = await withWorkspaceChatModels(auth.ctx.companyId, "prospects", () =>
            suggestSegment(auth.ctx)
        );
        return json({ suggestion });
    } catch (err) {
        return handleProspectsError("GET segment suggestion", err, request);
    }
}
