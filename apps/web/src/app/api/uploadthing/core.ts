import { createUploadthing, type FileRouter } from "uploadthing/next";
import { auth } from "@clerk/nextjs/server";
import { mintUploadThingObjectRef } from "~/server/storage/uploadthing";

const f = createUploadthing();

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
            return {
                uploadedBy: metadata.userId,
                fileUrl: file.url,
                filename: file.name,
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
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
            return {
                uploadedBy: metadata.userId,
                fileUrl: file.url,
                filename: file.name,
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
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
            return {
                uploadedBy: metadata.userId,
                fileUrl: file.url,
                filename: file.name,
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
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
            return {
                uploadedBy: metadata.userId,
                fileUrl: file.url,
                filename: file.name,
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
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
            return {
                uploadedBy: metadata.userId,
                fileUrl: file.url,
                filename: file.name,
                ref: {
                    adapter: ref.adapter,
                    storageLocationId: ref.storageLocationId,
                    key: ref.key,
                },
            };
        }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
