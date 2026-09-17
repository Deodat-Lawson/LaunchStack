// GET  /api/prospects/runs?segmentId=
// POST /api/prospects/runs — { segmentId, sample?: boolean }
//
// Same path as Distribution's runs route: a live run is queued to the worker
// after a credits pre-check; a sample run executes inline over fixture
// providers and comes back finished.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { RunOptionsSchema } from "@launchstack/pipelines/distribution/types";
import { createRun, getProgram, getRun } from "@launchstack/pipelines/distribution/db";
import { hasTokens } from "~/lib/credits";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { isMeteringEnforced } from "~/server/deployment";
import { runFixtureDistribution } from "~/server/distribution/fixture-run";
import { inngest } from "~/server/inngest/client";
import { toRunDto } from "~/server/prospects/adapter";
import { listRunDtos } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../_http";

const Schema = z.object({ segmentId: z.string().min(1), sample: z.boolean().optional() });
const RUN_MINIMUM_CREDITS = 3_000;

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const segmentId = request.nextUrl.searchParams.get("segmentId");
        if (!segmentId) return error("segmentId is required", 400);
        return json({ runs: await listRunDtos(auth.ctx, segmentId) });
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

                const mode = parsed.data.sample ? "fixture" : "live";
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
                const run = await createRun({
                    companyId: ctx.companyId,
                    programId: program.id,
                    userId: ctx.userId,
                    options,
                });
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
