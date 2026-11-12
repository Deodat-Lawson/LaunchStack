import { eq } from "drizzle-orm";
import { fileUploads } from "@launchstack/store/schema";
import { isInternalFileUrl, parseInternalFileId } from "@launchstack/store/crypto";
import { getOcrConfig } from "@launchstack/conversion/ocr/config";

import { db } from "~/server/db";
import { UploadAuthorizationError } from "~/server/services/upload-authorization-error";
import type { Executor } from "~/server/workspace/db-types";
import { findStoredObjectsByRefs } from "./ledger";
import { currentStorageLocationId } from "./location";
import { refFromStoredUrl } from "./stored-url";

/** Prove ownership and return the spelling safe to persist in a protected reference. */
export async function authorizeStoredObjectUrl(
    url: string,
    companyId: bigint,
    executor: Executor = db
): Promise<{ fileId: number | null; url: string }> {
    const parsed = refFromStoredUrl(url);
    if (
        (parsed.ok && parsed.ref.adapter === "database") ||
        isInternalFileUrl(url, getOcrConfig().appPublicUrl ?? "http://app:3000")
    ) {
        const fileId = parseInternalFileId(url);
        if (fileId === null) return { fileId: null, url };
        const [file] = await executor
            .select({ companyId: fileUploads.companyId })
            .from(fileUploads)
            .where(eq(fileUploads.id, fileId));
        if (file?.companyId == null || file.companyId !== companyId) {
            throw new UploadAuthorizationError(
                { key: "upload.server.errors.fileNotInWorkspace" },
                404
            );
        }
        return { fileId, url: `/api/files/${fileId}` };
    }

    if (
        parsed.ok &&
        parsed.ref.adapter !== "database" &&
        parsed.ref.storageLocationId === currentStorageLocationId(parsed.ref.adapter)
    ) {
        const [object] = await findStoredObjectsByRefs(executor, [parsed.ref]);
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
        return { fileId: null, url: object.url };
    }
    return { fileId: null, url };
}
