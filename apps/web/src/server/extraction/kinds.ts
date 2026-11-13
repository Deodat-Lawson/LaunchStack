/**
 * What kind of file a document is, from its title's extension and its stored
 * type: the icon the Extract tool shows, and whether the run may read the
 * picture itself when its text has nothing (the vision fallback).
 */

const KIND_BY_EXTENSION: Record<string, string> = {
    pdf: "pdf",
    doc: "docx",
    docx: "docx",
    odt: "docx",
    rtf: "docx",
    ppt: "pptx",
    pptx: "pptx",
    odp: "pptx",
    xls: "xlsx",
    xlsx: "xlsx",
    ods: "xlsx",
    csv: "xlsx",
    tsv: "xlsx",
    html: "web",
    htm: "web",
    md: "text",
    markdown: "text",
    txt: "text",
    png: "image",
    jpg: "image",
    jpeg: "image",
    tif: "image",
    tiff: "image",
    webp: "image",
    gif: "image",
    bmp: "image",
};

function extensionOf(name: string): string {
    const clean = name.split(/[?#]/, 1)[0] ?? "";
    const match = /\.([a-z0-9]{1,8})$/i.exec(clean.trim());
    return match ? match[1]!.toLowerCase() : "";
}

function bareMime(mimeType: string | null | undefined): string {
    return mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function kindOfMime(mime: string): string | null {
    if (mime === "application/pdf") return "pdf";
    if (mime.includes("presentation") || mime.includes("powerpoint")) return "pptx";
    if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
        return "xlsx";
    if (mime.includes("wordprocessing") || mime === "application/msword" || mime.includes("rtf"))
        return "docx";
    if (mime === "text/html") return "web";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/") || mime.startsWith("video/")) return "transcript";
    if (mime === "text/markdown" || mime === "text/plain") return "text";
    return null;
}

/**
 * "pdf", "docx", "pptx", "xlsx", "image", "web", "text", "transcript" or
 * "file". The title's extension wins over a generic stored type.
 */
export function sourceKindOf(file: { title: string; mimeType?: string | null }): string {
    if (/\(transcription\)/i.test(file.title)) return "transcript";
    const byName = KIND_BY_EXTENSION[extensionOf(file.title)];
    if (byName) return byName;
    if (/^https?:\/\//i.test(file.title)) return "web";
    const mime = bareMime(file.mimeType);
    return mime ? (kindOfMime(mime) ?? "file") : "file";
}

/** The image types a vision model is sent as they are. */
const VISION_MIME_BY_EXTENSION: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
};
const VISION_MIMES = new Set(Object.values(VISION_MIME_BY_EXTENSION));

/** True for png, jpg, jpeg, tiff, webp, gif and bmp, by stored type or by extension. */
export function isImageFile(file: {
    title: string;
    mimeType?: string | null;
    url?: string | null;
}): boolean {
    if (bareMime(file.mimeType).startsWith("image/")) return true;
    return (
        KIND_BY_EXTENSION[extensionOf(file.title)] === "image" ||
        KIND_BY_EXTENSION[extensionOf(file.url ?? "")] === "image"
    );
}

/**
 * The type to send an image to a vision model under, or null for one such
 * models don't take (tiff, bmp). `served` is the type storage answered with.
 */
export function visionMimeOf(file: {
    title: string;
    mimeType?: string | null;
    url?: string | null;
    served?: string | null;
}): string | null {
    for (const mime of [bareMime(file.served), bareMime(file.mimeType)]) {
        if (mime === "image/jpg") return "image/jpeg";
        if (VISION_MIMES.has(mime)) return mime;
        // A stored type that names another image format settles it.
        if (mime.startsWith("image/")) return null;
    }
    return (
        VISION_MIME_BY_EXTENSION[extensionOf(file.title)] ??
        VISION_MIME_BY_EXTENSION[extensionOf(file.url ?? "")] ??
        null
    );
}
