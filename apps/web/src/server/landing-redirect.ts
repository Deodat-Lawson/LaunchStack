import { NextResponse } from "next/server";

import { LANDING_URL } from "~/config/landing";

/**
 * Redirect to a page on the public site (apps/landing), resolved per request.
 *
 * `LANDING_URL` is inlined at build time, and the published images are built
 * once in CI for every deployment, so it can only ever hold the default host.
 * `LANDING_PUBLIC_URL` is read at runtime instead (the production Compose
 * overlay sets it to `https://home.${DOMAIN}`), which is what lets the same
 * image send `/privacy` to the right site everywhere.
 */
export function redirectToLanding(path: `/${string}`): NextResponse {
    const base = (process.env.LANDING_PUBLIC_URL ?? LANDING_URL).replace(/\/+$/, "");
    return NextResponse.redirect(`${base}${path}`, 307);
}
