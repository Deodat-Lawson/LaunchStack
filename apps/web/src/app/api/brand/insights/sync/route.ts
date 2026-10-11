// POST /api/brand/insights/sync — read numbers and comments from the networks now
//
// LinkedIn's development tier allows 500 calls a day per app, so a sync
// started within a minute of the last one returns without asking again.
import { syncBrandWorkspace } from "~/server/brand/sync";
import { listChannelRows } from "~/server/brand/channels";

import { brandContext, handleBrandError, json } from "../../_http";

const MIN_INTERVAL_MS = 60_000;

export async function POST() {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const rows = await listChannelRows(auth.ctx.companyId);
        const last = Math.max(0, ...rows.map(r => r.syncedAt?.getTime() ?? 0));
        if (last > 0 && Date.now() - last < MIN_INTERVAL_MS) {
            return json({ syncedAt: new Date(last), posts: 0, comments: 0, errors: [] });
        }
        return json(await syncBrandWorkspace(auth.ctx.companyId));
    } catch (err) {
        return handleBrandError("POST sync", err);
    }
}
