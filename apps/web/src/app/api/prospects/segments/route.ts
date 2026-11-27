// GET  /api/prospects/segments — the workspace's segments (Distribution programs today)
// POST /api/prospects/segments — { name, offering, industries[], countries[]?, places[]? }
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fitSegmentName, segmentLimitProblems } from "~/lib/prospects/segment-limits";
import { createSegment, listSegments } from "~/server/prospects/service";

import {
    error,
    handleProspectsError,
    json,
    prospectsContext,
    prospectsT,
    readBody,
} from "../_http";

/**
 * The shape only. How long each answer may be is checked after, by
 * `segmentLimitProblems`, so a refusal names the answer that is too long
 * instead of saying something is missing.
 */
const NewSegmentSchema = z.object({
    name: z.string(),
    offering: z.string(),
    industries: z.array(z.string()).default([]),
    countries: z.array(z.string().length(2)).max(20).optional(),
    /** "Baltimore, MD, USA", "Netherlands": parsed into territories on the server. */
    places: z.array(z.string()).optional(),
});

const filled = (items: readonly string[] | undefined) =>
    items?.map(item => item.trim()).filter(Boolean);

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
        const t = prospectsT(request);
        const parsed = NewSegmentSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(t("newSegmentRequired"), 400);
        const input = {
            // Made from the answers: cut to fit, never a reason to refuse them.
            name: fitSegmentName(parsed.data.name),
            offering: parsed.data.offering.trim(),
            industries: filled(parsed.data.industries) ?? [],
            countries: parsed.data.countries,
            places: filled(parsed.data.places),
        };
        if (!input.name || !input.offering) return error(t("newSegmentRequired"), 400);
        const [problem] = segmentLimitProblems(input);
        if (problem)
            return error(t(problem.key, { count: problem.count, max: problem.max }), 400, {
                field: problem.field,
            });
        if ((input.countries?.length ?? 0) + (input.places?.length ?? 0) === 0)
            return error(t("sayWhere"), 400, { field: "places" });
        return json({ segment: await createSegment(auth.ctx, input) }, 201);
    } catch (err) {
        return handleProspectsError("POST segments", err, request);
    }
}
