import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { findBatchOwnedByUser, serializeBatch } from "~/server/services/upload-batches";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;
  if (!batchId) {
    return NextResponse.json({ error: "Batch ID is required" }, { status: 400 });
  }

  // Identity comes from the Clerk session; the legacy `userId` query
  // parameter is still accepted for wire-compat but ignored.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const queryUserId = searchParams.get("userId");
  if (queryUserId && queryUserId !== userId) {
    console.warn(
      `[UploadBatches] Ignoring query userId=${queryUserId}; using session userId=${userId}`
    );
  }

  const batch = await findBatchOwnedByUser(batchId, userId, true);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({ batch: serializeBatch(batch) });
}
