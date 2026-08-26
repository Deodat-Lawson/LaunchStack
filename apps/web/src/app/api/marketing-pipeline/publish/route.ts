import { z } from "zod";
import { MarketingPlatformEnum } from "@launchstack/pipelines/marketing";
import { markContentPublished, publishContent } from "@launchstack/pipelines/marketing";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";

export const runtime = "nodejs";
export const maxDuration = 30;

const PublishSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1).max(5000),
    title: z.string().max(300).optional(),
});

export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = PublishSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return fail("Invalid input", 400, { errors: validation.error.flatten() });
        }

        const { platform, message, title } = validation.data;
        const result = await publishContent(platform, message, title);

        if (!result.success) {
            return fail(result.error ?? "Publish failed", 502, { platform });
        }

        // Record the publish against the matching history row (fire-and-forget:
        // a failed write-back must not fail a post that already went out).
        const companyId = Number(ctx.data.companyId);
        if (!Number.isNaN(companyId)) {
            void markContentPublished({
                companyId,
                platform,
                message,
                postId: result.postId,
                postUrl: result.postUrl,
            }).catch(err =>
                console.warn("[marketing-pipeline/publish] history write-back failed:", err)
            );
        }

        return ok({ platform, postUrl: result.postUrl });
    } catch (error) {
        return handleRouteError("marketing-pipeline/publish", error);
    }
}
