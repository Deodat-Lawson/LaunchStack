import { NextResponse } from "next/server";

import { LANDING_URL } from "~/config/landing";

/**
 * Redirect to a page on the public site (apps/landing), resolved per request.
 *
 * `LANDING_URL` is inlined at build time, and the published images are built
 * once in CI for every deployment, so it can only ever hold the default host.
 * `LANDING_PUBLIC_URL` is read at runtime instead (the production Compose
 * overlay sets it to `https://home.${DOMAIN}`), which is what lets the same
 * image send `/privacy`, `/terms` and `/site/...` to the right site everywhere.
 *
 * The path is set on a URL built from the landing origin rather than
 * concatenated or resolved against it, so no path ("//evil.example") can move
 * the redirect to another host. A blank variable counts as unset: Compose
 * passes `${LANDING_PUBLIC_URL:-}` through as an empty string.
 */
export function redirectToLanding(path: `/${string}`, search = ""): NextResponse {
    const url = new URL(landingOrigin());
    url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
    url.search = search;
    return NextResponse.redirect(url, 307);
}

function landingOrigin(): string {
    const configured = process.env.LANDING_PUBLIC_URL?.trim();
    if (configured) return configured;
    return LANDING_URL;
}
