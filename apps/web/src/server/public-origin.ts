/**
 * The origin people reach this deployment at — for links and redirects that
 * leave the server (join and invitation links, OAuth return legs and
 * redirect URIs, unsubscribe links).
 *
 * Never derive it from `request.url` alone: the standalone server builds that
 * from the address it binds to (`HOSTNAME=0.0.0.0` in the image) and its port,
 * not the Host header, so behind the proxy a route handler sees
 * `https://0.0.0.0:3000`.
 *
 * BETTER_AUTH_URL comes first because it has to be the address browsers use:
 * Better Auth rejects sign-ins from any other origin. APP_PUBLIC_URL is also
 * documented as the address the document converter fetches from, which may be
 * an internal one (`http://app:3000`). The request is the last resort, meant
 * for a dev server with neither set; production warns once when it gets there.
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

let warned = false;

export function publicOrigin(request: Request): string {
    const configured =
        configuredOrigin(process.env.BETTER_AUTH_URL) ??
        configuredOrigin(process.env.APP_PUBLIC_URL);
    if (configured) return configured;

    if (process.env.NODE_ENV === "production" && !warned) {
        warned = true;
        console.warn(
            "[public-origin] Neither BETTER_AUTH_URL nor APP_PUBLIC_URL is a valid URL; " +
                "links and redirects fall back to the request URL, which behind a proxy " +
                "is the server's bind address (e.g. https://0.0.0.0:3000)."
        );
    }
    return new URL(request.url).origin;
}
