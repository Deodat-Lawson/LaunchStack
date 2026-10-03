// GET  /api/prospects/runs?segmentId=
// POST /api/prospects/runs — { segmentId, sample?: boolean, mode?: "auto" | "sample" | "live" | "keyless" }
//
// Live and keyless runs are queued to the worker after a credits pre-check
// (live only) and come back 202; the UI polls the run row as the worker
// advances it. A sample run executes inline over fixture providers and comes
// back finished, so a manual tester or CI gets a whole run from one POST.
// One run per segment at a time: a second POST while one is in flight is a
// 409, enforced by a partial unique index rather than a check.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { RunOptionsSchema } from "@launchstack/pipelines/distribution/types";
import {
    RunInProgressError,
    createRun,
    getProgram,
    getRun,
} from "@launchstack/pipelines/distribution/db";
import { hasTokens } from "~/lib/credits";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { isMeteringEnforced } from "~/server/deployment";
import { runFixtureDistribution } from "~/server/distribution/fixture-run";
import { inngest } from "~/server/inngest/client";
import { toRunDto } from "~/server/prospects/adapter";
import { recordRunFinished } from "~/server/prospects/metrics";
import { pickRunMode, readRunEnvironment } from "~/server/prospects/run-mode";
import { getActiveRun, listRunDtos } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../_http";

const Schema = z.object({
    segmentId: z.string().min(1),
    /** Shorthand for mode "sample". */
    sample: z.boolean().optional(),
    /** "auto" picks live when a model and a search provider are configured, else keyless. */
    mode: z.enum(["auto", "sample", "live", "keyless"]).optional(),
});
const RUN_MINIMUM_CREDITS = 3_000;

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const segmentId = request.nextUrl.searchParams.get("segmentId");
        if (!segmentId) return error("segmentId is required", 400);
        const [runs, active] = await Promise.all([
            listRunDtos(auth.ctx, segmentId),
            getActiveRun(auth.ctx, segmentId),
        ]);
        return json({
            runs,
            active,
            // What "Find companies" will do next in this environment.
            nextMode: pickRunMode("auto", readRunEnvironment(process.env)),
        });
    } catch (err) {
        return handleProspectsError("GET runs", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `prospects-run:${ctx.userId}`,
        },
        async () => {
            try {
                const parsed = Schema.safeParse(await readBody(request));
                if (!parsed.success) return error("segmentId is required", 400);
                const program = await getProgram(parsed.data.segmentId, ctx.companyId);
                if (!program) return error("Segment not found", 404);
                if (program.status !== "active")
                    return error("Confirm the segment before running", 409);

                const requested = parsed.data.sample ? "sample" : (parsed.data.mode ?? "auto");
                const mode = pickRunMode(requested, readRunEnvironment(process.env));
                if (mode === "live" && isMeteringEnforced()) {
                    const sufficient = await hasTokens(ctx.companyId, RUN_MINIMUM_CREDITS);
                    if (!sufficient)
                        return NextResponse.json(
                            {
                                error: "Not enough credits to start a run",
                                code: "insufficient_credits",
                                required: RUN_MINIMUM_CREDITS,
                            },
                            { status: 402 }
                        );
                }
                const options = RunOptionsSchema.parse({ mode });
                let run;
                try {
                    run = await createRun({
                        companyId: ctx.companyId,
                        programId: program.id,
                        userId: ctx.userId,
                        options,
                    });
                } catch (createError) {
                    if (createError instanceof RunInProgressError)
                        return error(createError.message, 409, { code: createError.code });
                    throw createError;
                }
                if (mode === "fixture") {
                    try {
                        await runFixtureDistribution({
                            runId: run.id,
                            companyId: ctx.companyId,
                            programId: program.id,
                            userId: ctx.userId,
                            requestUrl: request.url,
                        });
                    } catch (fixtureError) {
                        console.error("[prospects] sample run failed:", fixtureError);
                    }
                    const finished = await getRun(run.id, ctx.companyId);
                    recordRunFinished(
                        "fixture",
                        finished?.status === "failed" ? "failed" : "completed",
                        finished
                    );
                    return json({ run: toRunDto(finished ?? run) }, 201);
                }
                await inngest.send({
                    name: "distribution/run.requested",
                    data: {
                        runId: run.id,
                        programId: program.id,
                        companyId: ctx.companyId.toString(),
                        userId: ctx.userId,
                        requestUrl: request.url,
                    },
                });
                return json({ run: toRunDto(run) }, 202);
            } catch (err) {
                return handleProspectsError("POST runs", err);
            }
        }
    );
}
