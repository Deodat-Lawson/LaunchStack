/** Explicit aliases for one auth service; omitted aliases preserve single-origin behavior. */
export function authBaseURL(
    environment: Record<string, string | undefined> = process.env,
    source?: Request | Headers
): string | undefined {
    const aliases = environment.BETTER_AUTH_ADDITIONAL_ORIGINS?.trim();
    if (!aliases) return environment.BETTER_AUTH_URL;
    const primary = environment.BETTER_AUTH_URL?.trim();
    if (!primary)
        throw new Error("BETTER_AUTH_URL is required when adding authentication origins.");
    let canonical: URL;
    try {
        canonical = new URL(primary);
        if (
            !["http:", "https:"].includes(canonical.protocol) ||
            canonical.username ||
            canonical.password
        )
            throw new Error();
    } catch {
        throw new Error("BETTER_AUTH_URL must be a valid HTTP(S) URL.");
    }
    const origins = aliases.split(",").map(value => {
        try {
            const url = new URL(value.trim());
            const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
            if (
                url.username ||
                url.password ||
                url.pathname !== "/" ||
                url.search ||
                url.hash ||
                url.host.includes("*") ||
                url.host.includes("?") ||
                (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
            )
                throw new Error();
            return url.origin;
        } catch {
            throw new Error(
                "BETTER_AUTH_ADDITIONAL_ORIGINS must contain exact HTTPS origins or HTTP loopback origins."
            );
        }
    });
    const allowed = [...new Set([canonical.origin, ...origins])];
    if (!source) return canonical.origin;
    const requestURL = source instanceof Headers ? undefined : new URL(source.url);
    const headers = source instanceof Headers ? source : source.headers;
    const host = headers.get("host") ?? requestURL?.host;
    if (!host) throw new Error("An explicit Host is required for multi-origin authentication.");
    const matches = allowed.filter(origin => new URL(origin).host === host.toLowerCase());
    if (requestURL && matches.includes(requestURL.origin)) return requestURL.origin;
    // A reverse proxy may pass a public Host with an internal request URL. The
    // explicitly configured origin supplies its scheme; arbitrary forwarded headers do not.
    if (matches.length === 1) return matches[0];
    throw new Error("The request Host is not a configured authentication origin.");
}
