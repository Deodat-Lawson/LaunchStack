/**
 * Who uploaded a source, so the AI that indexing spends on it counts toward
 * that person's allowance. The later ingestion events don't carry the actor
 * the upload did; the version row keeps it.
 */

import { desc, eq } from "drizzle-orm";
import { documentVersions } from "@launchstack/store/schema";

import { db } from "~/server/db";

/** The auth id that uploaded a document version, or null when none was recorded. */
export async function uploaderOfVersion(versionId: number): Promise<string | null> {
    const [row] = await db
        .select({ uploadedBy: documentVersions.uploadedBy })
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId))
        .limit(1);
    return row?.uploadedBy ?? null;
}

/** Whoever uploaded a document's latest version, or null. */
export async function uploaderOfDocument(documentId: number | bigint): Promise<string | null> {
    const [row] = await db
        .select({ uploadedBy: documentVersions.uploadedBy })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, BigInt(documentId)))
        .orderBy(desc(documentVersions.id))
        .limit(1);
    return row?.uploadedBy ?? null;
}

/** The uploader, or null when the lookup fails: counting must never fail indexing. */
export async function uploaderOrNull(lookup: Promise<string | null>): Promise<string | null> {
    try {
        return await lookup;
    } catch (error) {
        console.warn(
            "[ai-usage] could not find who uploaded a source; counting it to no one:",
            error instanceof Error ? error.message : error
        );
        return null;
    }
}
