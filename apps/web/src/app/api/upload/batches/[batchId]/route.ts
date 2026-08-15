import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { findBatchOwnedByUser, serializeBatch } from "~/server/services/upload-batches";

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { batchId } = await params;
    if (!batchId) {
        return NextResponse.json({ error: "Batch ID is required" }, { status: 400 });
    }

    const batch = await findBatchOwnedByUser(batchId, ctx.data.clerkUserId, true);
    if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    return NextResponse.json({ batch: serializeBatch(batch) });
}
