// GET  /api/prospects/segments — the workspace's segments (Distribution programs today)
// POST /api/prospects/segments — { name, offering, industries[], countries[] }
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createSegment, listSegments } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../_http";

const NewSegmentSchema = z.object({
    name: z.string().min(1).max(256),
    offering: z.string().min(1).max(4000),
    industries: z.array(z.string().min(1).max(128)).max(20).default([]),
    countries: z.array(z.string().length(2)).min(1).max(20),
});

export async function GET() {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ segments: await listSegments(auth.ctx) });
    } catch (err) {
        return handleProspectsError("GET segments", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = NewSegmentSchema.safeParse(await readBody(request));
        if (!parsed.success)
            return error("Name, what you sell and at least one country are required", 400);
        return json({ segment: await createSegment(auth.ctx, parsed.data) }, 201);
    } catch (err) {
        return handleProspectsError("POST segments", err);
    }
}
