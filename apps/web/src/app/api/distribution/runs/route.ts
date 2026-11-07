// GET  /api/distribution/runs?programId= — list discovery runs
// POST /api/distribution/runs — enqueue a run { programId, options? }
//
// The route creates the row and sends the event; the worker does the work.
// A credits pre-check covers the minimum (plan + score); candidates are
// debited one by one after their research completes.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { RunOptionsSchema } from "@launchstack/pipelines/distribution/types";
import { createRun, getProgram, getRun, listRuns } from "@launchstack/pipelines/distribution/db";
import { hasTokens } from "~/lib/credits";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { isMeteringEnforced } from "~/server/deployment";
import { error, json, readJsonBody } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";
import { runFixtureDistribution } from "~/server/distribution/fixture-run";
import { inngest } from "~/server/inngest/client";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";

const api = (request: Request) => requestTranslator(request, "errors.api");
const growth = (request: Request) => requestTranslator(request, "growth.server.errors");

const CreateRunSchema = z.object({
    programId: z.string().min(1),
    options: RunOptionsSchema.partial().optional(),
});

/** Credits the run needs before it starts: planning plus the first candidate. */
const RUN_MINIMUM_CREDITS = 3_000;

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const programId = request.nextUrl.searchParams.get("programId") ?? undefined;
        const runs = await listRuns(ctx.data.companyId, { programId, limit: 50 });
        return json({ runs });
    } catch (err) {
        return distributionRouteError("GET runs", err, request);
    }
}

export async function POST(request: NextRequest) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const refused = await refuseAtAiAllowance(
        ctx.data.companyId,
        ctx.data.authUserId,
        localeOfRequest(request)
    );
    if (refused) return refused;

    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `distribution-run:${ctx.data.authUserId}`,
        },
        async () => {
            try {
                const parsed = CreateRunSchema.safeParse(await readJsonBody(request));
                if (!parsed.success)
                    return error(api(request)("validationFailed"), 400, {
                        details: parsed.error.flatten(),
                    });
                const program = await getProgram(parsed.data.programId, ctx.data.companyId);
                if (!program) return error(growth(request)("programNotFound"), 404);
                if (program.status !== "active")
                    return error(growth(request)("programArchived"), 409);

                const requestedMode = parsed.data.options?.mode ?? "live";
                if (requestedMode === "live" && isMeteringEnforced()) {
                    const sufficient = await hasTokens(ctx.data.companyId, RUN_MINIMUM_CREDITS);
                    if (!sufficient) {
                        return NextResponse.json(
                            {
                                error: growth(request)("insufficientCredits"),
                                code: "insufficient_credits",
                                required: RUN_MINIMUM_CREDITS,
                            },
                            { status: 402 }
                        );
                    }
                }

                const options = RunOptionsSchema.parse(parsed.data.options ?? {});
                const run = await createRun({
                    companyId: ctx.data.companyId,
                    programId: program.id,
                    userId: ctx.data.authUserId,
                    options,
                });

                // Fixture mode: deterministic stand-ins for every provider, executed
                // inline so the caller gets a finished run back. No keys, no credits.
                if (options.mode === "fixture") {
                    try {
                        await runFixtureDistribution({
                            runId: run.id,
                            companyId: ctx.data.companyId,
                            programId: program.id,
                            userId: ctx.data.authUserId,
                            requestUrl: request.url,
                        });
                    } catch (fixtureError) {
                        console.error("[distribution] fixture run failed:", fixtureError);
                    }
                    const finished = await getRun(run.id, ctx.data.companyId);
                    return json({ run: finished ?? run }, 201);
                }

                await inngest.send({
                    name: "distribution/run.requested",
                    data: {
                        runId: run.id,
                        programId: program.id,
                        companyId: ctx.data.companyId.toString(),
                        userId: ctx.data.authUserId,
                        requestUrl: request.url,
                    },
                });
                return json({ run }, 202);
            } catch (err) {
                return distributionRouteError("POST runs", err, request);
            }
        }
    );
}
