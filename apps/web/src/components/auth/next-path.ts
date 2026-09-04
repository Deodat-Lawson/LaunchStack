/**
 * The `?next=` parameter the auth pages honour after a successful sign-in or
 * sign-up. Only a same-origin path is ever followed: an absolute URL, a
 * protocol-relative `//host`, or anything with a line break falls back, so a
 * crafted link cannot bounce a fresh session to another site.
 */

export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (trimmed.length === 0) return fallback;
    if (!trimmed.startsWith("/")) return fallback;
    // `//evil.example` and `/\evil.example` both resolve off-origin in browsers.
    if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
    if (/[\r\n]/.test(trimmed)) return fallback;
    return trimmed;
}

/** Appends `?next=` (or `&next=`) to `path` when `next` is a usable same-origin path. */
export function withNext(path: string, next: string | null | undefined): string {
    const safe = safeNextPath(next, "");
    if (!safe) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}next=${encodeURIComponent(safe)}`;
}
