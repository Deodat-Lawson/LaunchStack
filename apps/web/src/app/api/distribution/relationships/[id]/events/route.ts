// GET  /api/distribution/relationships/[id]/events — the timeline
// POST /api/distribution/relationships/[id]/events — log a reply, meeting, note or shared document
import type { NextRequest } from "next/server";

import { RelationshipEventInputSchema } from "@launchstack/pipelines/distribution/types";
import { addEvent, getRelationship, listEvents } from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json, readJsonBody } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const api = (request: Request) => requestTranslator(request, "errors.api");

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error(api(request)("notFound"), 404);
        return json({ events: await listEvents(ctx.data.companyId, id) });
    } catch (err) {
        return distributionRouteError("GET events", err, request);
    }
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error(api(request)("notFound"), 404);
        const parsed = RelationshipEventInputSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error(api(request)("validationFailed"), 400, {
                details: parsed.error.flatten(),
            });
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
        return distributionRouteError("POST events", err, request);
    }
}
