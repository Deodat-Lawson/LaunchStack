/**
 * The in-app editor's load and save (GET / PUT /api/documents/[id]/editable).
 *
 * One path for every editable kind. The client always speaks HTML (or plain
 * text for a .txt); this module converts per kind and writes a new version:
 *
 *   markdown / text / docx  →  bytes → storage → version lifecycle
 *   Drive-linked            →  push to the Drive file → pull it back as a
 *                              version credited to the editor
 *
 * A Drive-linked file is read fresh from Drive when the editor opens and its
 * save goes back to Drive first, so Drive stays the original and no in-app
 * write forks it. The `base` token the editor carries is what the save is
 * checked against: the version it opened (`v:<versionId>`) or the Drive
 * revision it opened (`drive:<marker>`). A mismatch is refused before
 * anything is written.
 */
import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
    DOCX_MIME,
    GOOGLE_DOC_MIME,
    GoogleAuthError,
    GoogleDriveError,
    downloadFileContent,
    exportFileContent,
    getFileMetadata,
    updateFileMedia,
    type DriveFileMetadata,
} from "@launchstack/google-drive";
import { documentVersions } from "@launchstack/store/schema";

import { db } from "~/server/db";
import {
    connectorConnections,
    documentDriveLinks,
    type ConnectorConnection,
    type DocumentDriveLink,
} from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import { fetchFile, uploadFile } from "~/lib/storage";
import { EDITABLE_KIND_MIME, editableKindOf, type EditableKind } from "~/lib/file-editing";
import {
    createDocumentVersionLifecycle,
    StaleDocumentVersionError,
} from "~/server/services/document-creation";
import { isDriveLinkingEnabled } from "~/server/services/google-drive/config";
import {
    GoogleNotConnectedError,
    getAccessTokenForConnection,
} from "~/server/services/google-drive/connections";
import {
    getActiveDriveLink,
    getDriveLinkForDocument,
    resolveCanonicalMime,
} from "~/server/services/google-drive/links";
import { pullDriveLink, toProcessingUrl } from "~/server/services/google-drive/sync";

import {
    decodeText,
    docxToHtml,
    htmlToDocx,
    htmlToMarkdown,
    markdownHasRawHtml,
    markdownToHtml,
    sanitizeEditorHtml,
    splitFrontMatter,
    wrapHtmlDocument,
} from "./convert";

/** Stored as the version's changelog; English like the Drive pull's. */
export const EDIT_CHANGELOG = "Edited in LaunchStack";

/**
 * Largest file the editor opens, and largest save it accepts. A Word file's
 * pictures travel back as base64 (a third larger), so the save limit sits
 * above the open limit; and a file whose editor content would not fit under
 * it is refused when it opens, not after someone has edited it.
 */
export const MAX_EDITABLE_BYTES = 20 * 1024 * 1024;
export const MAX_SAVE_BYTES = 32 * 1024 * 1024;

/** A refusal the route words from `fileEditing.server.<key>`. */
export class FileEditError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        public readonly key: string,
        public readonly values: Record<string, string> = {}
    ) {
        super(`${code}: ${key}`);
        this.name = "FileEditError";
    }
}

export interface EditableDocument {
    id: number;
    companyId: bigint;
    title: string;
    category: string;
    url: string;
    mimeType: string | null;
    fileType: string | null;
    currentVersionId: bigint | null;
    ocrMetadata: unknown;
}

export interface EditablePayload {
    documentId: number;
    title: string;
    kind: EditableKind;
    mode: "rich" | "plain";
    html: string;
    text: string;
    base: string;
    drive: { url: string | null; native: boolean } | null;
    /** `fileEditing.server.<key>` for the notice line, or null. */
    noticeKey: "docxNotice" | "driveNotice" | "markdownRawHtmlNotice" | null;
}

export interface SaveResult {
    versionId: number;
    versionNumber: number;
    base: string;
    /**
     * The save reached Google Drive but LaunchStack could not pull it back
     * yet; the reconciler will. The version numbers are the previous ones.
     */
    syncPending?: boolean;
}

// ---------------------------------------------------------------------------
// Drive context
// ---------------------------------------------------------------------------

interface DriveContext {
    link: DocumentDriveLink;
    connection: ConnectorConnection;
    accessToken: string;
}

function driveMarker(meta: DriveFileMetadata): string {
    const native = meta.mimeType === GOOGLE_DOC_MIME;
    const marker = native
        ? meta.version
            ? `v${meta.version}`
            : null
        : (meta.headRevisionId ?? null);
    return marker ?? `t${meta.modifiedTime ?? "unknown"}`;
}

