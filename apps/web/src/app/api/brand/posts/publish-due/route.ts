// POST /api/brand/posts/publish-due — publish this workspace's overdue posts now
//
// The worker's scheduler does this every minute; this is the same step on
// demand, behind an explicit "Publish overdue" action. The claim inside
// publishBrandPost keeps the two from ever posting twice.
import { publishDueBrandPosts } from "@launchstack/pipelines/marketing/posts";

import { publishForWorkspace } from "~/server/brand/publish";

import { brandContext, handleBrandError, json } from "../../_http";

export async function POST() {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const result = await publishDueBrandPosts({
            companyId: auth.ctx.companyId,
            publish: publishForWorkspace,
        });
        return json({
            published: result.published,
            failed: result.failed,
            retrying: result.retrying,
            skipped: result.skipped,
        });
    } catch (err) {
        return handleBrandError("POST publish-due", err);
    }
}
