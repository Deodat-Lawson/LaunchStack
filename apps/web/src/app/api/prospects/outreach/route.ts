// POST /api/prospects/outreach — { personIds?: string[], companyIds?: string[] }
// Drafts ONE campaign in the email vertical; nothing is sent from here.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { draftOutreach } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../_http";

const Schema = z.object({
    personIds: z.array(z.string().min(1)).max(100).optional(),
    companyIds: z.array(z.string().min(1)).max(50).optional(),
});

export async function POST(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `prospects-outreach:${auth.ctx.userId}`,
        },
        async () => {
            try {
                const parsed = Schema.safeParse(await readBody(request));
                if (!parsed.success) return error("Validation failed", 400);
                return json(await draftOutreach(auth.ctx, parsed.data), 201);
            } catch (err) {
                return handleProspectsError("POST outreach", err);
            }
        }
    );
}
