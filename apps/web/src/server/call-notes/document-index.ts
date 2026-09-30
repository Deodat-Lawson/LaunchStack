import { and, eq, inArray, like, or, sql } from "drizzle-orm";

import { getOcrConfig } from "@launchstack/conversion/ocr/config";
import type { CallNoteIndex } from "@launchstack/pipelines/call-notes";
import { callNotesCalls } from "@launchstack/pipelines/schema";
import type { DbClient } from "@launchstack/store/client";
import { buildInternalFileUrl, parseInternalFileId } from "@launchstack/store/crypto";
import { document, documentVersions, fileUploads } from "@launchstack/store/schema";
import { callNoteDocumentMarker } from "~/lib/call-note-document";
import { deleteFile, deleteFileByUrl, uploadFile, type UploadResult } from "~/lib/storage";
import { documentNotes } from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import {
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
    type CreateDocumentVersionLifecycleParams,
} from "~/server/services/document-creation";
import {
    deleteDocumentBlobs,
    deleteDocumentCore,
    type DocumentBlobDeletion,
} from "~/server/services/document-delete";
import {
    processDocumentUpload,
    toAbsoluteUrl,
    type DocumentUploadParams,
} from "~/server/services/document-upload";
import { authorizeInternalFileRef } from "~/server/services/internal-file-ref";

type CallState = Pick<
    typeof callNotesCalls.$inferSelect,
    | "id"
    | "companyId"
    | "title"
    | "status"
    | "documentNoteId"
    | "noteOwnerUserId"
    | "noteVisibility"
    | "currentNoteRevision"
    | "indexedDocumentId"
    | "indexedRevision"
>;
type CanonicalNote = Pick<
    typeof documentNotes.$inferSelect,
    "id" | "userId" | "companyId" | "title" | "content" | "contentMarkdown"
>;
type Executor = Pick<DbClient, "select">;
type IndexedDocument = Pick<typeof document.$inferSelect, "id" | "title" | "category">;

export interface WebCallNoteIndexOptions {
    db?: DbClient;
    uploadFile?: typeof uploadFile;
    deleteFile?: typeof deleteFile;
    deleteFileByUrl?: typeof deleteFileByUrl;
    processDocumentUpload?: (input: DocumentUploadParams) => Promise<{ document: { id: number } }>;
    createDocumentVersionLifecycle?: (
        input: CreateDocumentVersionLifecycleParams
    ) => Promise<{ document: { id: number } }>;
    findDocumentByCreationKey?: (
        companyId: bigint,
        creationKey: string
    ) => Promise<IndexedDocument | null>;
    deleteDocumentCore?: typeof deleteDocumentCore;
    resolveProcessingUrl?: (url: string, companyId: bigint, requestUrl: string) => Promise<string>;
    requestUrl?: string;
}

function callSelection() {
    return {
        id: callNotesCalls.id,
        companyId: callNotesCalls.companyId,
        title: callNotesCalls.title,
        status: callNotesCalls.status,
        documentNoteId: callNotesCalls.documentNoteId,
        noteOwnerUserId: callNotesCalls.noteOwnerUserId,
        noteVisibility: callNotesCalls.noteVisibility,
        currentNoteRevision: callNotesCalls.currentNoteRevision,
        indexedDocumentId: callNotesCalls.indexedDocumentId,
        indexedRevision: callNotesCalls.indexedRevision,
    };
}

function noteSelection() {
    return {
        id: documentNotes.id,
        userId: documentNotes.userId,
        companyId: documentNotes.companyId,
        title: documentNotes.title,
        content: documentNotes.content,
        contentMarkdown: documentNotes.contentMarkdown,
    };
}

async function loadNote(executor: Executor, call: CallState): Promise<CanonicalNote | null> {
    if (call.documentNoteId === null) return null;
    const [note] = await executor
        .select(noteSelection())
        .from(documentNotes)
        .where(eq(documentNotes.id, call.documentNoteId))
        .limit(1);
    return note ?? null;
}

