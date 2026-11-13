/**
 * Create › File › Write it here: a blank Markdown file the editor opens.
 *
 * The file is a real source from the first moment — stored, versioned and
 * ingested like an upload — seeded with its title as a heading, so the
 * chunker has text and the list never shows an empty mystery row.
 */
import { randomUUID } from "node:crypto";

import { uploadFile } from "~/lib/storage";
import {
    processDocumentUpload,
    type DocumentUploadResult,
} from "~/server/services/document-upload";

/** Drive rejects absurd names elsewhere; the title also names the file. */
export const MAX_FILE_TITLE_LENGTH = 200;

export interface CreateMarkdownFileParams {
    companyId: bigint;
    authUserId: string;
    /** Already trimmed; the caller supplies the default for a blank one. */
    title: string;
    category: string;
    /** Request URL, so ingestion can resolve relative storage URLs. */
    requestUrl: string;
}

export interface CreateMarkdownFileResult {
    documentId: number;
    title: string;
    /** What ingestion inserted, so the route can give it the creator's defaults (ADR-014). */
    upload: Pick<DocumentUploadResult, "document" | "createdDocuments">;
}

/** A filename the storage layer and a download both accept; the title stays as typed. */
export function markdownFilename(title: string): string {
    const base = title
        .replace(/\.(md|markdown)$/i, "")
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
    return `${base || "untitled"}.md`;
}

/** The seed: the title as a level-one heading. */
export function seedMarkdown(title: string): string {
    return `# ${title.replace(/[\r\n]+/g, " ")}\n`;
}

export async function createMarkdownFile(
    params: CreateMarkdownFileParams
): Promise<CreateMarkdownFileResult> {
    const title = params.title.slice(0, MAX_FILE_TITLE_LENGTH);
    const filename = markdownFilename(title);
    const stored = await uploadFile({
        filename,
        data: Buffer.from(seedMarkdown(title), "utf8"),
        contentType: "text/markdown",
        userId: params.authUserId,
        companyId: params.companyId,
    });
    const upload = await processDocumentUpload({
        user: { userId: params.authUserId, companyId: params.companyId },
        documentName: title,
        rawDocumentUrl: stored.url,
        creationKey: `file:create:${randomUUID()}`,
        category: params.category,
        explicitStorageType: stored.provider,
        mimeType: "text/markdown",
        originalFilename: filename,
        requestUrl: params.requestUrl,
    });
    return {
        documentId: upload.document.id,
        title: upload.document.title ?? title,
        upload,
    };
}