/** The document's live Drive link with a usable token, or null when it has none. */
async function driveContextFor(doc: EditableDocument): Promise<DriveContext | null> {
    const link = await getActiveDriveLink(doc.id);
    if (!link) return null;

    if (resolveCanonicalMime(doc.fileType, doc.mimeType, doc.title) !== DOCX_MIME) {
        // A linked PDF: Drive edits it, this editor cannot.
        throw new FileEditError(415, "not_editable", "notEditable");
    }
    if (!isDriveLinkingEnabled()) {
        throw new FileEditError(502, "drive_unavailable", "driveDisabled");
    }

    const [connection] = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.id, Number(link.connectionId)))
        .limit(1);
    if (!connection || connection.status !== "active") {
        throw new FileEditError(409, "google_not_connected", "googleNotConnected");
    }
    try {
        return { link, connection, accessToken: await getAccessTokenForConnection(connection) };
    } catch (err) {
        throw toDriveEditError(err);
    }
}

function toDriveEditError(err: unknown): unknown {
    if (err instanceof FileEditError) return err;
    if (err instanceof GoogleNotConnectedError) {
        return new FileEditError(409, "google_not_connected", "googleNotConnected");
    }
    if (err instanceof GoogleAuthError) {
        return new FileEditError(409, "google_not_connected", "googleNotConnected");
    }
    if (err instanceof GoogleDriveError) {
        return new FileEditError(502, "drive_unavailable", "driveUnavailable");
    }
    return err;
}

async function markOrphaned(link: DocumentDriveLink, lastError: string): Promise<void> {
    const now = new Date();
    await db
        .update(documentDriveLinks)
        .set({ status: "orphaned", lastCheckedAt: now, lastError, updatedAt: now })
        .where(eq(documentDriveLinks.id, link.id));
}

/**
 * The Drive file's metadata, or null when it is gone — deleted or trashed,
 * which orphans the link (the same words the pull writes).
 */
