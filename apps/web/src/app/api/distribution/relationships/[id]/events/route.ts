// GET  /api/distribution/relationships/[id]/events — the timeline
// POST /api/distribution/relationships/[id]/events — log a reply, meeting, note or shared document
import type { NextRequest } from "next/server";

import { RelationshipEventInputSchema } from "@launchstack/pipelines/distribution/types";
import { addEvent, getRelationship, listEvents } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error("Not found", 404);
        return json({ events: await listEvents(ctx.data.companyId, id) });
    } catch (err) {
        return handleRouteError("GET events", err);
    }
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error("Not found", 404);
        const parsed = RelationshipEventInputSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error("Validation failed", 400, { details: parsed.error.flatten() });
        const event = await addEvent({
            companyId: ctx.data.companyId,
            relationshipId: id,
            type: parsed.data.type,
            payload: parsed.data.payload,
            actorUserId: ctx.data.authUserId,
            ref: parsed.data.ref ?? null,
            occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
        });
        return json({ event }, 201);
    } catch (err) {
        return handleRouteError("POST events", err);
    }
}