function isIndexable(call: CallState | null, note: CanonicalNote | null): boolean {
    // Private Call Notes stay out of the corpus: document grants cannot hide a
    // document from folder managers. resolveDocumentScope also denies any
    // Call Note document that is no longer eligible, so a failed cleanup never
    // leaves one readable.
    return (
        call !== null &&
        note !== null &&
        call.status === "completed" &&
        call.noteVisibility === "company" &&
        call.currentNoteRevision > 0 &&
        call.documentNoteId === note.id &&
        call.noteOwnerUserId === note.userId &&
        call.companyId.toString() === note.companyId
    );
}

function safeFilename(title: string): string {
    const base =
        title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 100) || "call-note";
    return `${base}.md`;
}

async function resolveProcessingUrl(
    url: string,
    companyId: bigint,
    requestUrl: string
): Promise<string> {
    // Match the mindmap publish route's cold-start and file-authorisation order.
    getEngine();
    const provider = getOcrConfig().defaultProvider;
    const internalFileId = await authorizeInternalFileRef(url, companyId, provider);
    return internalFileId !== null
        ? buildInternalFileUrl(
              getOcrConfig().appPublicUrl ?? new URL(requestUrl).origin,
              internalFileId
          )
        : toAbsoluteUrl(url, requestUrl);
}

