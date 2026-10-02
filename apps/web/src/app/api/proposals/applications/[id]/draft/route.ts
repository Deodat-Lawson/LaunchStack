// POST /api/proposals/applications/[id]/draft — { sectionIds? } queue drafting: the named sections, or every empty one
import type { NextRequest } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { draftRun } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../../_http";

const Schema = z.object({ sectionIds: z.array(z.string().min(1).max(64)).max(40).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 30,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `proposals-draft:${ctx.userId}`,
        },
        async () => {
            try {
                const { id } = await params;
                const parsed = Schema.safeParse(await readBody(request));
                if (!parsed.success) return error("Check the sections and try again", 400);
                return json({ run: await draftRun(ctx, id, parsed.data.sectionIds) }, 202);
            } catch (err) {
                return handleProposalsError("POST draft", err);
            }
        }
    );
}
