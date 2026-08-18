import { createUploadthing, type FileRouter } from "uploadthing/next";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { mintUploadThingObjectRef } from "~/server/storage/uploadthing";
import { db } from "~/server/db";
import { fileUploads, users } from "@launchstack/core/db/schema";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import { findObjectByRef, registerUploadArtifact } from "~/server/services/storage-manifest";

const f = createUploadthing();

async function registerUploadThingArtifact(params: {
    userId: string;
    file: { name?: string | null; type?: string | null; size?: number | null; url?: string | null };
    ref: ReturnType<typeof mintUploadThingObjectRef>;
}): Promise<number | null> {
    const [userInfo] = await db
        .select({ id: users.id, companyId: users.companyId })
        .from(users)
        .where(eq(users.userId, params.userId));

    if (!userInfo) {
        throw new Error("UploadThing callback user was not found");
    }

    const companyId = await resolveActiveCompanyForUser(userInfo.id, userInfo.companyId);

    return db.transaction(async (tx) => {
        const existing = await findObjectByRef(tx, params.ref);

        // Idempotency: callback retries should not mint a second artifact row.
        if (existing) {
            // Existing row already transferred to a document/version owner.
            if (existing.artifactId === null) {
                return null;
            }
            return Number(existing.artifactId);
        }

        const [row] = await tx
            .insert(fileUploads)
            .values({
                userId: params.userId,
                filename: params.file.name ?? params.ref.key,
                mimeType: params.file.type ?? "application/octet-stream",
                fileData: null,
                fileSize: params.file.size ?? 0,
                storageProvider: "uploadthing",
                storageUrl: params.file.url ?? null,
                storagePathname: params.ref.key,
            })
            .returning({ id: fileUploads.id });

        if (!row) {
            throw new Error("UploadThing callback failed to create fileUploads row");
        }

        await registerUploadArtifact(tx, {
            ref: params.ref,
            companyId,
            fileUploadId: row.id,
            contentType: params.file.type ?? undefined,
            sizeBytes: typeof params.file.size === "number" ? params.file.size : undefined,
            sourceOperation: "uploadthing-callback",
        });

        return row.id;
    });
}

export const ourFileRouter = {
    pdfUploader: f({
        pdf: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(async () => {
            const { userId } = await auth();
            if (!userId) throw new Error("Unauthorized");

            return { userId };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            const ref = mintUploadThingObjectRef(file);
            const artifactId = await registerUploadThingArtifact({
                userId: metadata.userId,
                file,
                ref,
            });
            return {
                uploadedBy: metadata.userId,
                url: file.url,
                // Spread into a plain literal rather than passing `ref`
                // directly: UploadThing types serverData as JsonObject, and
                // ObjectRef (a readonly interface, no index signature) is not
                // assignable to it. Same values, structurally serializable.
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
                artifactId,
                filename: file.name,
            };
        }),

    // Generic document uploader — accepts Office, text, CSV, HTML files
    documentUploader: f({
        blob: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(async () => {
            const { userId } = await auth();
            if (!userId) throw new Error("Unauthorized");
            return { userId };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            const ref = mintUploadThingObjectRef(file);
            const artifactId = await registerUploadThingArtifact({
                userId: metadata.userId,
                file,
                ref,
            });
            return {
                uploadedBy: metadata.userId,
                url: file.url,
                // Spread into a plain literal rather than passing `ref`
                // directly: UploadThing types serverData as JsonObject, and
                // ObjectRef (a readonly interface, no index signature) is not
                // assignable to it. Same values, structurally serializable.
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
                artifactId,
                filename: file.name,
            };
        }),

    // Image uploader — accepts PNG, JPG, TIFF, WebP, etc.
    imageUploader: f({
        image: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(async () => {
            const { userId } = await auth();
            if (!userId) throw new Error("Unauthorized");
            return { userId };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            const ref = mintUploadThingObjectRef(file);
            const artifactId = await registerUploadThingArtifact({
                userId: metadata.userId,
                file,
                ref,
            });
            return {
                uploadedBy: metadata.userId,
                url: file.url,
                // Spread into a plain literal rather than passing `ref`
                // directly: UploadThing types serverData as JsonObject, and
                // ObjectRef (a readonly interface, no index signature) is not
                // assignable to it. Same values, structurally serializable.
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
                artifactId,
                filename: file.name,
            };
        }),

    // Accept any file type (use when type doesn't match pdf/document/image)
    anyUploader: f({
        blob: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(async () => {
            const { userId } = await auth();
            if (!userId) throw new Error("Unauthorized");
            return { userId };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            const ref = mintUploadThingObjectRef(file);
            const artifactId = await registerUploadThingArtifact({
                userId: metadata.userId,
                file,
                ref,
            });
            return {
                uploadedBy: metadata.userId,
                url: file.url,
                // Spread into a plain literal rather than passing `ref`
                // directly: UploadThing types serverData as JsonObject, and
                // ObjectRef (a readonly interface, no index signature) is not
                // assignable to it. Same values, structurally serializable.
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
                artifactId,
                filename: file.name,
            };
        }),

    // Document upload restricted to processable types (PDF, Office, text, HTML, images)
    documentUploaderRestricted: f({
        "application/pdf": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/zip": { maxFileSize: "128MB", maxFileCount: 1 },
        "image/png": { maxFileSize: "128MB", maxFileCount: 1 },
        "image/jpeg": { maxFileSize: "128MB", maxFileCount: 1 },
        "image/tiff": { maxFileSize: "128MB", maxFileCount: 1 },
        "image/webp": { maxFileSize: "128MB", maxFileCount: 1 },
        "image/gif": { maxFileSize: "128MB", maxFileCount: 1 },
        "image/bmp": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/msword": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.ms-excel": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/csv": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.ms-powerpoint": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/plain": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/markdown": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/html": { maxFileSize: "128MB", maxFileCount: 1 },
        "audio/mpeg": { maxFileSize: "128MB", maxFileCount: 1 },
        "audio/mp4": { maxFileSize: "128MB", maxFileCount: 1 },
        "video/mp4": { maxFileSize: "128MB", maxFileCount: 1 },
    })
        .middleware(async () => {
            const { userId } = await auth();
            if (!userId) throw new Error("Unauthorized");
            return { userId };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            const ref = mintUploadThingObjectRef(file);
            const artifactId = await registerUploadThingArtifact({
                userId: metadata.userId,
                file,
                ref,
            });
            return {
                uploadedBy: metadata.userId,
                url: file.url,
                // Spread into a plain literal rather than passing `ref`
                // directly: UploadThing types serverData as JsonObject, and
                // ObjectRef (a readonly interface, no index signature) is not
                // assignable to it. Same values, structurally serializable.
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
                artifactId,
                filename: file.name,
            };
        }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
