// POST /api/brand/posts/publish-due — publish this workspace's overdue posts now
//
// The worker's cron does this every minute; this route is the same step on
// demand, for environments without a worker and for a "Publish overdue"
// action.
import { publishDueBrandPosts } from "@launchstack/pipelines/marketing/posts";

import { brandContext, handleBrandError, json } from "../../_http";

export async function POST() {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const result = await publishDueBrandPosts({ companyId: auth.ctx.companyId });
        return json({
            published: result.published,
            failed: result.failed,
            skipped: result.skipped,
        });
    } catch (err) {
        return handleBrandError("POST publish-due", err);
    }
}
