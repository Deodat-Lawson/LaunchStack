// DELETE /api/vantage/deadlines/:id (settings.manage)
import type { NextRequest } from "next/server";

import { deleteDeadline } from "@launchstack/pipelines/vantage";

import { error, handleVantageError, json, vantageContext, say } from "../../_http";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    if (!auth.ctx.can("settings.manage")) return error(say(request, "adminRemoveDeadline"), 403);
    try {
        const { id } = await params;
        await deleteDeadline({ companyId: auth.ctx.companyId, id });
        return json({ ok: true });
    } catch (err) {
        return handleVantageError("DELETE deadline", err, request);
    }
}
