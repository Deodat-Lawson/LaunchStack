/**
 * Which files in a vault are notes, and where they sit. Browser-safe (no
 * Node imports): the Obsidian panel filters the vault with these before
 * uploading, and the server applies the same rules again, so the two agree.
 */

/** Hidden folders (`.obsidian`, `.trash`, `.git`) and dependency trees are never notes. */
const EXCLUDED_SEGMENTS = new Set(["node_modules"]);

/** A vault-relative path with forward slashes and no leading `./` or `/`. */
export function normalizeVaultPath(path: string): string {
    return path
        .replace(/\\/g, "/")
        .split("/")
        .filter(segment => segment && segment !== ".")
        .join("/");
}

/** True for a file the import should read as a note. */
export function isVaultNotePath(path: string): boolean {
    const normalized = normalizeVaultPath(path);
    if (!normalized.toLowerCase().endsWith(".md")) return false;
    // Excalidraw drawings are JSON stored in Markdown files: noise as text.
    if (normalized.toLowerCase().endsWith(".excalidraw.md")) return false;
    return normalized
        .split("/")
        .every(segment => !segment.startsWith(".") && !EXCLUDED_SEGMENTS.has(segment));
}

/** The folder a note sits in, vault-relative ("" at the vault root). */
export function noteFolder(path: string): string {
    const segments = normalizeVaultPath(path).split("/");
    segments.pop();
    return segments.join("/");
}
