// POST /api/marketing-pipeline/runs — queue a post-writer run: { platform, prompt, … }
//   → 202 { run }. The run executes off the request (see server/marketing/executor.ts);
//   the screen polls GET /api/marketing-pipeline/runs/[id].
// GET  /api/marketing-pipeline/runs — this member's unfinished runs, so a reload
//   (or another tab) picks up the one in progress instead of starting over.
import { MarketingPipelineInputSchema } from "@launchstack/pipelines/marketing";
import { createMarketingRun, listActiveMarketingRuns } from "@launchstack/pipelines/marketing/runs";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { fail, ok, readJson } from "~/server/api/responses";
import { dispatchMarketingRun } from "~/server/marketing/executor";
import { toRunView } from "~/server/marketing/run-view";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const validation = MarketingPipelineInputSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return fail("Invalid input", 400, { errors: validation.error.flatten() });
        }
        const debug = new URL(request.url).searchParams.get("debug") === "true";
        const run = await createMarketingRun({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            input: validation.data,
            debug,
        });
        await dispatchMarketingRun(run);
        return ok({ run: toRunView(run) }, 202);
    } catch (error) {
        console.error("[marketing-run] POST error:", error);
        return fail("Failed to start the marketing pipeline", 500);
    }
}

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const runs = await listActiveMarketingRuns(ctx.data.companyId, ctx.data.authUserId);
        // The list carries no events; the poll of one run replays them.
        return ok({ runs: runs.map(run => ({ ...toRunView(run, run.events.length) })) });
    } catch (error) {
        console.error("[marketing-run] GET error:", error);
        return fail("Failed to list marketing pipeline runs", 500);
    }
}
