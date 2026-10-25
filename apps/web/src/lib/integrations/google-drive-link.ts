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
