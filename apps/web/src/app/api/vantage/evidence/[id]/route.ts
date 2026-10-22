// GET    /api/vantage/evidence/:id — direct item read
// PATCH  /api/vantage/evidence/:id — edit
// DELETE /api/vantage/evidence/:id
import type { NextRequest } from "next/server";

import { deleteEvidence, getEvidence, updateEvidence } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { EvidenceSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const item = await getEvidence({ companyId: auth.ctx.companyId, id });
        if (!item) return error("That evidence is not here.", 404, { code: "not_found" });
        return json({ evidence: item });
    } catch (err) {
        return handleVantageError("GET evidence", err);
    }
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = EvidenceSchema.partial().safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const patch = { ...parsed.data };
        if (patch.sourceUrl === "") patch.sourceUrl = null;
        const item = await updateEvidence({ companyId: auth.ctx.companyId, id, patch });
        return json({ evidence: item });
    } catch (err) {
        return handleVantageError("PATCH evidence", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await deleteEvidence({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE evidence", err);
    }
}
