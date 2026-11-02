// POST /api/prospects/outreach — { personIds?: string[], companyIds?: string[] }
// Drafts ONE campaign in the email vertical; nothing is sent from here.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { draftOutreach } from "~/server/prospects/service";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

import { error, handleProspectsError, json, prospectsContext, readBody } from "../_http";

const Schema = z.object({
    personIds: z.array(z.string().min(1)).max(100).optional(),
    companyIds: z.array(z.string().min(1)).max(50).optional(),
});

export async function POST(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    const aiUse = { feature: "prospects", userId: auth.ctx.userId } as const;
    const refused = await refuseAtAiAllowance(
        auth.ctx.companyId,
        aiUse.userId,
        localeOfRequest(request)
    );
    if (refused) return refused;
    // The campaign is drafted with the workspace's own models if it brought them.
    return withWorkspaceChatModels(auth.ctx.companyId, aiUse, () =>
        withRateLimit(
            request,
            {
                maxRequests: 10,
                windowMs: 15 * 60 * 1000,
                keyGenerator: () => `prospects-outreach:${auth.ctx.userId}`,
            },
            async () => {
                try {
                    const parsed = Schema.safeParse(await readBody(request));
                    if (!parsed.success)
                        return error(
                            requestTranslator(request, "errors.api")("validationFailed"),
                            400
                        );
                    return json(await draftOutreach(auth.ctx, parsed.data), 201);
                } catch (err) {
                    return handleProspectsError("POST outreach", err, request);
                }
            }
        )
    );
}
