// GET  /api/proposals/funders?status= — found and saved funders, best fit first
// POST /api/proposals/funders — add one by hand: { title, funder, url?, summary?, closesOn?, amountMin?, amountMax? }
import type { NextRequest } from "next/server";
import { z } from "zod";

import { describeGrantSources } from "@launchstack/tools/grant-search";
import { OPPORTUNITY_STATUSES } from "@launchstack/pipelines/proposals/types";

import { addFunder, loadFunders } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../_http";

const NewFunderSchema = z.object({
    title: z.string().min(1).max(512),
    funder: z.string().min(1).max(256),
    url: z.string().url().max(2_000).optional().nullable(),
    summary: z.string().max(4_000).optional().nullable(),
    closesOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    amountMin: z.number().nonnegative().optional().nullable(),
    amountMax: z.number().nonnegative().optional().nullable(),
});

export async function GET(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const raw = request.nextUrl.searchParams.get("status");
        const status =
            raw && (OPPORTUNITY_STATUSES as readonly string[]).includes(raw)
                ? (raw as (typeof OPPORTUNITY_STATUSES)[number])
                : undefined;
        return json({
            funders: await loadFunders(auth.ctx, status),
            sources: describeGrantSources(),
        });
    } catch (err) {
        return handleProposalsError("GET funders", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = NewFunderSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("A funder needs a title and a name", 400);
        return json({ funder: await addFunder(auth.ctx, parsed.data) }, 201);
    } catch (err) {
        return handleProposalsError("POST funders", err);
    }
}
