// GET /api/prospects/people?segmentId=&q=&status=
import type { NextRequest } from "next/server";

import type { EmailStatusKind } from "~/app/employer/tools/growth/prospects/api";
import { listPeople } from "~/server/prospects/service";

import { error, handleProspectsError, json, prospectsContext, prospectsT } from "../_http";

const STATUSES = new Set(["verified", "found", "generic", "guess"]);

export async function GET(request: NextRequest) {
    const auth = await prospectsContext();
    if (!auth.ok) return auth.response;
    try {
        const t = prospectsT(request);
        const q = request.nextUrl.searchParams;
        const segmentId = q.get("segmentId");
        if (!segmentId) return error(t("segmentIdRequired"), 400);
        const status = q.get("status");
        if (status && !STATUSES.has(status)) return error(t("invalidStatus"), 400);
        return json({
            people: await listPeople(auth.ctx, segmentId, {
                q: q.get("q") ?? "",
                status: (status as EmailStatusKind | null) ?? null,
            }),
        });
    } catch (err) {
        return handleProspectsError("GET people", err, request);
    }
}
