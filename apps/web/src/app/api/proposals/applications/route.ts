// GET  /api/proposals/applications — every application, newest first
// POST /api/proposals/applications — { title, funder?, deadline?, opportunityId?, requestText? | requestUrl? | requestDocumentId? }
//      Creates the application and, when there is a request to read, queues its extraction.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { loadApplications, newApplication } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../_http";

const NewApplicationSchema = z.object({
    title: z.string().max(512).default(""),
    funder: z.string().max(256).optional().nullable(),
    deadline: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    opportunityId: z.string().max(64).optional().nullable(),
    requestText: z.string().max(200_000).optional().nullable(),
    requestUrl: z.string().url().max(2_000).optional().nullable(),
    requestDocumentId: z.number().int().positive().optional().nullable(),
});

export async function GET() {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        return json({ applications: await loadApplications(auth.ctx) });
    } catch (err) {
        return handleProposalsError("GET applications", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    return withRateLimit(
        request,
        {
            maxRequests: 30,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `proposals-apps:${ctx.userId}`,
        },
        async () => {
            try {
                const parsed = NewApplicationSchema.safeParse(await readBody(request));
                if (!parsed.success) return error("Check the application and try again", 400);
                const input = parsed.data;
                if (
                    !input.title.trim() &&
                    !input.opportunityId &&
                    !input.requestText &&
                    !input.requestUrl
                )
                    return error(
                        "Give the application a title, or paste the funder's request",
                        400
                    );
                return json(await newApplication(ctx, input), 201);
            } catch (err) {
                return handleProposalsError("POST applications", err);
            }
        }
    );
}
