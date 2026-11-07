import { NextResponse } from "next/server";

import { requestTranslator } from "~/i18n/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { findBatchOwnedByUser, serializeBatch } from "~/server/services/upload-batches";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
    const t = requestTranslator(request, "upload.server.errors");
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { batchId } = await params;
    if (!batchId) {
        return NextResponse.json({ error: t("batchIdRequired") }, { status: 400 });
    }

    const batch = await findBatchOwnedByUser(batchId, ctx.data.authUserId, true);
    if (!batch) {
        return NextResponse.json({ error: t("batchNotFound") }, { status: 404 });
    }

    return NextResponse.json({ batch: serializeBatch(batch) });
}
