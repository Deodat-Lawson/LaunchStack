/**
 * Create → Google Doc: a document born in Google Docs.
 *
 * The inverse of {@link linkDocumentToDrive}, which copies bytes LaunchStack
 * already holds *out* to Drive. Here Drive holds the original: we create a
 * native Google Doc, export it once for the workspace to index, and record the
 * durable link with `origin: "created"` so the rest of the Drive-linked files
 * machinery (reconciler, banner, unlink) treats it as the original rather than
 * a copy.
 *
 * The Doc is seeded with its title as a heading. That is not decoration — it
 * is what the user expects to see when the tab opens, and it gives the chunker
 * real text so the source row is never an empty mystery in the list.
 */
import { eq } from "drizzle-orm";

import {
    DOCX_MIME,
    GOOGLE_DOC_MIME,
    createFileMultipart,
    ensureFolder,
    exportFileContent,
    trashFile,
} from "@launchstack/google-drive";
import { document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { documentDriveLinks } from "~/server/db/schema";
import { uploadFile } from "~/lib/storage";
import { processDocumentUpload } from "~/server/services/document-upload";

import { DRIVE_FOLDER_NAME, isDriveLinkingEnabled } from "./config";
import {
    GoogleNotConnectedError,
    getAccessTokenForConnection,
    getActiveGoogleConnection,
} from "./connections";
import { DriveLinkError, linkedFilename } from "./links";

/** Drive rejects absurd names, and the title also becomes the document title. */
const MAX_TITLE_LENGTH = 200;

export const DEFAULT_GOOGLE_DOC_TITLE = "Untitled document";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Minimal HTML Drive converts into a native Doc with the title as Heading 1. */
function seedHtml(title: string): Buffer {
    const safe = escapeHtml(title);
    return Buffer.from(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safe}</title></head>` +
            `<body><h1>${safe}</h1></body></html>`,
        "utf8"
    );
}

export interface CreateGoogleDocParams {
    companyId: bigint;
    authUserId: string;
    userPk: bigint | null;
    title: string;
    category: string;
    /** Request URL, so the ingestion stage can resolve relative storage URLs. */
    requestUrl: string;
}

export interface CreateGoogleDocResult {
    documentId: number;
    driveFileId: string;
    url: string | null;
}

export async function createGoogleDocDocument(
    params: CreateGoogleDocParams
): Promise<CreateGoogleDocResult> {
    if (!isDriveLinkingEnabled()) {
        throw new DriveLinkError(
            404,
            "feature_disabled",
            "Google Drive linking is not enabled on this deployment."
        );
    }

    const title = params.title.trim().slice(0, MAX_TITLE_LENGTH) || DEFAULT_GOOGLE_DOC_TITLE;

    const connection = await getActiveGoogleConnection(params.companyId);
    if (!connection) throw new GoogleNotConnectedError();

    const accessToken = await getAccessTokenForConnection(connection);
    const folderId = await ensureFolder({ accessToken, name: DRIVE_FOLDER_NAME });

    const created = await createFileMultipart({
        accessToken,
        name: title,
        // Drive converts the HTML body into a native Doc on the way in.
        mimeType: "text/html",
        targetMimeType: GOOGLE_DOC_MIME,
        data: seedHtml(title),
        parents: [folderId],
    });

    // Everything past this point can fail with a real file already sitting in
    // someone's Drive. Trash it rather than leaving an orphan they never asked
    // for and cannot trace back to us.
    try {
        // Export rather than reuse the HTML we uploaded: this is byte-for-byte
        // what the next sync will fetch, so the first pull after a real edit
        // produces a clean v2 instead of a spurious one.
        const docx = await exportFileContent({
            accessToken,
            fileId: created.id,
            mimeType: DOCX_MIME,
        });

        const filename = linkedFilename(title, DOCX_MIME);
        const stored = await uploadFile({
            filename,
            data: docx,
            contentType: DOCX_MIME,
            userId: params.authUserId,
            companyId: params.companyId,
        });

        const upload = await processDocumentUpload({
            user: { userId: params.authUserId, companyId: params.companyId },
            documentName: title,
            rawDocumentUrl: stored.url,
            // A retried create converges on one document instead of twins.
            creationKey: `gdocs:create:${created.id}`,
            category: params.category,
            explicitStorageType: stored.provider,
            mimeType: DOCX_MIME,
            originalFilename: filename,
            requestUrl: params.requestUrl,
        });

        const [row] = await db
            .select({ currentVersionId: document.currentVersionId })
            .from(document)
            .where(eq(document.id, upload.document.id));

        const now = new Date();
        await db
            .insert(documentDriveLinks)
            .values({
                documentId: BigInt(upload.document.id),
                connectionId: BigInt(connection.id),
                linkedByUserId: params.userPk,
                driveFileId: created.id,
                driveWebViewLink: created.webViewLink ?? null,
                baseVersionId: row?.currentVersionId ?? null,
                // Seed the marker so the reconciler's first tick doesn't
                // re-export content identical to the version we just made.
                lastSyncedRevisionId: created.version ? `v${created.version}` : null,
                // Native Docs carry no md5; the version counter is the gate.
                lastSyncedMd5: null,
                status: "linked",
                origin: "created",
                fidelityWarning: false,
                lastCheckedAt: now,
                lastSyncedAt: now,
                lastError: null,
            })
            .onConflictDoUpdate({
                target: documentDriveLinks.documentId,
                set: {
                    connectionId: BigInt(connection.id),
                    linkedByUserId: params.userPk,
                    driveFileId: created.id,
                    driveWebViewLink: created.webViewLink ?? null,
                    baseVersionId: row?.currentVersionId ?? null,
                    lastSyncedVersionId: null,
                    lastSyncedRevisionId: created.version ? `v${created.version}` : null,
                    lastSyncedMd5: null,
                    status: "linked",
                    origin: "created",
                    fidelityWarning: false,
                    lastCheckedAt: now,
                    lastSyncedAt: now,
                    lastError: null,
                    updatedAt: now,
                },
            });

        return {
            documentId: upload.document.id,
            driveFileId: created.id,
            url: created.webViewLink ?? null,
        };
    } catch (err) {
        try {
            await trashFile({ accessToken, fileId: created.id });
        } catch (cleanupErr) {
            console.warn(
                `[google-docs] Could not trash orphaned Drive file ${created.id}: ` +
                    `${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
            );
        }
        throw err;
    }
}
