// GET  /api/brand/posts?from=&to=&status= — the calendar's rows
// POST /api/brand/posts — compose: { platforms, body, title?, scheduledAt?, publishNow? }
//
// Scheduled posts go out from the worker's scheduler, the one place that
// publishes on a timer (ADR-003). This route only stores and, on request,
// publishes now with the workspace's own credentials.
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
    BRAND_POST_STATUSES,
    MarketingPlatformEnum,
    createBrandPosts,
    listBrandPosts,
    publishBrandPost,
} from "@launchstack/pipelines/marketing/posts";

import { publishForWorkspace } from "~/server/brand/publish";

import { brandContext, error, handleBrandError, json, readBody } from "../_http";

const DAY = 86_400_000;

const CreateSchema = z.object({
    platforms: z.array(MarketingPlatformEnum).min(1).max(4),
    body: z.string().min(1).max(40_000),
    title: z.string().max(300).optional().nullable(),
    scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
    publishNow: z.boolean().optional(),
    source: z
        .object({ kind: z.enum(["compose", "campaign"]), historyId: z.number().int().optional() })
        .optional(),
});

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
        const posts = await listBrandPosts({ companyId: auth.ctx.companyId, from, to, statuses });
        return json({ posts, now: now.toISOString() });
    } catch (err) {
        return handleBrandError("GET posts", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = CreateSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Check the post and try again", 400);
        const input = parsed.data;
        const scheduledAt = input.publishNow ? null : parseDate(input.scheduledAt ?? null);
        if (!input.publishNow && input.scheduledAt && !scheduledAt)
            return error("That schedule time is not a date", 400);
        const created = await createBrandPosts({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            platforms: input.platforms,
            body: input.body,
            title: input.title ?? null,
            scheduledAt: scheduledAt ?? null,
            source: input.source ?? { kind: "compose" },
        });
        if (!input.publishNow) return json({ posts: created }, 201);
        const posts = [];
        for (const post of created)
            posts.push(
                await publishBrandPost(post.id, auth.ctx.companyId, {
                    publish: publishForWorkspace,
                })
            );
        return json({ posts }, 201);
    } catch (err) {
        return handleBrandError("POST posts", err);
    }
}
