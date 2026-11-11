import { eq } from "drizzle-orm";
import { fileUploads } from "@launchstack/store/schema";
import { isInternalFileUrl, parseInternalFileId } from "@launchstack/store/crypto";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";

import { db } from "~/server/db";
import { UploadAuthorizationError } from "~/server/services/upload-authorization-error";
import { findStoredObjectsByRefs } from "./ledger";
import { currentStorageLocationId } from "./location";
import { refFromStoredUrl } from "./stored-url";

/** Prove ownership before persisting a reference to bytes in our current store. */
export async function authorizeStoredObjectUrl(
    url: string,
    companyId: bigint
): Promise<number | null> {
    const parsed = refFromStoredUrl(url);
    if (
        (parsed.ok && parsed.ref.adapter === "database") ||
        isInternalFileUrl(url, getOcrConfig().appPublicUrl ?? "http://app:3000")
    ) {
        const fileId = parseInternalFileId(url);
        if (fileId === null) return null;
        const [file] = await db
            .select({ companyId: fileUploads.companyId })
            .from(fileUploads)
            .where(eq(fileUploads.id, fileId));
        if (file?.companyId == null || file.companyId !== companyId) {
            throw new UploadAuthorizationError(
                { key: "upload.server.errors.fileNotInWorkspace" },
                404
            );
        }
        return fileId;
    }

    if (
        parsed.ok &&
        parsed.ref.adapter !== "database" &&
        parsed.ref.storageLocationId === currentStorageLocationId(parsed.ref.adapter)
    ) {
        const [object] = await findStoredObjectsByRefs(db, [parsed.ref]);
        if (
            object?.companyId == null ||
            object.companyId !== companyId ||
            object.url !== url ||
            object.deletedAt !== null
        ) {
            throw new UploadAuthorizationError(
                { key: "upload.server.errors.fileNotInWorkspace" },
                404
            );
        }
    }
    return null;
}
