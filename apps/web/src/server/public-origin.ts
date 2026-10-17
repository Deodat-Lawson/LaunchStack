/**
 * The origin people reach this deployment at — for links and redirects that
 * leave the server (join and invitation links, OAuth return legs and
 * redirect URIs, unsubscribe links, page metadata).
 *
 * One variable, one job:
 * - BETTER_AUTH_URL is where browsers and OAuth providers reach the app.
 *   Better Auth only accepts sign-ins from its origin, so a deployment where
 *   people can sign in already has it right. Everything here reads it.
 * - APP_PUBLIC_URL is only where this app's other services (document
 *   converter, Word editor, worker) reach it to fetch /api/files. It may be
 *   an internal address (`http://app:3000`, the default when unset) and is
 *   never used for a URL a person or provider opens.
 *
 * Never derive the origin from `request.url` alone: the standalone server
 * builds that from the address it binds to (`HOSTNAME=0.0.0.0` in the image)
 * and its port, not the Host header, so behind the proxy a route handler sees
 * `https://0.0.0.0:3000`. The request is the last resort, meant for a dev
 * server without BETTER_AUTH_URL; production warns once when it gets there.
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

/** BETTER_AUTH_URL's origin, for callers with no request (worker, page metadata). */
export function configuredPublicOrigin(): string | undefined {
    return configuredOrigin(process.env.BETTER_AUTH_URL);
}

let warned = false;

export function publicOrigin(request: Request): string {
    const configured = configuredPublicOrigin();
    if (configured) return configured;

    if (process.env.NODE_ENV === "production" && !warned) {
        warned = true;
        console.warn(
            "[public-origin] BETTER_AUTH_URL is not set to a valid URL; links and " +
                "redirects fall back to the request URL, which behind a proxy is the " +
                "server's bind address (e.g. https://0.0.0.0:3000)."
        );
    }
    return new URL(request.url).origin;
}
