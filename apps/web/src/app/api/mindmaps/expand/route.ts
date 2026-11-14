/**
 * "Expand with AI" — subtopics for one topic of a map open in the editor.
 *
 * The editor sends the branch's words, not the document: where the topic
 * sits (centre down to it), what is already under it, and the other main
 * branches. The answer is an outline the editor adds under the topic with
 * its own commands, so the change is one ⌘Z and autosave writes it — this
 * route never touches a saved map. Counted under the `mindmap` AI feature and
 * refused at the person's allowance.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { describeChatResolutionFailure } from "~/lib/models";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, validateRequestBody } from "~/lib/validation";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";
import { expandTopicOutline } from "~/server/mindmap/generate";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export const runtime = "nodejs";
export const maxDuration = 60;

const words = z.string().trim().max(300);

const ExpandSchema = z.object({
    title: words,
    path: z.array(words).min(1).max(12),
    existing: z.array(words).max(60).default([]),
    siblings: z.array(words).max(30).default([]),
    depth: z.union([z.literal(1), z.literal(2)]).default(1),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.standard, () => handle(request));
}

async function handle(request: Request) {
    const t = requestTranslator(request, "mindmap.server.errors");
    const locale = localeOfRequest(request);
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, ExpandSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const refused = await refuseAtAiAllowance(ctx.data.companyId, ctx.data.authUserId, locale);
        if (refused) return refused;

        try {
            const outline = await withWorkspaceChatModels(
                ctx.data.companyId,
                { feature: "mindmap", userId: ctx.data.authUserId },
                () =>
                    expandTopicOutline({
                        title: body.title,
                        path: body.path,
                        existing: body.existing ?? [],
                        siblings: body.siblings ?? [],
                        depth: body.depth ?? 1,
                    })
            );
            return NextResponse.json({ outline }, { status: 200 });
        } catch (error) {
            const described = describeChatResolutionFailure(error, locale);
            if (described.status !== 500) {
                return NextResponse.json(
                    { error: described.message },
                    { status: described.status }
                );
            }
            console.error("[mindmaps] expand: the model call failed:", error);
            return NextResponse.json({ error: t("expandFailed") }, { status: 502 });
        }
    } catch (error) {
        console.error("[mindmaps] expand failed:", error);
        return serverError(t("expandFailed"));
    }
}
