// GET   /api/proposals/profile — the organisation profile with its evidence
// POST  /api/proposals/profile — build (or rebuild) it from the workspace's sources
// PATCH /api/proposals/profile — { key, label?, value } edit one fact by hand
import type { NextRequest } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { buildProfile, editProfileFact, loadProfile } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../_http";

const FactSchema = z.object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(120).optional(),
    value: z.string().max(2_000),
});

export async function GET() {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ profile: await loadProfile(auth.ctx) });
    } catch (err) {
        return handleProposalsError("GET profile", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 6,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `proposals-profile:${ctx.userId}`,
        },
        async () => {
            try {
                return json({ run: await buildProfile(ctx) }, 202);
            } catch (err) {
                return handleProposalsError("POST profile", err);
            }
        }
    );
}

export async function PATCH(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = FactSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("A fact needs a key and a value", 400);
        return json({ profile: await editProfileFact(auth.ctx, parsed.data) });
    } catch (err) {
        return handleProposalsError("PATCH profile", err);
    }
}
