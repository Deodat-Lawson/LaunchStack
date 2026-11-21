/**
 * What a public link shows about its file, and nothing more.
 *
 * Left out on purpose: the folder path (`category`), the document id, who
 * added it, internal URLs (`/api/files/<id>`, storage keys), and any
 * `ocrMetadata` a viewer does not need to pick its renderer (errors, OCR
 * details, a Claude Code session's project path and branch, an artifact's
 * source URL). Every URL the client gets is under `/api/s/<token>`.
 */

import { and, asc, eq } from "drizzle-orm";

import { document, documentContextChunks, fileUploads } from "@launchstack/store/schema";
import {
    getDocumentDisplayType,
    type DocumentDisplayType,
} from "~/app/employer/documents/types/document";
import { readableMarkdown } from "~/lib/indexed-text";
import { mediaMimeFromName } from "~/lib/media-document";
import { db } from "~/server/db";
import type { ResolvedPublicLink } from "~/server/workspace/public-links";
import { workspaceName } from "~/server/workspace/item-access";

import { readStoredText } from "./bytes";

export interface PublicDocumentRow {
    title: string;
    /** The folder, for finding a recording's transcript beside it. Never sent to a browser. */
    category: string;
    url: string;
    mimeType: string | null;
    ocrMetadata: Record<string, unknown> | null;
    currentVersionId: bigint | null;
    createdAt: Date;
    updatedAt: Date;
}

/** The document behind a resolved link (same workspace), or null if it is gone. */
export async function loadPublicDocumentRow(
    link: ResolvedPublicLink
): Promise<PublicDocumentRow | null> {
    const [row] = await db
        .select({
            title: document.title,
            category: document.category,
            url: document.url,
            mimeType: document.mimeType,
            ocrMetadata: document.ocrMetadata,
            currentVersionId: document.currentVersionId,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
        })
        .from(document)
        .where(and(eq(document.id, link.documentId), eq(document.companyId, link.companyId)))
        .limit(1);
    if (!row) return null;
    const meta = row.ocrMetadata;
    return {
        title: row.title,
        category: row.category,
        url: row.url,
        mimeType: row.mimeType ?? (await uploadedMimeType(row.url, link.companyId)),
        ocrMetadata:
            meta && typeof meta === "object" && !Array.isArray(meta)
                ? (meta as Record<string, unknown>)
                : null,
        currentVersionId: row.currentVersionId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
    };
}

