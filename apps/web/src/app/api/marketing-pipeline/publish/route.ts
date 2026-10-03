import { z } from "zod";
import { MarketingPlatformEnum } from "@launchstack/pipelines/marketing";
import { markContentPublished } from "@launchstack/pipelines/marketing";
import { createBrandPosts, publishBrandPost } from "@launchstack/pipelines/marketing/posts";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";
import { defaultChannelFor, NETWORK_LABELS } from "~/server/brand/accounts";
import { publishForWorkspace } from "~/server/brand/publish";

export const runtime = "nodejs";
export const maxDuration = 30;

const PublishSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1).max(5000),
    title: z.string().max(300).optional(),
});

/**
 * The campaign generator's Publish button. It goes through Brand like
 * everything else that speaks as the company: the workspace's own account
 * for the network (a Page first), the deployment's only when the workspace
 * has none, the same permission, and a row on the Brand calendar.
 */
export async function POST(request: Request) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        if (!ctx.data.can("social.publish")) {
            return fail("Your role can read Brand but not post as the company.", 403);
        }

        const validation = PublishSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return fail("Invalid input", 400, { errors: validation.error.flatten() });
        }

        const { platform, message, title } = validation.data;
        const channel = await defaultChannelFor(ctx.data.companyId, platform);
        if (!channel) {
            // LinkedIn and Bluesky are connected per workspace; X and Reddit
            // only through the operator's deployment-wide keys.
            const perWorkspace = platform === "linkedin" || platform === "bluesky";
            return fail(
                perWorkspace
                    ? `Nothing can post to ${NETWORK_LABELS[platform]} yet. Connect it under Growth › Brand › Accounts.`
                    : `${NETWORK_LABELS[platform]} is set up by the operator for the whole deployment, and this deployment has no ${NETWORK_LABELS[platform]} key yet.`,
                400,
                { platform }
            );
        }
        const [created] = await createBrandPosts({
            companyId: ctx.data.companyId,
            userId: ctx.data.authUserId,
            targets: [{ platform, channelId: channel.id }],
            body: message,
            title: title ?? null,
            source: { kind: "campaign" },
        });
        const post = await publishBrandPost(created!.id, ctx.data.companyId, {
            publish: publishForWorkspace,
        });

        if (post.status !== "published") {
            return fail(post.error ?? "Publish failed", 502, { platform });
        }

        // Record the publish against the matching history row (fire-and-forget:
        // a failed write-back must not fail a post that already went out).
        const companyId = Number(ctx.data.companyId);
        if (!Number.isNaN(companyId)) {
            void markContentPublished({
                companyId,
                platform,
                message,
                postId: post.postId ?? undefined,
                postUrl: post.postUrl ?? undefined,
            }).catch(err =>
                console.warn("[marketing-pipeline/publish] history write-back failed:", err)
            );
        }

        return ok({ platform, postUrl: post.postUrl, channel: channel.name });
    } catch (error) {
        return handleRouteError("marketing-pipeline/publish", error);
    }
}
