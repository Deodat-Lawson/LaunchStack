import { NextResponse } from "next/server";

import { findBatchOwnedByUser, serializeBatch } from "~/server/services/upload-batches";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;
  if (!batchId) {
    return NextResponse.json({ error: "Batch ID is required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });
  }

  const batch = await findBatchOwnedByUser(batchId, userId, true);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({ batch: serializeBatch(batch) });
}
