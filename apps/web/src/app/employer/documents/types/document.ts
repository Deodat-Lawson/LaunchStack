// Document-related types

import { isMindmapDocument } from "~/lib/mindmap-document";

/** Display category for document preview (PDF, image, docx, xlsx, pptx, text, code, etc.) */
export type DocumentDisplayType =
    | "pdf"
    | "image"
    | "docx" // Word documents (.doc, .docx, .odt)
    | "xlsx" // Spreadsheets (.xls, .xlsx, .ods, .csv)
    | "pptx" // Presentations (.ppt, .pptx, .odp)
    | "text" // Plain text, HTML
    | "markdown" // Markdown documents (.md, .markdown) — rendered, not shown as source
    | "conversation" // Imported agent-session transcripts — rendered as a chat, not a document
    | "mindmap" // The citable copy of a mindmap — rendered as the map, not as its outline
    | "code" // Source code files (.py, .ts, .tsx, .js, .jsx, .css, etc.)
    | "zip" // ZIP archives (extracted content shown)
    | "audio" // Audio files (.mp3, .m4a) and audio transcriptions
    | "unknown";

export interface DocumentType {
    id: number;
    title: string;
    category: string;
    aiSummary?: string;
    url: string;
    /** MIME type when available (from API); otherwise inferred from URL/title */
    mimeType?: string;
    /** Whether OCR processing has completed for this document */
    ocrProcessed?: boolean;
    /** OCR metadata including potential error state or transcription data */
    ocrMetadata?: {
        error?: string;
        errorMessage?: string;
        failedAt?: string;
        audioUrl?: string;
        audioDocumentId?: number;
        language?: string;
        confidence?: number;
        segments?: { start: number; end: number; text: string }[];
        [key: string]: unknown;
    } | null;
    /** When set, this document was extracted from a ZIP archive with this name */
    sourceArchiveName?: string | null;
}

const CODE_MIME_PREFIXES = [
    "text/x-",
    "text/javascript",
    "text/typescript",
    "text/jsx",
    "text/tsx",
    "text/css",
    "text/xml",
    "application/json",
    "application/xml",
];

const CODE_EXTENSIONS_RE =
    /\.(py|js|ts|jsx|tsx|css|scss|less|json|xml|yaml|yml|toml|ini|cfg|env|log|rst|java|c|cpp|h|hpp|go|rs|rb|php|swift|kt|sh|bash|sql|r|lua|pl|scala|geojson)\b/;

/** Infer display type from document for viewer rendering */
export function getDocumentDisplayType(doc: {
    url: string;
    title: string;
    mimeType?: string;
    /**
     * When present, the agent-sessions connector marker inside it upgrades a
     * markdown transcript to the conversation display. Callers that only have
     * url/title/mime keep getting the plain classification.
     */
    ocrMetadata?: { connector?: unknown; [key: string]: unknown } | null;
}): DocumentDisplayType {
    // Imported agent sessions are stored as text/markdown, but they read as
    // conversations — the sink's connector marker outranks the mime sniff.
    if (doc.ocrMetadata?.connector === "agent-sessions") return "conversation";
    // Likewise a published mindmap: a Markdown outline on disk, a diagram to
    // the reader.
    if (isMindmapDocument(doc.ocrMetadata)) return "mindmap";

    // Check title first — transcription documents are stored as text/plain but should render as audio
    if (doc.title.toLowerCase().includes("(transcription)")) return "audio";

    const mime = (doc.mimeType ?? "").toLowerCase();
    if (mime) {
        if (mime === "application/pdf") return "pdf";
        if (mime.startsWith("image/")) return "image";
        if (mime.includes("word") || mime === "application/vnd.oasis.opendocument.text")
            return "docx";
        if (
            mime.includes("powerpoint") ||
            mime.includes("presentation") ||
            mime === "application/vnd.oasis.opendocument.presentation"
        )
            return "pptx";
        if (
            mime.includes("excel") ||
            mime.includes("spreadsheet") ||
            mime === "application/vnd.oasis.opendocument.spreadsheet"
        )
            return "xlsx";
        if (mime.startsWith("audio/") || mime === "video/mp4") return "audio";
        // Before the code prefixes: "text/x-" would otherwise claim text/x-markdown.
        if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
        if (CODE_MIME_PREFIXES.some(p => mime.startsWith(p) || mime === p)) return "code";
        if (mime.startsWith("text/") || mime === "application/csv") return "text";
        if (mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
    }
    const src = `${doc.url} ${doc.title}`.toLowerCase();
    if (/\b\.pdf\b/.test(src)) return "pdf";
    if (/\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp|svg)\b/.test(src)) return "image";
    if (/\.(mp3|m4a)\b/.test(src)) return "audio";
    if (/\.(docx?|odt)\b/.test(src)) return "docx";
    if (/\.(pptx?|odp)\b/.test(src)) return "pptx";
    if (/\.(xlsx?|ods)\b/.test(src)) return "xlsx";
    if (/\.(md|markdown|mdown|mkd)\b/.test(src)) return "markdown";
    if (CODE_EXTENSIONS_RE.test(src)) return "code";
    if (/\.(txt|html?|csv)\b/.test(src)) return "text";
    if (/\.zip\b/.test(src)) return "zip";
    return "unknown";
}

export interface CategoryGroup {
    name: string;
    isOpen: boolean;
    documents: DocumentType[];
}
