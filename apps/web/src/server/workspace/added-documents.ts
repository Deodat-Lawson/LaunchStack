/**
 * What happens when a person adds a file (ADR-014): it starts private to them
 * when it is loose (Unfiled) and inherits its folder otherwise, they get a
 * manage grant on it either way, and the team's activity feed says they added
 * it — in one transaction, so a file is never filed without its owner.
 *
 * Only for rows the request just inserted: a retried upload that converged on
 * an earlier row (`DocumentUploadResult.createdDocuments` is empty) changes
 * nothing, so a file someone has since shared is never made private again.
 * Background ingestion (crawls, connectors, prospects) does not come through
 * here — it adds files for the workspace, not for one person.
 */

import { normalizeFolderPath } from "~/lib/folders/path";
import { db } from "~/server/db";

import { recordActivity } from "./activity";
import { applyDocumentCreationDefaults } from "./ownership";

/** The person a file was added by. */
export interface AddedBy {
    readonly companyId: bigint;
    readonly userPk: bigint;
    readonly authUserId: string;
}

export interface AddedDocument {
    readonly id: number;
    readonly title: string;
    readonly category: string | null;
}

export async function recordAddedDocuments(
    actor: AddedBy,
    docs: readonly AddedDocument[],
    /**
     * Which of `docs` the feed names. An audio upload adds the recording and
     * its transcript; the person added one thing, so the feed says one thing.
     * Defaults to all of them.
     */
    announce?: readonly number[]
): Promise<void> {
    if (docs.length === 0) return;
    const owner = {
        companyId: actor.companyId,
        userPk: actor.userPk,
        authUserId: actor.authUserId,
    };
    const named = announce ? new Set(announce) : null;
    await db.transaction(async tx => {
        await applyDocumentCreationDefaults(
            tx,
            owner,
            docs.map(doc => ({ id: doc.id, category: doc.category }))
        );
        for (const doc of docs) {
            if (named && !named.has(doc.id)) continue;
            await recordActivity(tx, {
                companyId: actor.companyId,
                actorUserId: actor.authUserId,
                verb: "added",
                targetType: "document",
                targetId: doc.id,
                targetLabel: doc.title,
                targetPath: normalizeFolderPath(doc.category),
            });
        }
    });
}

/** `recordAddedDocuments` for a `processDocumentUpload` result: defaults on every new row, one feed entry. */
export async function recordUpload(
    actor: AddedBy,
    upload: {
        document: AddedDocument;
        createdDocuments: readonly AddedDocument[];
    }
): Promise<void> {
    if (upload.createdDocuments.length === 0) return;
    const primary = upload.createdDocuments.some(d => d.id === upload.document.id)
        ? upload.document.id
        : upload.createdDocuments[0]!.id;
    await recordAddedDocuments(actor, upload.createdDocuments, [primary]);
}
