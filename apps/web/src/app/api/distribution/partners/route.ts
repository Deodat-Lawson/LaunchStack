// GET /api/distribution/partners — relationships joined with their organisation
//   ?programId= &stage=a,b &kind= &country= &minFit= &stale=1 &due=ISO &q= &limit= &offset= &order=fit|activity|stage|created
import type { NextRequest } from "next/server";

import {
    PARTNER_KINDS,
    RELATIONSHIP_STAGES,
    type PartnerKind,
    type RelationshipStage,
} from "@launchstack/pipelines/distribution/types";
import { listPartners } from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json } from "~/server/distribution/http";

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const q = request.nextUrl.searchParams;
        const stages = (q.get("stage") ?? "")
            .split(",")
            .map(s => s.trim())
            .filter((s): s is RelationshipStage =>
                (RELATIONSHIP_STAGES as readonly string[]).includes(s)
            );
        const kind = q.get("kind");
        if (kind && !(PARTNER_KINDS as readonly string[]).includes(kind))
            return error("Invalid kind", 400);
        const limit = q.get("limit") ? Number.parseInt(q.get("limit")!, 10) : 100;
        const offset = q.get("offset") ? Number.parseInt(q.get("offset")!, 10) : 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 500)
            return error("Invalid limit", 400);
        if (!Number.isInteger(offset) || offset < 0) return error("Invalid offset", 400);
        const minFit = q.get("minFit") ? Number.parseInt(q.get("minFit")!, 10) : undefined;
        const order = q.get("order");
        const items = await listPartners(ctx.data.companyId, {
            programId: q.get("programId") ?? undefined,
            stage: stages.length > 0 ? stages : undefined,
            kind: (kind as PartnerKind | null) ?? undefined,
            country: q.get("country") ?? undefined,
            minFit: minFit !== undefined && Number.isInteger(minFit) ? minFit : undefined,
            staleOnly: q.get("stale") === "1",
            dueBefore: q.get("due") ? new Date(q.get("due")!) : undefined,
            search: q.get("q") ?? undefined,
            limit,
            offset,
            orderBy:
                order === "activity" || order === "stage" || order === "created" ? order : "fit",
        });
        return json({ partners: items, pagination: { limit, offset } });
    } catch (err) {
        return handleRouteError("GET partners", err);
    }
}
