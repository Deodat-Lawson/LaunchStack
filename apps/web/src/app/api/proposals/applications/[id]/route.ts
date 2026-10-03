// GET    /api/proposals/applications/[id] — the application with its sections, checklist and review
// PATCH  /api/proposals/applications/[id] — title, funder, status, deadline, notes, request, or one checklist tick
// DELETE /api/proposals/applications/[id]
import type { NextRequest } from "next/server";
import { z } from "zod";

import { APPLICATION_STATUSES } from "@launchstack/pipelines/proposals/types";

import { loadApplication, patchApplication, removeApplication } from "~/server/proposals/service";

import { error, proposalsContext, handleProposalsError, json, readBody } from "../../_http";

const PatchSchema = z.object({
    title: z.string().min(1).max(512).optional(),
    funder: z.string().max(256).optional().nullable(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    deadline: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    notes: z.string().max(20_000).optional().nullable(),
    requestText: z.string().max(200_000).optional().nullable(),
    requestUrl: z.string().url().max(2_000).optional().nullable(),
    requirement: z.object({ id: z.string().min(1).max(200), done: z.boolean() }).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        return json({ application: await loadApplication(auth.ctx, id) });
    } catch (err) {
        return handleProposalsError("GET application", err);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = PatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error("Check the change and try again", 400);
        return json({ application: await patchApplication(auth.ctx, id, parsed.data) });
    } catch (err) {
        return handleProposalsError("PATCH application", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await proposalsContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await removeApplication(auth.ctx, id);
        return json({ ok: true });
    } catch (err) {
        return handleProposalsError("DELETE application", err);
    }
}
