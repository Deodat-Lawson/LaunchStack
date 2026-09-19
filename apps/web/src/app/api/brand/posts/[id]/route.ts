// PATCH  /api/brand/posts/[id] — edit, reschedule, cancel or re-arm a post
// DELETE /api/brand/posts/[id] — remove a post that never went out
import type { NextRequest } from "next/server";
import { z } from "zod";

import { deleteBrandPost, updateBrandPost } from "@launchstack/pipelines/marketing/posts";

import { brandContext, error, handleBrandError, json, readBody } from "../../_http";

const PatchSchema = z.object({
    body: z.string().min(1).max(40_000).optional(),
    title: z.string().max(300).nullable().optional(),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    status: z.enum(["cancelled", "scheduled", "draft"]).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Check the change and try again", 400);
        const { scheduledAt, ...rest } = parsed.data;
        let when: Date | null | undefined;
        if (scheduledAt === null) when = null;
        else if (scheduledAt !== undefined) {
            when = new Date(scheduledAt);
            if (Number.isNaN(when.getTime())) return error("That schedule time is not a date", 400);
        }
        const post = await updateBrandPost(id, auth.ctx.companyId, {
            ...rest,
            ...(when !== undefined ? { scheduledAt: when } : {}),
        });
        return json({ post });
    } catch (err) {
        return handleBrandError("PATCH post", err);
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await brandContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await deleteBrandPost(id, auth.ctx.companyId);
        return json({ ok: true });
    } catch (err) {
        return handleBrandError("DELETE post", err);
    }
}
