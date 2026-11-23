// PATCH  /api/vantage/commitments/:id — check in: done / missed / dropped, with what was learned
// DELETE /api/vantage/commitments/:id
import type { NextRequest } from "next/server";

import { deleteCommitment, updateCommitment } from "@launchstack/pipelines/vantage";

import { authorizeLegacyCommitmentMutation } from "~/server/vantage/legacy-read-authority";

import {
    error,
    firstIssue,
    handleVantageError,
    json,
    readBody,
    say,
    vantageContext,
} from "../../_http";
import { CommitmentPatchSchema } from "../../_schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const { id } = await params;
        await authorizeLegacyCommitmentMutation(auth.ctx, id);
        const parsed = CommitmentPatchSchema.safeParse(await readBody(request));
        if (!parsed.success) return error(firstIssue(parsed.error.issues, request), 400);
        const commitment = await updateCommitment({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            id,
            patch: parsed.data,
        });
        return json({ commitment });
    } catch (err) {
        return handleVantageError("PATCH commitment", err, request);
    }
}

export async function DELETE(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("documents.edit"))
        return error(say(request, "legacyMutationForbidden"), 403, { code: "forbidden" });
    try {
        const { id } = await params;
        await authorizeLegacyCommitmentMutation(auth.ctx, id);
        await deleteCommitment({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE commitment", err, request);
    }
}
