/**
 * Durable document↔Drive links (Leg 1 of the Drive-linked files design).
 *
 * One Drive file per document for the life of the link: the first open
 * uploads the bytes once, in their native format, and every later open lands
 * in the same file at the same URL. A document has at most one link row ever —
 * re-linking updates it in place with a fresh Drive file.
 */
import { and, eq } from "drizzle-orm";

import { DOCX_MIME, PDF_MIME, createFileMultipart, ensureFolder } from "@launchstack/google-drive";
import { document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { documentDriveLinks, type DocumentDriveLink } from "~/server/db/schema";
import { fetchFile } from "~/lib/storage";

import { DRIVE_FOLDER_NAME, MAX_LINKED_FILE_BYTES } from "./config";
import {
    GoogleNotConnectedError,
    getAccessTokenForConnection,
    getActiveGoogleConnection,
} from "./connections";

export class DriveLinkError extends Error {
    public readonly status: number;
    public readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "DriveLinkError";
        this.status = status;
        this.code = code;
    }
}

/** Launch scope: .docx and .pdf — the formats Drive edits and we re-ingest. */
export function isDriveLinkableDocument(
    fileType: string | null,
    mimeType: string | null,
    title: string
): boolean {
    return resolveCanonicalMime(fileType, mimeType, title) !== null;
}

export function resolveCanonicalMime(
    fileType: string | null,
    mimeType: string | null,
    title: string
): string | null {
    const ft = (fileType ?? "").toLowerCase();
    const mt = (mimeType ?? "").toLowerCase();
    const name = title.toLowerCase();
    if (mt === DOCX_MIME || ft === "docx" || ft === DOCX_MIME || name.endsWith(".docx")) {
        return DOCX_MIME;
    }
    if (mt === PDF_MIME || ft === "pdf" || ft === PDF_MIME || name.endsWith(".pdf")) {
        return PDF_MIME;
    }
    return null;
}

export function linkedFilename(title: string, canonicalMime: string): string {
    const ext = canonicalMime === PDF_MIME ? ".pdf" : ".docx";
    return title.toLowerCase().endsWith(ext) ? title : `${title}${ext}`;
}

export async function getDriveLinkForDocument(
    documentId: number
): Promise<DocumentDriveLink | null> {
    const [row] = await db
        .select()
        .from(documentDriveLinks)
        .where(eq(documentDriveLinks.documentId, BigInt(documentId)))
        .limit(1);
    return row ?? null;
}

/**
 * The guard the in-app write paths (adeu apply, versions POST, revert) call:
 * a live link means the Drive copy is the editing surface, and Phase 1
 * refuses in-app writes rather than silently forking the document.
 */
export async function getActiveDriveLink(documentId: number): Promise<DocumentDriveLink | null> {
    const link = await getDriveLinkForDocument(documentId);
    return link && link.status === "linked" ? link : null;
}

export interface LinkDocumentResult {
    link: DocumentDriveLink;
    created: boolean;
}

/**
 * Link a document to Drive, idempotently: an existing live link is returned
 * as-is (every open after the first is a redirect to the same file), and an
 * orphaned or unlinked row is revived with a freshly uploaded Drive file.
 */
export async function linkDocumentToDrive(params: {
    documentId: number;
    companyId: bigint;
    linkedByUserId: bigint | null;
}): Promise<LinkDocumentResult> {
    const [doc] = await db
        .select({
            id: document.id,
            title: document.title,
            url: document.url,
            mimeType: document.mimeType,
            fileType: document.fileType,
            currentVersionId: document.currentVersionId,
        })
        .from(document)
        .where(and(eq(document.id, params.documentId), eq(document.companyId, params.companyId)));

    if (!doc) {
        throw new DriveLinkError(404, "not_found", "Document not found");
    }

    const canonicalMime = resolveCanonicalMime(doc.fileType, doc.mimeType, doc.title);
    if (!canonicalMime) {
        throw new DriveLinkError(
            415,
            "unsupported_type",
            "Only .docx and .pdf documents can be linked to Google Drive."
        );
    }

    const existing = await getDriveLinkForDocument(params.documentId);
    if (existing && existing.status === "linked") {
        return { link: existing, created: false };
    }

    const connection = await getActiveGoogleConnection(params.companyId);
    if (!connection) throw new GoogleNotConnectedError();

    const res = await fetchFile(doc.url);
    if (!res.ok) {
        throw new DriveLinkError(
            502,
            "fetch_failed",
            `Could not read the document from storage (HTTP ${res.status}).`
        );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_LINKED_FILE_BYTES) {
        throw new DriveLinkError(
            413,
            "too_large",
            `The document is larger than the ${Math.floor(MAX_LINKED_FILE_BYTES / (1024 * 1024))} MB linking cap.`
        );
    }

    const accessToken = await getAccessTokenForConnection(connection);
    const folderId = await ensureFolder({ accessToken, name: DRIVE_FOLDER_NAME });
    const created = await createFileMultipart({
        accessToken,
        name: linkedFilename(doc.title, canonicalMime),
        mimeType: canonicalMime,
        data: bytes,
        parents: [folderId],
    });

    const now = new Date();
    const [link] = await db
        .insert(documentDriveLinks)
        .values({
            documentId: BigInt(params.documentId),
            connectionId: BigInt(connection.id),
            linkedByUserId: params.linkedByUserId,
            driveFileId: created.id,
            driveWebViewLink: created.webViewLink ?? null,
            baseVersionId: doc.currentVersionId,
            lastSyncedRevisionId: created.headRevisionId ?? null,
            lastSyncedMd5: created.md5Checksum ?? null,
            status: "linked",
            fidelityWarning: false,
            lastCheckedAt: now,
            lastSyncedAt: now,
            lastError: null,
        })
        .onConflictDoUpdate({
            target: documentDriveLinks.documentId,
            set: {
                connectionId: BigInt(connection.id),
                linkedByUserId: params.linkedByUserId,
                driveFileId: created.id,
                driveWebViewLink: created.webViewLink ?? null,
                baseVersionId: doc.currentVersionId,
                lastSyncedRevisionId: created.headRevisionId ?? null,
                lastSyncedMd5: created.md5Checksum ?? null,
                lastSyncedVersionId: null,
                status: "linked",
                fidelityWarning: false,
                lastCheckedAt: now,
                lastSyncedAt: now,
                lastError: null,
                updatedAt: now,
            },
        })
        .returning();

    if (!link) throw new Error("Failed to record the Drive link");
    return { link, created: true };
}
