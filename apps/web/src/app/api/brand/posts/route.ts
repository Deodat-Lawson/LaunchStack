// GET  /api/brand/posts?from=&to=&status= — the calendar's rows
// POST /api/brand/posts — compose: { channels, body, title?, media?, scheduledAt?, publishNow?, postTestId? }
//   (with `postTestId`, a finished post test of the same text is linked to the
//   new posts for Brand's track record; the answer then carries `postTest`)
//   (a deployment account is a channel too: `deployment:<network>`, offered
//   only to the workspace that owns the deployment keys, and only while it
//   has no account of its own on that network — see deployment-accounts.ts)
//
// A dev environment has no worker to run the scheduler, so after answering a
// list request that shows something due, the web process runs the same
// claim-and-publish the worker's cron does. The claim keeps both safe.
import { after } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
    BRAND_POST_STATUSES,
    createBrandPosts,
    hasDueBrandPosts,
    listBrandPosts,
    publishBrandPost,
    publishDueBrandPosts,
    type BrandPostTarget,
} from "@launchstack/pipelines/marketing/posts";

import { localeOfRequest } from "~/i18n/server";
import type { PostTestLink } from "~/lib/scenarios/types";
import { listBrandChannels } from "~/server/brand/accounts";
import { getBrandMediaRows, networkMediaProblem } from "~/server/brand/media";
import { toPostViews } from "~/server/brand/post-views";
import { publishForWorkspace } from "~/server/brand/publish";
import { brandReason } from "~/server/brand/words";
import { linkComposedPosts } from "~/server/scenarios/service";

import {
    brandContext,
    brandPublishContext,
    brandT,
    error,
    handleBrandError,
    json,
    readBody,
} from "../_http";

const DAY = 86_400_000;

const CreateSchema = z.object({
    channels: z.array(z.string().min(1).max(80)).min(1).max(20),
    body: z.string().min(1).max(40_000),
    title: z.string().max(300).optional().nullable(),
    media: z
        .array(
            z.object({
                id: z.string().min(1).max(64),
                alt: z.string().max(1000).nullable().optional(),
            })
        )
        .max(4)
        .optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
    publishNow: z.boolean().optional(),
    source: z
        .object({
            kind: z.enum(["compose", "campaign"]),
            historyId: z.number().int().optional(),
        })
        .optional(),
    /** A finished "Test this post" run; linked when the body is the tested text. */
    postTestId: z.number().int().positive().optional(),
});

/** Link the composed posts to their post test. Never fails the compose. */
async function linkTest(
    ctx: { companyId: bigint; userId: string },
    postTestId: number | undefined,
    body: string,
    postIds: string[]
): Promise<{ postTest?: PostTestLink }> {
    if (postTestId === undefined) return {};
    try {
        return {
            postTest: await linkComposedPosts(
                { companyId: ctx.companyId, authUserId: ctx.userId },
                postTestId,
                body,
                postIds
            ),
        };
    } catch (linkError) {
        console.error("[brand] linking a post test failed:", linkError);
        return { postTest: { runId: postTestId, linked: false, stale: false } };
    }
}

function parseDate(value: string | null): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: NextRequest) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const params = request.nextUrl.searchParams;
        const now = new Date();
        const from = parseDate(params.get("from")) ?? new Date(now.getTime() - 14 * DAY);
        const to = parseDate(params.get("to")) ?? new Date(now.getTime() + 42 * DAY);
        const statusParam = params.get("status");
        const statuses = statusParam
            ? statusParam
                  .split(",")
                  .filter((s): s is (typeof BRAND_POST_STATUSES)[number] =>
                      (BRAND_POST_STATUSES as readonly string[]).includes(s)
                  )
            : undefined;
        const records = await listBrandPosts({ companyId: auth.ctx.companyId, from, to, statuses });
        if (await hasDueBrandPosts(auth.ctx.companyId, now)) {
            const companyId = auth.ctx.companyId;
            after(async () => {
                try {
                    await publishDueBrandPosts({
                        companyId,
                        now: new Date(),
                        publish: publishForWorkspace,
                    });
                } catch (dueError) {
                    console.error("[brand] due-check failed:", dueError);
                }
            });
        }
        return json({
            posts: await toPostViews(auth.ctx.companyId, records),
            now: now.toISOString(),
            canPublish: auth.ctx.canPublish,
        });
    } catch (err) {
        return handleBrandError("GET posts", err, request);
    }
}

export async function POST(request: NextRequest) {
    const auth = await brandPublishContext(request);
    if (!auth.ok) return auth.response;
    try {
        const t = brandT(request);
        const locale = localeOfRequest(request);
        const parsed = CreateSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(t("checkPost"), 400);
        const input = parsed.data;
        const scheduledAt = input.publishNow ? null : parseDate(input.scheduledAt ?? null);
        if (!input.publishNow && input.scheduledAt && !scheduledAt)
            return error(t("notADate"), 400);

        // Every channel must be this workspace's, switched on, and able to post.
        const targets: BrandPostTarget[] = [];
        {
            const available = new Map(
                (await listBrandChannels(auth.ctx.companyId, undefined, locale)).map(c => [c.id, c])
            );
            for (const id of new Set(input.channels)) {
                const channel = available.get(id);
                if (!channel) return error(t("channelGone"), 400);
                if (!channel.enabled) return error(t("switchedOff", { name: channel.name }), 400);
                if (channel.status !== "active")
                    return error(
                        channel.statusReason ?? t("needsReconnect", { name: channel.name }),
                        409
                    );
                if (!channel.capabilities.publish)
                    return error(t("cannotPostAs", { name: channel.name }), 400);
                targets.push({ platform: channel.platform, channelId: channel.id });
            }
        }

        const media = input.media ?? [];
        if (media.length > 0) {
            const found = await getBrandMediaRows(
                auth.ctx.companyId,
                media.map(m => m.id)
            );
            if (found.length !== new Set(media.map(m => m.id)).size)
                return error(t("imageMissing"), 400);
            for (const platform of new Set(targets.map(t => t.platform))) {
                const problem = networkMediaProblem(platform, found);
                if (problem) return error(brandReason(problem, locale), 400);
            }
        }

        const created = await createBrandPosts({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            targets,
            body: input.body,
            title: input.title ?? null,
            media: media.map(m => ({ id: m.id, alt: m.alt?.trim() ? m.alt.trim() : null })),
            scheduledAt: scheduledAt ?? null,
            source: input.source ?? { kind: "compose" },
        });
        const link = await linkTest(
            auth.ctx,
            input.postTestId,
            input.body,
            created.map(p => p.id)
        );
        if (!input.publishNow)
            return json({ posts: await toPostViews(auth.ctx.companyId, created), ...link }, 201);
        const posts = [];
        for (const post of created)
            posts.push(
                await publishBrandPost(post.id, auth.ctx.companyId, {
                    publish: publishForWorkspace,
                })
            );
        return json({ posts: await toPostViews(auth.ctx.companyId, posts), ...link }, 201);
    } catch (err) {
        return handleBrandError("POST posts", err, request);
    }
}