async function liveDriveFile(ctx: DriveContext): Promise<DriveFileMetadata | null> {
    let meta: DriveFileMetadata;
    try {
        meta = await getFileMetadata({
            accessToken: ctx.accessToken,
            fileId: ctx.link.driveFileId,
        });
    } catch (err) {
        if (
            err instanceof GoogleDriveError &&
            !(err instanceof GoogleAuthError) &&
            err.isNotFound
        ) {
            await markOrphaned(ctx.link, "The linked Drive file no longer exists.");
            return null;
        }
        throw toDriveEditError(err);
    }
    if (meta.trashed) {
        await markOrphaned(ctx.link, "The linked Drive file is in the Drive trash.");
        return null;
    }
    if (meta.mimeType !== GOOGLE_DOC_MIME && meta.mimeType !== DOCX_MIME) {
        // Converted in Drive to something this editor does not write.
        throw new FileEditError(415, "not_editable", "notEditable");
    }
    return meta;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function versionBase(doc: Pick<EditableDocument, "currentVersionId">): string {
    return `v:${doc.currentVersionId ?? "none"}`;
}

async function readStoredBytes(doc: EditableDocument): Promise<Buffer> {
    const res = await fetchFile(doc.url);
    if (!res.ok) {
        throw new FileEditError(502, "read_failed", "readFailed", { status: String(res.status) });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_EDITABLE_BYTES) {
        throw new FileEditError(413, "too_large", "tooLarge", {
            mb: String(MAX_EDITABLE_BYTES / (1024 * 1024)),
        });
    }
    return bytes;
}

async function loadStored(doc: EditableDocument, kind: EditableKind): Promise<EditablePayload> {
    const bytes = await readStoredBytes(doc);
    const common = {
        documentId: doc.id,
        title: doc.title,
        kind,
        base: versionBase(doc),
        drive: null,
    };
    if (kind === "text") {
        return { ...common, mode: "plain", html: "", text: decodeText(bytes), noticeKey: null };
    }
    if (kind === "markdown") {
        const markdown = decodeText(bytes);
        return {
            ...common,
            mode: "rich",
            html: markdownToHtml(markdown),
            text: "",
            noticeKey: markdownHasRawHtml(markdown) ? "markdownRawHtmlNotice" : null,
        };
    }
    return {
        ...common,
        mode: "rich",
        html: await docxToHtml(bytes),
        text: "",
        noticeKey: "docxNotice",
    };
}

/**
 * What the editor sends back must fit under the save limit: a file that could
 * open but never save would only be found out after someone had edited it.
 */
export function ensureSavable<T extends Pick<EditablePayload, "html" | "text">>(payload: T): T {
    if (Buffer.byteLength(payload.html || payload.text, "utf8") > MAX_SAVE_BYTES) {
        throw new FileEditError(413, "too_large", "tooLarge", {
            mb: String(MAX_SAVE_BYTES / (1024 * 1024)),
        });
    }
    return payload;
}

export async function loadEditable(doc: EditableDocument): Promise<EditablePayload> {
    return ensureSavable(await loadEditableContent(doc));
}

async function loadEditableContent(doc: EditableDocument): Promise<EditablePayload> {
    const drive = await driveContextFor(doc);
    if (drive) {
        const meta = await liveDriveFile(drive);
        if (meta) {
            const native = meta.mimeType === GOOGLE_DOC_MIME;
            let bytes: Buffer;
            try {
                bytes = native
                    ? await exportFileContent({
                          accessToken: drive.accessToken,
                          fileId: drive.link.driveFileId,
                          // Word, not HTML: Docs' HTML export carries its
                          // formatting in class styles, and the editor would
                          // lose bold and italics with the stylesheet.
                          mimeType: DOCX_MIME,
                      })
                    : await downloadFileContent({
                          accessToken: drive.accessToken,
                          fileId: drive.link.driveFileId,
                      });
            } catch (err) {
                throw toDriveEditError(err);
            }
            return {
                documentId: doc.id,
                title: doc.title,
                kind: "docx",
                mode: "rich",
                html: await docxToHtml(bytes),
                text: "",
                base: `drive:${driveMarker(meta)}`,
                drive: { url: drive.link.driveWebViewLink ?? meta.webViewLink ?? null, native },
                noticeKey: "driveNotice",
            };
        }
        // The Drive file is gone: the link is orphaned, the stored copy is
        // the document again.
    }

    const kind = editableKindOf(doc);
    if (!kind) throw new FileEditError(415, "not_editable", "notEditable");
    return loadStored(doc, kind);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveEditableParams {
    doc: EditableDocument;
    base: string;
    html?: string;
    text?: string;
    /** Auth user id of the editor; the version is theirs. */
    userId: string;
    requestUrl: string;
}

const EXTENSION: Record<EditableKind, string> = {
    markdown: ".md",
    text: ".txt",
    docx: ".docx",
};

function filenameFor(title: string, kind: EditableKind): string {
    const ext = EXTENSION[kind];
    const lower = title.toLowerCase();
    if (lower.endsWith(ext) || (kind === "markdown" && lower.endsWith(".markdown"))) return title;
    return `${title}${ext}`;
}

function requireContent(
    kind: EditableKind,
    params: Pick<SaveEditableParams, "html" | "text">
): string {
    const value = kind === "text" ? params.text : params.html;
    if (typeof value !== "string") throw new FileEditError(400, "invalid", "invalid");
    return value;
}

async function currentVersionNumber(
    doc: EditableDocument
): Promise<{ versionId: number; versionNumber: number }> {
    const [row] = await db
        .select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber })
        .from(documentVersions)
        .where(
            and(
                eq(documentVersions.documentId, BigInt(doc.id)),
                eq(documentVersions.id, Number(doc.currentVersionId ?? 0))
            )
        )
        .limit(1);
    return { versionId: row?.id ?? 0, versionNumber: row?.versionNumber ?? 0 };
}

/** Namespace for the per-document edit lock (pg_advisory_xact_lock's first key). */
const EDIT_LOCK_NAMESPACE = 0x46454454; // "FEDT"

/**
 * One Drive save per document at a time, across every app instance. The
 * revision check and the push must not interleave with another save of the
 * same file, or both pass the check and the second silently replaces the
 * first. The lock lives in a transaction that does nothing else; the work
 * itself runs on the pool as usual, and the lock lets go when it returns.
 */
