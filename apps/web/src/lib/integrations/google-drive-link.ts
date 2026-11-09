/**
 * The file or folder id inside a link someone copied from Google Drive —
 * "Copy link" on a folder, the address bar of an open folder or Doc, an old
 * `open?id=` share — or a bare id. Shared on purpose: the Drive panel checks
 * a pasted link before sending it, and the items route trusts only its own
 * reading of it.
 */

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

/** Drive ids are URL-safe base64-ish; real ones run 19–44 characters. */
const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;

/** `/<marker>/<id>` path forms, e.g. `/drive/u/1/folders/<id>`, `/document/d/<id>/edit`. */
const PATH_MARKERS = new Set(["folders", "d"]);

export function driveIdFromLink(raw: string): string | null {
    const text = raw.trim();
    if (!text) return null;
    if (DRIVE_ID.test(text)) return text;

    let url: URL;
    try {
        url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return null;
    }
    if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < segments.length - 1; i++) {
        const marker = segments[i]!;
        const candidate = segments[i + 1]!;
        if (PATH_MARKERS.has(marker) && DRIVE_ID.test(candidate)) return candidate;
    }

    // open?id=…, folderview?id=…, uc?id=…
    const queried = url.searchParams.get("id");
    if (queried && DRIVE_ID.test(queried)) return queried;
    return null;
}

/** Google's own editors, by the Drive MIME type of a native file. */
const NATIVE_EDITOR_PATHS: Record<string, string> = {
    "application/vnd.google-apps.document": "document",
    "application/vnd.google-apps.spreadsheet": "spreadsheets",
    "application/vnd.google-apps.presentation": "presentation",
    "application/vnd.google-apps.drawing": "drawings",
    "application/vnd.google-apps.form": "forms",
};

/**
 * Where a Drive file opens in Google: a native Doc, Sheet or Slides deck in
 * its editor, anything else (a PDF, a .docx) in Drive's file preview.
 */
export function driveFileUrl(fileId: string, driveMimeType?: string | null): string {
    const id = encodeURIComponent(fileId);
    const editor = driveMimeType ? NATIVE_EDITOR_PATHS[driveMimeType] : undefined;
    return editor
        ? `https://docs.google.com/${editor}/d/${id}/edit`
        : `https://drive.google.com/file/d/${id}/view`;
}

/**
 * The Google Drive page of a document the Drive connector syncs, read from
 * the metadata the connector stamps on it; null for any other document.
 */
export function driveUrlOfSyncedDocument(ocrMetadata: unknown): string | null {
    if (typeof ocrMetadata !== "object" || ocrMetadata === null) return null;
    const meta = ocrMetadata as Record<string, unknown>;
    if (meta.connector !== "google-drive") return null;
    const fileId = meta.driveFileId;
    if (typeof fileId !== "string" || !DRIVE_ID.test(fileId)) return null;
    return driveFileUrl(fileId, typeof meta.driveMimeType === "string" ? meta.driveMimeType : null);
}
