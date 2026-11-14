import { and, ne, or, sql, type SQLWrapper } from "drizzle-orm";

import { document, documentVersions } from "@launchstack/store/schema";
import { db } from "~/server/db";

/** Global checks deliberately include other workspaces: shared bytes must survive. */
export async function hasStoredUrlReferences(
    url: string,
    excludingVersionId?: number
): Promise<boolean> {
    // Backfills may temporarily mix URL forms. Aliases can prevent deletion,
    // but never authorize it: refFromStoredUrl still controls that boundary.
    const internalId = /^(?:https?:\/\/[^/]+)?\/api\/files\/(\d+)$/.exec(url)?.[1];
    const internalPattern = internalId
        ? `^(https?://[^/]+)?/api/files/0*${internalId.replace(/^0+(?=\d)/, "")}$`
        : null;
    const matchesUrl = (value: SQLWrapper) =>
        internalPattern ? sql`${value} ~ ${internalPattern}` : sql`${value} = ${url}`;
    const documents = await db
        .select({ id: document.id })
        .from(document)
        .where(
            or(
                matchesUrl(document.url),
                matchesUrl(sql`${document.ocrMetadata}->'websitePreview'->>'url'`)
            )
        )
        .limit(1);
    if (documents.length > 0) return true;

    const versions = await db
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .where(
            and(
                excludingVersionId === undefined
                    ? undefined
                    : ne(documentVersions.id, excludingVersionId),
                or(
                    matchesUrl(documentVersions.url),
                    matchesUrl(sql`${documentVersions.ocrMetadata}->'websitePreview'->>'url'`)
                )
            )
        )
        .limit(1);
    return versions.length > 0;
}
