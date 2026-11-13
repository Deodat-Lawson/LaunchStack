// POST /api/marketing-pipeline/runs — queue a post-writer run: { platform, prompt, … }
//   → 202 { run }. The run executes off the request (see server/marketing/executor.ts);
//   the screen polls GET /api/marketing-pipeline/runs/[id].
// GET  /api/marketing-pipeline/runs — this member's unfinished runs and recent
//   completedRuns, so returning after completion can recover the draft too.
import { MarketingPipelineInputSchema } from "@launchstack/pipelines/marketing";
import {
    createMarketingRun,
    listActiveMarketingRuns,
    listCompletedMarketingRuns,
} from "@launchstack/pipelines/marketing/runs";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireBetaAppContext } from "~/server/beta-apps";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";
import { fail, ok, readJson } from "~/server/api/responses";
import { dispatchMarketingRun } from "~/server/marketing/executor";
import { toRunView } from "~/server/marketing/run-view";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const locale = localeOfRequest(request);
    try {
        const ctx = await requireBetaAppContext();
        if (!ctx.success) return ctx.response;
        const refused = await refuseAtAiAllowance(ctx.data.companyId, ctx.data.authUserId, locale);
        if (refused) return refused;
        const validation = MarketingPipelineInputSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return fail(translatorFor(locale, "errors.api")("invalidInput"), 400, {
                errors: validation.error.flatten(),
            });
        }
        const debug = new URL(request.url).searchParams.get("debug") === "true";
        const run = await createMarketingRun({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            input: validation.data,
            debug,
        });
        await dispatchMarketingRun(run);
        return ok({ run: toRunView(run, 0, locale) }, 202);
    } catch (error) {
        console.error("[marketing-run] POST error:", error);
        return fail(translatorFor(locale, "growth.server.marketing")("runStartFailed"), 500);
    }
}

export async function GET(request: Request) {
    const locale = localeOfRequest(request);
    try {
        const ctx = await requireBetaAppContext();
        if (!ctx.success) return ctx.response;
        const [runs, completedRuns] = await Promise.all([
            listActiveMarketingRuns(ctx.data.companyId, ctx.data.authUserId),
            listCompletedMarketingRuns(ctx.data.companyId, ctx.data.authUserId),
        ]);
        // The list carries no events; the poll of one run replays them.
        return ok({
            runs: runs.map(run => toRunView(run, run.events.length, locale)),
            completedRuns: completedRuns.map(run => toRunView(run, run.events.length, locale)),
        });
    } catch (error) {
        console.error("[marketing-run] GET error:", error);
        return fail(translatorFor(locale, "growth.server.marketing")("runListFailed"), 500);
    }
}
