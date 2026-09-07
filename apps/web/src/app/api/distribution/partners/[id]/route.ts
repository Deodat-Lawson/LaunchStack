// GET /api/distribution/partners/[id] — relationship + organisation + evidence + timeline + agreements
import type { NextRequest } from "next/server";

import {
    getOrg,
    getRelationship,
    listAgreements,
    listEvents,
    listEvidenceForOrg,
} from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error("Not found", 404);
        const [org, evidence, events, agreements] = await Promise.all([
            getOrg(relationship.orgId, ctx.data.companyId),
            listEvidenceForOrg(ctx.data.companyId, relationship.orgId),
            listEvents(ctx.data.companyId, relationship.id),
            listAgreements(ctx.data.companyId, relationship.id),
        ]);
        if (!org) return error("Not found", 404);
        return json({ relationship, org, evidence, events, agreements });
    } catch (err) {
        return handleRouteError("GET partner", err);
    }
}
