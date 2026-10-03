// POST /api/proposals/applications/[id]/sections/[sectionId]/rewrite — { preset, instruction? } queue a rewrite
import type { NextRequest } from "next/server";
import { z } from "zod";

import { RewritePresetSchema } from "@launchstack/pipelines/proposals/types";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { rewriteRun } from "~/server/proposals/service";

import {
    error,
    handleProposalsError,
    json,
    proposalsContext,
    readBody,
} from "../../../../../_http";

const Schema = z.object({
    preset: RewritePresetSchema,
    instruction: z.string().max(600).optional(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 40,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `proposals-rewrite:${ctx.userId}`,
        },
        async () => {
            try {
                const { id, sectionId } = await params;
                const parsed = Schema.safeParse(await readBody(request));
                if (!parsed.success) return error("Pick a rewrite or say what to change", 400);
                return json({ run: await rewriteRun(ctx, id, sectionId, parsed.data) }, 202);
            } catch (err) {
                return handleProposalsError("POST rewrite", err);
            }
        }
    );
}
