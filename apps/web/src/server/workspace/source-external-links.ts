/**
 * The facts `sourceExternalLink` needs beyond a document row, read once for a
 * whole documents list: which documents have a linked Drive copy, and which
 * member owns each Gmail or Outlook connection (mail opens only in its
 * owner's mailbox). Both reads are per workspace, not per document, so a long list
 * costs two small queries rather than an IN list as long as the list.
 */

import { and, eq, inArray } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import {
    sourceExternalLink,
    type ExternalLinkContext,
    type SourceExternalLink,
} from "~/lib/source-external-link";
import { db } from "~/server/db";
import { connectorConnections, documentDriveLinks } from "~/server/db/schema";

export interface ExternalLinkResolver {
    /** Where this row opens outside LaunchStack; `fileUrl` is the stored file as the list serves it. */
    linkFor(doc: {
        id: number;
        ocrMetadata: unknown;
        fileUrl: string | null;
    }): SourceExternalLink | null;
}

export async function loadExternalLinkResolver(
    companyId: bigint,
    viewerUserPk: bigint
): Promise<ExternalLinkResolver> {
    const [driveLinks, mailboxConnections] = await Promise.all([
        db
            .select({
                documentId: documentDriveLinks.documentId,
                url: documentDriveLinks.driveWebViewLink,
            })
            .from(documentDriveLinks)
            .innerJoin(document, eq(document.id, documentDriveLinks.documentId))
            .where(and(eq(document.companyId, companyId), eq(documentDriveLinks.status, "linked"))),
        db
            .select({ id: connectorConnections.id, owner: connectorConnections.ownerUserId })
            .from(connectorConnections)
            .where(
                and(
                    eq(connectorConnections.companyId, companyId),
                    inArray(connectorConnections.provider, ["gmail", "outlook"])
                )
            ),
    ]);

    const driveLinkByDocument = new Map<number, string>();
    for (const row of driveLinks) {
        if (row.url) driveLinkByDocument.set(Number(row.documentId), row.url);
    }
    const connectionOwners = new Map<string, string>();
    for (const row of mailboxConnections) {
        if (row.owner !== null) connectionOwners.set(String(row.id), String(row.owner));
    }
    const context: ExternalLinkContext = {
        viewerUserPk: String(viewerUserPk),
        connectionOwners,
    };

    return {
        linkFor: doc =>
            sourceExternalLink(
                {
                    ocrMetadata: doc.ocrMetadata,
                    fileUrl: doc.fileUrl,
                    driveLinkUrl: driveLinkByDocument.get(doc.id) ?? null,
                },
                context
            ),
    };
}