const FILE_API_PATH = /^(?:https?:\/\/[^/]+)?\/api\/files\/(\d+)(?:[?#].*)?$/;

/** A row with no type of its own takes its upload's, as `/api/fetchDocument` does. */
async function uploadedMimeType(url: string, companyId: bigint): Promise<string | null> {
    const match = FILE_API_PATH.exec(url);
    if (!match) return null;
    const [file] = await db
        .select({ mimeType: fileUploads.mimeType })
        .from(fileUploads)
        .where(and(eq(fileUploads.id, Number(match[1])), eq(fileUploads.companyId, companyId)))
        .limit(1);
    // An empty stored type is no type.
    return file?.mimeType?.trim().length ? file.mimeType.trim() : null;
}

/** Keys a viewer reads to pick and label its renderer. Everything else stays home. */
const VIEWER_METADATA_KEYS = [
    "kind",
    "mindmapId",
    "capturedAt",
    "connector",
    "clientName",
    "model",
    "startedAt",
    "endedAt",
    "savedAt",
    "source",
    "audioDocumentId",
    "language",
    "artifactType",
    "importedAt",
] as const;

/** The marker fields the viewers need; the saved page's own address only for a website. */
export function publicViewerMetadata(
    meta: Record<string, unknown> | null
): Record<string, unknown> | null {
    if (!meta) return null;
    const out: Record<string, unknown> = {};
    for (const key of VIEWER_METADATA_KEYS) {
        const value = meta[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            out[key] = value;
        }
    }
    // A saved web page's address is what the page is; a public address by construction.
    if (meta.kind === "website" && typeof meta.url === "string") out.url = meta.url;
    // `isFromClaude` reads where an artifact came from, not who sent it.
    const addedFrom = meta.addedFrom;
    if (addedFrom && typeof addedFrom === "object" && !Array.isArray(addedFrom)) {
        const origin = (addedFrom as { origin?: unknown }).origin;
        if (typeof origin === "string") out.addedFrom = { origin };
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** Everything the public page and `GET /api/s/<token>` hand a browser. */
export interface PublicDocument {
    title: string;
    displayType: DocumentDisplayType;
    mimeType: string | null;
    ocrMetadata: Record<string, unknown> | null;
    workspaceName: string;
    updatedAt: string;
    /** ISO time, or null for never. */
    expiresAt: string | null;
    allowDownload: boolean;
    /** The bytes, for viewers and players (`inline`). */
    contentUrl: string;
    /** The bytes as a download, when the link allows it. */
    downloadUrl: string | null;
    /** The same file as Markdown, for an AI agent. */
    markdownUrl: string;
    /** The JSON the rich viewers fetch (`text`, `media`, `mindmap`, `website-preview`) live under here. */
    apiBase: string;
}

export function publicApiBase(token: string): string {
    return `/api/s/${token}`;
}

export async function toPublicDocument(
    link: ResolvedPublicLink,
    row: PublicDocumentRow
): Promise<PublicDocument> {
    const apiBase = publicApiBase(link.token);
    return {
        title: row.title,
        displayType: getDocumentDisplayType({
            title: row.title,
            url: row.url,
            mimeType: row.mimeType ?? undefined,
            ocrMetadata: row.ocrMetadata,
        }),
        mimeType: row.mimeType,
        ocrMetadata: publicViewerMetadata(row.ocrMetadata),
        workspaceName: await workspaceName(link.companyId),
        updatedAt: row.updatedAt.toISOString(),
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        allowDownload: link.allowDownload,
        contentUrl: `${apiBase}/content`,
        downloadUrl: link.allowDownload ? `${apiBase}/content?download=1` : null,
        markdownUrl: `/s/${link.token}.md`,
        apiBase,
    };
}

/** A type to serve the bytes as when storage does not say. */
export function fallbackMimeType(row: PublicDocumentRow): string {
    return row.mimeType ?? mediaMimeFromName(row.title) ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Far more than any real document; a runaway file is cut and says so. */
export const PUBLIC_TEXT_MAX_CHARS = 1_000_000;
/** How much of a text file is read when it has no indexed text yet. */
const RAW_TEXT_MAX_BYTES = 2_000_000;

const TEXT_LIKE: ReadonlySet<DocumentDisplayType> = new Set(["markdown", "text", "code"]);

export interface PublicDocumentText {
    markdown: string;
    /** False when there is no text to give (not processed yet, or nothing readable). */
    available: boolean;
    truncated: boolean;
}

/**
 * The file's words as Markdown: the current version's indexed text with its
 * headings put back (`readableMarkdown`), or, for a text file that has not
 * been indexed yet, the file itself.
 */
export async function publicDocumentText(
    link: ResolvedPublicLink,
    row: PublicDocumentRow,
    displayType: DocumentDisplayType
): Promise<PublicDocumentText> {
    const chunks =
        row.currentVersionId === null
            ? []
            : await db
                  .select({ content: documentContextChunks.content })
                  .from(documentContextChunks)
                  .where(
                      and(
                          eq(documentContextChunks.documentId, BigInt(link.documentId)),
                          eq(documentContextChunks.versionId, row.currentVersionId)
                      )
                  )
                  .orderBy(asc(documentContextChunks.pageNumber), asc(documentContextChunks.id));

    let markdown = "";
    // A text file reads best as itself; indexed text is the fallback there.
    if (TEXT_LIKE.has(displayType)) {
        const raw = await readStoredText(row.url, link.companyId, RAW_TEXT_MAX_BYTES).catch(
            () => null
        );
        if (raw?.trim()) {
            markdown = displayType === "code" ? fenced(raw, row.title) : raw;
        }
    }
    if (!markdown && chunks.length > 0) {
        markdown = readableMarkdown(
            chunks.map(c => c.content),
            row.title
        );
    }

    const truncated = markdown.length > PUBLIC_TEXT_MAX_CHARS;
    return {
        markdown: truncated ? markdown.slice(0, PUBLIC_TEXT_MAX_CHARS) : markdown,
        available: markdown.trim().length > 0,
        truncated,
    };
}

function fenced(source: string, title: string): string {
    const ext = /\.([a-z0-9]+)$/i.exec(title)?.[1]?.toLowerCase() ?? "";
    let fence = "```";
    while (source.includes(fence)) fence += "`";
    return `${fence}${ext}\n${source.replace(/\n$/, "")}\n${fence}`;
}

/**
 * The whole Markdown document an agent gets from `/s/<token>.md`: a title,
 * one line saying what it is, then the text.
 */
export function agentMarkdown(
    doc: PublicDocument,
    text: PublicDocumentText,
    words: { sharedFrom: string; noText: string; truncated: string }
): string {
    const lines = [`# ${doc.title}`, "", `> ${words.sharedFrom}`, ""];
    if (!text.available) {
        lines.push(words.noText);
    } else {
        lines.push(text.markdown.trim());
        if (text.truncated) lines.push("", `> ${words.truncated}`);
    }
    return lines.join("\n") + "\n";
}
