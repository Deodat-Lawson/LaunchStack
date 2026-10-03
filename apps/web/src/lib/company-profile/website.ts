/** The company website as people type it, made into an address the importer can fetch. */

/**
 * "acme.com" → "https://acme.com/". Null for anything that is not a public
 * web address (no dot in the host, a non-http scheme, spaces).
 */
export function normalizeWebsite(raw: string | undefined | null): string | null {
    const text = raw?.trim();
    if (!text || /\s/.test(text)) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    try {
        const url = new URL(withScheme);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        // "mailto:hi@acme.com" gains a scheme and parses as a login on acme.com.
        if (url.username || url.password) return null;
        if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
        url.hash = "";
        return url.toString();
    } catch {
        return null;
    }
}
