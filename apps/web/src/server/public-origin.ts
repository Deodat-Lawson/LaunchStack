/**
 * The origin people reach this deployment at — for links and redirects that
 * leave the server (join and invitation links, OAuth return legs,
 * unsubscribe links).
 *
 * Never derive it from `request.url` alone: the standalone server builds that
 * from the address it binds to (`HOSTNAME=0.0.0.0` in the image) and its port,
 * not the Host header, so behind the proxy a route handler sees
 * `https://0.0.0.0:3000`. The request is only the fallback for a dev server
 * with neither variable set.
 *
 * Read per call, not through `~/env`, so a runtime override applies without a
 * rebuild (like LANDING_PUBLIC_URL in landing-redirect.ts).
 */

/** The origin of a configured URL, or undefined when it is unset or not a URL. */
function configuredOrigin(raw: string | undefined): string | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    try {
        const { origin } = new URL(value);
        // "localhost:3000" parses with scheme "localhost:" and an opaque origin.
        return origin === "null" ? undefined : origin;
    } catch {
        return undefined;
    }
}

export function publicOrigin(request: Request): string {
    return (
        configuredOrigin(process.env.APP_PUBLIC_URL) ??
        configuredOrigin(process.env.BETTER_AUTH_URL) ??
        new URL(request.url).origin
    );
}
