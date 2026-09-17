// PATCH /api/prospects/deals/[id] — { stage?, ownerName?, nextStep?, nextStepAt? }
// Illegal moves come back as 409 with a plain-words `reason`.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { patchDeal } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../../_http";

const Schema = z.object({
    stage: z
        .enum([
            "lead",
            "qualified",
            "contacted",
            "meeting",
            "proposal",
            "negotiating",
            "won",
            "lost",
            "nurture",
        ])
        .optional(),
    ownerName: z.string().max(256).nullable().optional(),
    nextStep: z.string().max(1000).nullable().optional(),
    nextStepAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = Schema.safeParse(await readBody(request));
        if (!parsed.success)
            return error("Validation failed", 400, { details: parsed.error.flatten() });
        return json({ deal: await patchDeal(auth.ctx, id, parsed.data) });
    } catch (err) {
        return handleProspectsError("PATCH deal", err);
    }
}
