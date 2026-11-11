import { createUploadthing, type FileRouter } from "uploadthing/next";
import type { UploadedFileData } from "uploadthing/types";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getEngine } from "~/server/engine";
import { deleteStoredObjects } from "~/server/storage/delete-objects";
import { recordStoredObject } from "~/server/storage/ledger";
import { currentStorageLocationId } from "~/server/storage/location";
import type { ObjectRef } from "~/server/storage/object-ref";
import { refFromStoredUrl } from "~/server/storage/stored-url";

// Runs on the browser's upload request (it has the session cookie); the
// completion callback does not, so the workspace travels in the metadata.
const requireSessionUserId = async () => {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) {
        throw new Error(ctx.response.status === 401 ? "Unauthorized" : "Workspace access denied");
    }
    return { userId: ctx.data.authUserId, companyId: String(ctx.data.companyId) };
};

type UploadResult =
    | { ok: true; uploadedBy: string; fileUrl: string; filename: string }
    | { ok: false; error: "storage_record_failed" };

const recordUpload = async ({
    metadata,
    file,
}: {
    metadata: { userId: string; companyId: string };
    file: UploadedFileData;
}): Promise<UploadResult> => {
    // v7 supplies ufsUrl for both public and private ACLs; access to private files
    // still requires signing. Preserve the provider URL rather than deprecated file.url.
    const parsed = refFromStoredUrl(file.ufsUrl);
    let ref: ObjectRef;
    if (parsed.ok && parsed.ref.adapter === "uploadthing") {
        ref = parsed.ref;
    } else {
        let url: URL;
        try {
            url = new URL(file.ufsUrl);
        } catch {
            return { ok: false, error: "storage_record_failed" };
        }
        const location = currentStorageLocationId("uploadthing");
        if (
            parsed.ok ||
            parsed.reason !== "unrecognized" ||
            url.protocol !== "https:" ||
            (url.hostname !== "utfs.io" && url.hostname !== "uploadthing.com") ||
            !location
        ) {
            return { ok: false, error: "storage_record_failed" };
        }
        ref = { adapter: "uploadthing", storageLocationId: location, key: file.key };
    }
    try {
        await recordStoredObject(getEngine().db, {
            ref,
            url: file.ufsUrl,
            companyId: BigInt(metadata.companyId),
            source: "uploadthing",
            contentType: file.type,
            sizeBytes: file.size,
            checksum: file.fileHash,
        });
    } catch {
        try {
            const results = await deleteStoredObjects([ref]);
            if (
                results.some(
                    result => result.outcome === "blocked" || result.outcome === "retryable"
                )
            ) {
                console.warn("[UploadThing] Failed to compensate unrecorded upload:", results);
            }
        } catch (cleanupError) {
            console.warn("[UploadThing] Failed to compensate unrecorded upload:", cleanupError);
        }
        // UploadThing 7.7.4 logs callback throws in a daemon and skips /callback-result.
        // The browser waits on the ingest PUT (awaitServerData defaults true), with
        // no SDK timeout. Return failure serverData so the client can reject the
        // upload instead of waiting for a provider timeout or losing the failure.
        return { ok: false, error: "storage_record_failed" };
    }
    return {
        ok: true,
        uploadedBy: metadata.userId,
        fileUrl: file.ufsUrl,
        filename: file.name,
    };
};

const f = createUploadthing();

export const ourFileRouter = {
    pdfUploader: f({
        pdf: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(requireSessionUserId)
        .onUploadComplete(recordUpload),

    // Generic document uploader — accepts Office, text, CSV, HTML files
    documentUploader: f({
        blob: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(requireSessionUserId)
        .onUploadComplete(recordUpload),

    // Image uploader — accepts PNG, JPG, TIFF, WebP, etc.
    imageUploader: f({
        image: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(requireSessionUserId)
        .onUploadComplete(recordUpload),

    // Accept any file type (use when type doesn't match pdf/document/image)
    anyUploader: f({
        blob: {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
    })
        .middleware(requireSessionUserId)
        .onUploadComplete(recordUpload),

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
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
        "application/msword": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
        "application/vnd.ms-excel": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/csv": { maxFileSize: "128MB", maxFileCount: 1 },
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
            maxFileSize: "128MB",
            maxFileCount: 1,
        },
        "application/vnd.ms-powerpoint": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/plain": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/markdown": { maxFileSize: "128MB", maxFileCount: 1 },
        "text/html": { maxFileSize: "128MB", maxFileCount: 1 },
        "audio/mpeg": { maxFileSize: "128MB", maxFileCount: 1 },
        "audio/mp4": { maxFileSize: "128MB", maxFileCount: 1 },
        "video/mp4": { maxFileSize: "128MB", maxFileCount: 1 },
    })
        .middleware(requireSessionUserId)
        .onUploadComplete(recordUpload),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
