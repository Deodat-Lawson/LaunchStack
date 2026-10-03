// GET  /api/vantage/evidence?kind=&since= — the inbox
// POST /api/vantage/evidence — add one item
import type { NextRequest } from "next/server";

import {
    VANTAGE_EVIDENCE_KINDS,
    createEvidence,
    isIsoDate,
    listEvidence,
} from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../_http";
import { EvidenceSchema } from "../_schemas";

export async function GET(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const q = request.nextUrl.searchParams;
        const kindParam = q.get("kind");
        const kind =
            kindParam && (VANTAGE_EVIDENCE_KINDS as readonly string[]).includes(kindParam)
                ? (kindParam as (typeof VANTAGE_EVIDENCE_KINDS)[number])
                : undefined;
        const since = q.get("since");
        const items = await listEvidence({
            companyId: auth.ctx.companyId,
            kind,
            since: since && isIsoDate(since) ? since : undefined,
        });
        return json({ evidence: items });
    } catch (err) {
        return handleVantageError("GET evidence", err);
    }
}

export async function POST(request: NextRequest) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const parsed = EvidenceSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const item = await createEvidence({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            input: {
                ...parsed.data,
                sourceUrl: parsed.data.sourceUrl === "" ? null : (parsed.data.sourceUrl ?? null),
            },
        });
        return json({ evidence: item }, 201);
    } catch (err) {
        return handleVantageError("POST evidence", err);
    }
}
