/**
 * What happens when a person adds a file (ADR-014): it starts private to them
 * when it is loose (Unfiled) and inherits its folder otherwise, they get a
 * manage grant on it either way, and the team's activity feed says they added
 * it — in one transaction, so a file is never filed without its owner.
 *
 * Only for rows the request just inserted: a retried upload that converged on
 * an earlier row (`DocumentUploadResult.createdDocuments` is empty) changes
 * nothing, so a file someone has since shared is never made private again —
 * unless that earlier attempt died before its defaults landed (the row has no
 * grant and no settings of its own at all), in which case the retry finishes
 * the job instead of leaving a loose file open to the workspace.
 * Background ingestion (crawls, connectors, prospects) does not come through
 * here — it adds files for the workspace, not for one person.
 */

import { eq } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import { normalizeFolderPath } from "~/lib/folders/path";
import { db } from "~/server/db";
import { documentGrants, documentSettings } from "~/server/db/schema";

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
    if (upload.createdDocuments.length === 0) {
        if (await neverOwned(upload.document.id)) {
            await recordAddedDocuments(actor, [upload.document]);
        }
        return;
    }
    const primary = upload.createdDocuments.some(d => d.id === upload.document.id)
        ? upload.document.id
        : upload.createdDocuments[0]!.id;
    await recordAddedDocuments(actor, upload.createdDocuments, [primary]);
}

/** How recent an unowned row must be to count as this upload's own interrupted attempt. */
const RETRY_WINDOW_MS = 15 * 60 * 1000;

/**
 * True when a document was added moments ago and has neither a grant nor
 * settings of its own — its defaults never ran. Files from before ADR-014 have
 * none either; the time window keeps a retry from making one of those private.
 */
async function neverOwned(documentId: number): Promise<boolean> {
    const key = BigInt(documentId);
    const [row] = await db
        .select({ createdAt: document.createdAt })
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1);
    if (!row || Date.now() - new Date(row.createdAt).getTime() > RETRY_WINDOW_MS) return false;
    const [grant, setting] = await Promise.all([
        db
            .select({ id: documentGrants.id })
            .from(documentGrants)
            .where(eq(documentGrants.documentId, key))
            .limit(1),
        db
            .select({ id: documentSettings.documentId })
            .from(documentSettings)
            .where(eq(documentSettings.documentId, key))
            .limit(1),
    ]);
    return grant.length === 0 && setting.length === 0;
}
