/**
 * What `add_document` and `start_upload` store, worked out from what the
 * assistant sent: the bytes, a file name, the MIME type the file is stored
 * with, the one ingestion reads it as, and whether it is an artifact.
 *
 * The rule that matters: active content (HTML, SVG, React, Mermaid, code) is
 * stored as text/plain and marked as an artifact, so it only ever renders in
 * the viewer's sandboxed frame, never as a page on this app's origin. That
 * holds whoever made it: a ChatGPT HTML document gets the same treatment as a
 * Claude artifact.
 */
import {
    artifactFileExtension,
    artifactIngestMimeType,
    deriveArtifactTitle,
    detectArtifactType,
    type ArtifactType,
} from "~/lib/artifact-content";

/** What `content` is, as the tool's `format` argument names it. */
export const CONTENT_FORMATS = [
    "markdown",
    "text",
    "html",
    "svg",
    "mermaid",
    "react",
    "code",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

/** Where the assistant says the content came from. */
export const CONTENT_ORIGINS = [
    "claude-artifact",
    "claude",
    "claude-code",
    "chatgpt",
    "codex",
    "gemini",
    "other",
] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

const ACTIVE_FORMATS: ReadonlySet<ContentFormat> = new Set([
    "html",
    "svg",
    "mermaid",
    "react",
    "code",
]);

export interface PreparedContent {
    data: Buffer;
    filename: string;
    /** The type the bytes are stored with. */
    storageMimeType: string;
    /** The type ingestion reads them as. */
    ingestMimeType: string;
    artifactType: ArtifactType | null;
    suggestedTitle: string;
}

/** A name storage accepts, from a human title. */
export function fileBase(title: string, fallback = "document"): string {
    return (
        title
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 100) || fallback
    );
}

/** The first Markdown heading, or the first non-empty line, as a title. */
export function firstLineTitle(content: string): string | null {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(content);
    const line =
        heading?.[1] ??
        content
            .split(/\r?\n/)
            .map(entry => entry.trim())
            .find(entry => entry.length > 0);
    if (!line) return null;
    const plain = line.replace(/[*_`#>[\]]/g, "").trim();
    if (!plain) return null;
    return plain.length > 80 ? `${plain.slice(0, 77).trimEnd()}…` : plain;
}

function artifactTypeFor(
    content: string,
    format: ContentFormat | undefined,
    origin: ContentOrigin | undefined
): ArtifactType | null {
    if (format && ACTIVE_FORMATS.has(format)) return format as ArtifactType;
    if (origin === "claude-artifact") {
        if (format === "markdown") return "markdown";
        if (format === "text") return "code";
        return detectArtifactType(content);
    }
    if (!format) {
        // Unlabelled content that is plainly markup is still active content.
        const detected = detectArtifactType(content);
        if (detected === "html" || detected === "svg") return detected;
    }
    return null;
}

/** Bytes and types for text an assistant holds (an artifact's source, a document). */
export function prepareTextContent(input: {
    content: string;
    format?: ContentFormat;
    origin?: ContentOrigin;
    title?: string;
}): PreparedContent {
    const artifactType = artifactTypeFor(input.content, input.format, input.origin);
    const derived = artifactType
        ? deriveArtifactTitle(input.content, artifactType)
        : firstLineTitle(input.content);
    const given = input.title?.trim();
    let suggestedTitle = derived ?? "Untitled document";
    if (given) suggestedTitle = given;
    const data = Buffer.from(input.content, "utf8");
    if (artifactType) {
        return {
            data,
            filename: `${fileBase(suggestedTitle, "artifact")}.${artifactFileExtension(artifactType)}`,
            storageMimeType: "text/plain",
            ingestMimeType: artifactIngestMimeType(artifactType),
            artifactType,
            suggestedTitle,
        };
    }
    const markdown = input.format !== "text";
    return {
        data,
        filename: `${fileBase(suggestedTitle)}.${markdown ? "md" : "txt"}`,
        storageMimeType: markdown ? "text/markdown" : "text/plain",
        ingestMimeType: markdown ? "text/markdown" : "text/plain",
        artifactType: null,
        suggestedTitle,
    };
}

/**
 * File types an assistant may hand over as a file, by extension: what the
 * ingestion pipeline reads. The MIME type is what ingestion is told.
 */
const FILE_TYPES: Readonly<Record<string, string>> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp",
    ".eml": "message/rfc822",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
};

/** Extensions `start_upload` and ChatGPT files may have, for messages. */
export const SUPPORTED_FILE_EXTENSIONS = Object.keys(FILE_TYPES);

/** MIME types stored as text/plain because a browser would run them. */
const ACTIVE_MIME_TYPES = new Set(["text/html", "image/svg+xml", "application/xhtml+xml"]);

export interface FileTypes {
    /** The type the bytes are stored with. */
    storageMimeType: string;
    /** The type ingestion reads them as. */
    ingestMimeType: string;
    /** Set for HTML and SVG files: they are shown sandboxed, as artifacts. */
    artifactType: ArtifactType | null;
}

function extensionOf(filename: string): string {
    const match = /(\.[A-Za-z0-9]+)$/.exec(filename.trim());
    return match ? match[1]!.toLowerCase() : "";
}

/** Types for a file by its name, or null when ingestion cannot read that kind of file. */
export function fileTypesFor(filename: string, declaredMimeType?: string | null): FileTypes | null {
    const fromName = FILE_TYPES[extensionOf(filename)];
    const declared = declaredMimeType?.split(";")[0]?.trim().toLowerCase() ?? null;
    const known = new Set(Object.values(FILE_TYPES));
    const mime = fromName ?? (declared && known.has(declared) ? declared : null);
    if (!mime) return null;
    if (ACTIVE_MIME_TYPES.has(mime)) {
        const artifactType: ArtifactType = mime === "image/svg+xml" ? "svg" : "html";
        return {
            storageMimeType: "text/plain",
            ingestMimeType: artifactIngestMimeType(artifactType),
            artifactType,
        };
    }
    return { storageMimeType: mime, ingestMimeType: mime, artifactType: null };
}

/** A file's title from its name: the name without its extension. */
export function titleFromFilename(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? filename;
    const withoutExt = base.replace(/\.[A-Za-z0-9]+$/, "").trim();
    return withoutExt || base || "Untitled file";
}

/** A file name storage accepts, keeping the extension. */
export function safeFilename(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? filename;
    return `${fileBase(titleFromFilename(base), "file")}${extensionOf(base)}`;
}