/** Publishes only the canonical, saved company-visible Call Note, never evidence or proposals. */
export function createWebCallNoteIndex(options: WebCallNoteIndexOptions = {}): CallNoteIndex {
    const db = options.db ?? getEngine().db;
    const upload = options.uploadFile ?? uploadFile;
    const removeFile = options.deleteFile ?? deleteFile;
    const removeFileByUrl = options.deleteFileByUrl ?? deleteFileByUrl;
    const publish = options.processDocumentUpload ?? processDocumentUpload;
    const version = options.createDocumentVersionLifecycle ?? createDocumentVersionLifecycle;
    const findByKey = options.findDocumentByCreationKey ?? findDocumentByCreationKey;
    const deleteDocument = options.deleteDocumentCore ?? deleteDocumentCore;
    const processingUrlFor = options.resolveProcessingUrl ?? resolveProcessingUrl;

    async function stampIndexedDocument(
        executor: Pick<DbClient, "update">,
        companyId: bigint,
        documentId: number,
        callId: string
    ): Promise<void> {
        const marker = callNoteDocumentMarker({ callId });
        await executor
            .update(document)
            .set({
                ocrMetadata: sql`COALESCE(${document.ocrMetadata}, '{}'::jsonb) || ${JSON.stringify(marker)}::jsonb`,
            })
            .where(and(eq(document.id, documentId), eq(document.companyId, companyId)));
    }

    async function discardUnreferencedUpload(
        stored: UploadResult,
        companyId: bigint
    ): Promise<void> {
        const fileId = parseInternalFileId(stored.url);
        const uploadPredicate = and(
            eq(fileUploads.companyId, companyId),
            fileId === null ? eq(fileUploads.storageUrl, stored.url) : eq(fileUploads.id, fileId)
        );
        const uploads = await db
            .select({ id: fileUploads.id, storageUrl: fileUploads.storageUrl })
            .from(fileUploads)
            .where(uploadPredicate);
        const aliases = [
            stored.url,
            ...uploads.flatMap(row => (row.storageUrl ? [row.storageUrl] : [])),
        ];
        const internalIds = new Set([
            ...(fileId === null ? [] : [fileId]),
            ...uploads.map(row => row.id),
        ]);
        // Ingestion commits independently of the Call transaction. An error
        // after that commit must not remove a document's or version's bytes.
        const [referenced] = await db
            .select({ id: document.id })
            .from(document)
            .leftJoin(documentVersions, eq(documentVersions.documentId, document.id))
            .where(
                or(
                    inArray(document.url, aliases),
                    inArray(documentVersions.url, aliases),
                    ...Array.from(internalIds).flatMap(id => [
                        like(document.url, `%/api/files/${id}`),
                        like(documentVersions.url, `%/api/files/${id}`),
                    ])
                )
            )
            .limit(1);
        if (referenced) return;

        // Revoke /api/files access with this index's DB client, even when the
        // storage backend is database and there is no external blob to remove.
        await db.delete(fileUploads).where(uploadPredicate);
        if (stored.provider === "s3" && stored.pathname) {
            await removeFile(stored.pathname, "s3");
        } else {
            await removeFileByUrl(stored.url);
        }
    }

    async function findIndexedDocument(
        executor: Executor,
        companyId: bigint,
        documentId: bigint | null,
        creationKey: string
    ): Promise<IndexedDocument | null> {
        if (documentId !== null) {
            const [row] = await executor
                .select({ id: document.id, title: document.title, category: document.category })
                .from(document)
                .where(and(eq(document.id, Number(documentId)), eq(document.companyId, companyId)))
                .limit(1);
            if (row) return row;
        }
        return findByKey(companyId, creationKey);
    }

    async function removeIfIneligible(companyId: bigint, callId: string): Promise<void> {
        const blobDeletions: DocumentBlobDeletion[] = [];
        await db.transaction(async tx => {
            const [call] = await tx
                .select(callSelection())
                .from(callNotesCalls)
                .where(and(eq(callNotesCalls.id, callId), eq(callNotesCalls.companyId, companyId)))
                .limit(1)
                .for("update");
            const note = call ? await loadNote(tx, call) : null;
            const indexed = await findIndexedDocument(
                tx,
                companyId,
                call?.indexedDocumentId ?? null,
                `call-note:${callId}`
            );
            if (indexed) await stampIndexedDocument(tx, companyId, indexed.id, callId);
            // A newer company-visible revision may have completed while this
            // cleanup was waiting. It owns the document; stale cleanup cannot erase it.
            if (isIndexable(call ?? null, note)) return;

            if (indexed) blobDeletions.push(...(await deleteDocument(tx, indexed.id)));
            if (call) {
                await tx
                    .update(callNotesCalls)
                    .set({ indexedDocumentId: null, indexedRevision: null })
                    .where(
                        and(eq(callNotesCalls.id, callId), eq(callNotesCalls.companyId, companyId))
                    );
            }
        });
        await deleteDocumentBlobs(blobDeletions);
    }

    return {
        async sync({ companyId: companyIdInput, callId }) {
            const companyId = BigInt(companyIdInput);
            // One statement snapshots the note content and its owning revision together.
            const [snapshot] = await db
                .select({ call: callSelection(), note: noteSelection() })
                .from(callNotesCalls)
                .leftJoin(documentNotes, eq(documentNotes.id, callNotesCalls.documentNoteId))
                .where(and(eq(callNotesCalls.id, callId), eq(callNotesCalls.companyId, companyId)))
                .limit(1);
            const call = snapshot?.call ?? null;
            const note = snapshot?.note ?? null;
            const creationKey = `call-note:${callId}`;
            const indexed = await findIndexedDocument(
                db,
                companyId,
                call?.indexedDocumentId ?? null,
                creationKey
            );
            // Commit provenance before cleanup or ingestion can fail. Even an
            // unchanged document must stay protected after its Call is deleted.
            if (indexed) await stampIndexedDocument(db, companyId, indexed.id, callId);
            if (!call || !note || !isIndexable(call, note)) {
                await removeIfIneligible(companyId, callId);
                return;
            }

            const title = note.title ?? call.title;
            // The canonical heading keeps the full title; document titles have a
            // 256-character storage bound, while Call Note titles allow 512.
            const documentTitle = title.slice(0, 256);
            if (
                indexed &&
                call.indexedDocumentId === BigInt(indexed.id) &&
                call.indexedRevision === call.currentNoteRevision &&
                indexed.title === documentTitle &&
                indexed.category === "Calls"
            ) {
                return;
            }

            const markdown = `# ${title}\n\n${note.contentMarkdown ?? note.content ?? ""}`;
            const filename = safeFilename(title);
            const stored = await upload({
                filename,
                data: Buffer.from(markdown, "utf8"),
                contentType: "text/markdown",
                userId: note.userId,
                companyId,
            });
            try {
                // This is an index-owned transaction, never the user command's.
                // Lock before ingestion: an older upload must not become the
                // document's current version after a newer sync already succeeded.
                const result = await db.transaction(async tx => {
                    const [current] = await tx
                        .select(callSelection())
                        .from(callNotesCalls)
                        .where(
                            and(
                                eq(callNotesCalls.id, callId),
                                eq(callNotesCalls.companyId, companyId)
                            )
                        )
                        .limit(1)
                        .for("update");
                    const currentNote = current ? await loadNote(tx, current) : null;
                    if (!current || !currentNote || !isIndexable(current, currentNote))
                        return "removed";
                    const currentIndexed = await findIndexedDocument(
                        tx,
                        companyId,
                        current.indexedDocumentId,
                        creationKey
                    );
                    if (
                        current.currentNoteRevision !== call.currentNoteRevision ||
                        current.documentNoteId !== note.id ||
                        (currentNote.title ?? current.title) !== title
                    ) {
                        if (currentIndexed)
                            await stampIndexedDocument(tx, companyId, currentIndexed.id, callId);
                        return "stale";
                    }
                    if (
                        currentIndexed &&
                        current.indexedDocumentId === BigInt(currentIndexed.id) &&
                        current.indexedRevision === current.currentNoteRevision &&
                        currentIndexed.title === documentTitle &&
                        currentIndexed.category === "Calls"
                    ) {
                        await stampIndexedDocument(tx, companyId, currentIndexed.id, callId);
                        return "unchanged";
                    }

                    if (!options.requestUrl) getEngine();
                    const requestUrl =
                        options.requestUrl ?? getOcrConfig().appPublicUrl ?? "http://app:3000";
                    const marker = callNoteDocumentMarker({ callId });
                    const published = currentIndexed
                        ? await version({
                              documentId: currentIndexed.id,
                              companyId,
                              userId: note.userId,
                              title: documentTitle,
                              category: "Calls",
                              url: stored.url,
                              processingUrl: await processingUrlFor(
                                  stored.url,
                                  companyId,
                                  requestUrl
                              ),
                              creationKey: `${creationKey}:r${call.currentNoteRevision}`,
                              mimeType: "text/markdown",
                              fileSize: Buffer.byteLength(markdown, "utf8"),
                              changelog: `Published revision ${call.currentNoteRevision}`,
                              originalFilename: filename,
                          })
                        : await publish({
                              user: { userId: note.userId, companyId },
                              documentName: documentTitle,
                              rawDocumentUrl: stored.url,
                              creationKey,
                              category: "Calls",
                              explicitStorageType: stored.provider,
                              mimeType: "text/markdown",
                              originalFilename: filename,
                              requestUrl,
                              ocrMetadata: marker,
                          });

                    // Versions do not carry provenance, and their lifecycle does not
                    // update the document title/category. Keep those on the canonical row.
                    await tx
                        .update(document)
                        .set({
                            title: documentTitle,
                            category: "Calls",
                            ocrMetadata: sql`COALESCE(${document.ocrMetadata}, '{}'::jsonb) || ${JSON.stringify(marker)}::jsonb`,
                        })
                        .where(
                            and(
                                eq(document.id, published.document.id),
                                eq(document.companyId, companyId)
                            )
                        );
                    await tx
                        .update(callNotesCalls)
                        .set({
                            indexedDocumentId: BigInt(published.document.id),
                            indexedRevision: call.currentNoteRevision,
                        })
                        .where(
                            and(
                                eq(callNotesCalls.id, callId),
                                eq(callNotesCalls.companyId, companyId)
                            )
                        );
                    return "recorded";
                });
                // Deletion or privacy may have committed during storage upload.
                // Reconcile any pre-existing document after releasing the Call lock.
                if (result === "removed") await removeIfIneligible(companyId, callId);
            } finally {
                await discardUnreferencedUpload(stored, companyId);
            }
        },
    };
}
