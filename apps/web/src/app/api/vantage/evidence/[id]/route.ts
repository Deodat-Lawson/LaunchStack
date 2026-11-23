import { authorizeLegacyEvidenceMutation } from "~/server/vantage/legacy-read-authority";
// PATCH  /api/vantage/evidence/:id — edit
// DELETE /api/vantage/evidence/:id
import type { NextRequest } from "next/server";

import { deleteEvidence, updateEvidence } from "@launchstack/pipelines/vantage";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    vantageContext,
    say,
} from "../../_http";
import { EvidenceSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const { id } = await params;
        await authorizeLegacyEvidenceMutation(auth.ctx, id);
        const parsed = EvidenceSchema.partial().safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues, request), 400);
        if (parsed.data.kind === "document")
            return error(say(request, "legacyMutationForbidden"), 403, {
                code: "legacy_report_forbidden",
            });
        const patch = { ...parsed.data };
        if (patch.sourceUrl === "") patch.sourceUrl = null;
        const item = await updateEvidence({ companyId: auth.ctx.companyId, id, patch });
        return json({ evidence: item });
    } catch (err) {
        return handleVantageError("PATCH evidence", err, request);
    }
}

export async function DELETE(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const { id } = await params;
        await authorizeLegacyEvidenceMutation(auth.ctx, id);
        await deleteEvidence({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE evidence", err, request);
    }
}
