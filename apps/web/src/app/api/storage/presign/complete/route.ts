import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { fileUploads, users } from "@launchstack/core/db/schema";
import { isS3Storage } from "~/lib/storage";
import { resolveStorageLocationId } from "~/lib/storage-location-id";
import { validateRequestBody, PresignCompleteSchema } from "~/lib/validation";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { registerUploadArtifact } from "~/server/services/storage-manifest";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (!isS3Storage()) {
      return NextResponse.json(
        { error: "Presigned upload completion is not applicable: no S3 endpoint configured" },
        { status: 400 },
      );
    }

    const validation = await validateRequestBody(request, PresignCompleteSchema);
    if (!validation.success) return validation.response;
    const body = validation.data;

    const expectedLocationId = resolveStorageLocationId("s3");
    if (body.ref.storageLocationId !== expectedLocationId) {
      return NextResponse.json(
        { error: "ref.storageLocationId does not match the active S3 location" },
        { status: 400 },
      );
    }

    const [userInfo] = await db
      .select({ id: users.id, companyId: users.companyId })
      .from(users)
      .where(eq(users.userId, userId));

    if (!userInfo) {
      return NextResponse.json({ error: "Unknown user" }, { status: 401 });
    }

    const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);

    const manifestObjectId = await db.transaction(async (tx) => {
      let fileUploadId = body.fileUploadId;

      if (fileUploadId === undefined) {
        const [row] = await tx
          .insert(fileUploads)
          .values({
            userId,
            filename: body.filename,
            mimeType: body.contentType,
            fileData: null,
            fileSize: body.sizeBytes ?? 0,
            storageProvider: "s3",
            storageUrl: null,
            storagePathname: body.ref.key,
          })
          .returning({ id: fileUploads.id });

        if (!row) {
          throw new Error("Failed to create fileUploads row for presigned upload");
        }
        fileUploadId = row.id;
      }

      const manifest = await registerUploadArtifact(tx, {
        ref: body.ref,
        companyId,
        fileUploadId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sourceOperation: "presign-complete",
      });

      return manifest.id;
    });

    return NextResponse.json({ success: true, manifestObjectId });
  } catch (error) {
    console.error("[PresignComplete] Failed to register presigned upload:", error);
    return NextResponse.json(
      { error: "Failed to register presigned upload" },
      { status: 500 },
    );
  }
}
