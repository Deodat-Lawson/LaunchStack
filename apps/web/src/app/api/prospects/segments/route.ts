// GET  /api/prospects/segments — the workspace's segments (Distribution programs today)
// POST /api/prospects/segments — { name, offering, industries[], countries[]?, places[]? }
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createSegment, listSegments } from "~/server/prospects/service";

import {
    error,
    handleProspectsError,
    json,
    prospectsContext,
    prospectsT,
    readBody,
} from "../_http";

const NewSegmentSchema = z
    .object({
        name: z.string().min(1).max(256),
        offering: z.string().min(1).max(4000),
        industries: z.array(z.string().min(1).max(128)).max(20).default([]),
        countries: z.array(z.string().length(2)).max(20).optional(),
        /** "Baltimore, MD, USA", "Netherlands": parsed into territories on the server. */
        places: z.array(z.string().min(1).max(200)).max(20).optional(),
    })
    .refine(v => (v.countries?.length ?? 0) + (v.places?.length ?? 0) > 0, {
        message: "Say where to look",
    });

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ segments: await listSegments(auth.ctx) });
    } catch (err) {
        return handleProspectsError("GET segments", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = NewSegmentSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(prospectsT(request)("newSegmentRequired"), 400);
        return json({ segment: await createSegment(auth.ctx, parsed.data) }, 201);
    } catch (err) {
        return handleProspectsError("POST segments", err, request);
    }
}