async function withDocumentEditLock<T>(documentId: number, run: () => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(${EDIT_LOCK_NAMESPACE}, ${documentId})`);
        return run();
    });
}

async function saveToDrive(params: SaveEditableParams, drive: DriveContext): Promise<SaveResult> {
    return withDocumentEditLock(params.doc.id, () => saveToDriveLocked(params, drive));
}

async function saveToDriveLocked(
    params: SaveEditableParams,
    drive: DriveContext
): Promise<SaveResult> {
    const { doc } = params;
    if (!params.base.startsWith("drive:")) {
        // It was linked to Drive after the editor opened.
        throw new FileEditError(409, "changed_since_opened", "changedSinceOpened");
    }
    const html = requireContent("docx", params);

    const meta = await liveDriveFile(drive);
    if (!meta) throw new FileEditError(502, "drive_unavailable", "driveFileGone");
    if (`drive:${driveMarker(meta)}` !== params.base) {
        throw new FileEditError(409, "changed_since_opened", "changedInGoogleDocs");
    }

    const native = meta.mimeType === GOOGLE_DOC_MIME;
    try {
        if (native) {
            // Drive converts an HTML upload into the Doc's new body.
            const body = sanitizeEditorHtml(html, { allowRemoteImages: true });
            await updateFileMedia({
                accessToken: drive.accessToken,
                fileId: drive.link.driveFileId,
                mimeType: "text/html",
                data: Buffer.from(wrapHtmlDocument(body, doc.title), "utf8"),
            });
        } else {
            await updateFileMedia({
                accessToken: drive.accessToken,
                fileId: drive.link.driveFileId,
                mimeType: DOCX_MIME,
                data: await htmlToDocx(html, doc.title),
            });
        }
    } catch (err) {
        throw toDriveEditError(err);
    }

    // Pull it straight back: the version is the editor's, not Google's, and
    // recording the revision makes the reconciler's next tick a no-op.
    const outcome = await pullDriveLink(drive.link, {
        force: true,
        requestUrl: params.requestUrl,
        actor: params.userId,
        changelog: EDIT_CHANGELOG,
    });
    const after = await getDriveLinkForDocument(doc.id);
    const base = after?.lastSyncedRevisionId ? `drive:${after.lastSyncedRevisionId}` : params.base;
    if (outcome.kind === "synced") {
        return { versionId: outcome.versionId, versionNumber: outcome.versionNumber, base };
    }
    const current = await currentVersionNumber(doc);
    if (outcome.kind === "noop") return { ...current, base };
    console.warn(
        `[file-editing] doc=${doc.id} pushed to Drive but the pull returned ${outcome.kind}`
    );
    return { ...current, base, syncPending: true };
}

async function saveStored(params: SaveEditableParams, kind: EditableKind): Promise<SaveResult> {
    const { doc } = params;
    if (params.base !== versionBase(doc)) {
        throw new FileEditError(409, "changed_since_opened", "changedSinceOpened");
    }
    const content = requireContent(kind, params);

    let bytes: Buffer;
    if (kind === "text") bytes = Buffer.from(content, "utf8");
    else if (kind === "markdown") {
        // Front matter never went to the editor; it goes back as it was. The
        // base check above means the stored file is the one that was opened.
        const { frontMatter } = splitFrontMatter(decodeText(await readStoredBytes(doc)));
        bytes = Buffer.from(frontMatter + htmlToMarkdown(content), "utf8");
    } else bytes = await htmlToDocx(content, doc.title);

    // The version keeps the type the document was created with (the
    // versions route enforces the same match).
    const mimeType = doc.fileType ?? doc.mimeType ?? EDITABLE_KIND_MIME[kind];
    const filename = filenameFor(doc.title, kind);

    getEngine();
    const blob = await uploadFile({
        filename,
        data: bytes,
        contentType: mimeType,
        userId: params.userId,
        companyId: doc.companyId,
    });
    const digest = createHash("sha256").update(bytes).digest("hex");
    let lifecycle: Awaited<ReturnType<typeof createDocumentVersionLifecycle>>;
    try {
        lifecycle = await createDocumentVersionLifecycle({
            documentId: doc.id,
            companyId: doc.companyId,
            userId: params.userId,
            title: doc.title,
            category: doc.category,
            url: blob.url,
            processingUrl: toProcessingUrl(blob.url, params.requestUrl),
            // A retried save of the same bytes over the same base converges on
            // one version instead of two.
            creationKey: `edit:${doc.id}:${params.base}:${digest}`,
            mimeType,
            fileSize: bytes.length,
            changelog: EDIT_CHANGELOG,
            originalFilename: filename,
            // Checked again under the document's row lock: two saves sent from the
            // same version at the same moment cannot both land.
            expectedCurrentVersionId: doc.currentVersionId,
        });
    } catch (err) {
        if (err instanceof StaleDocumentVersionError) {
            throw new FileEditError(409, "changed_since_opened", "changedSinceOpened");
        }
        throw err;
    }
    return {
        versionId: lifecycle.versionId,
        versionNumber: lifecycle.version.versionNumber,
        base: `v:${lifecycle.versionId}`,
    };
}

export async function saveEditable(params: SaveEditableParams): Promise<SaveResult> {
    const drive = await driveContextFor(params.doc);
    if (drive) return saveToDrive(params, drive);

    if (params.base.startsWith("drive:")) {
        // Opened as a Drive file that has since been unlinked or orphaned.
        throw new FileEditError(409, "changed_since_opened", "changedSinceOpened");
    }
    const kind = editableKindOf(params.doc);
    if (!kind) throw new FileEditError(415, "not_editable", "notEditable");
    return saveStored(params, kind);
}
