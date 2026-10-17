// PATCH  /api/vantage/commitments/:id — check in: done / missed / dropped, with what was learned
// DELETE /api/vantage/commitments/:id
import type { NextRequest } from "next/server";

import { deleteCommitmentV1, updateCommitmentV1 } from "@launchstack/pipelines/vantage";

import { error, firstIssue, handleVantageError, json, readBody, vantageContext } from "../../_http";
import { CommitmentPatchSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const parsed = CommitmentPatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues), 400);
        const commitment = await updateCommitmentV1({
            companyId: auth.ctx.companyId,
            id,
            patch: parsed.data,
        });
        return json({ commitment });
    } catch (err) {
        return handleVantageError("PATCH commitment", err);
    }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        await deleteCommitmentV1({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE commitment", err);
    }
}
