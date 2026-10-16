/**
 * The two origins.
 *
 * This app is served from SITE_URL (launchstack.app). Every CTA that needs an
 * account crosses to APP_URL (app.launchstack.app) — a different Vercel project
 * built from apps/web. Because they are separate origins, those links must be
 * plain <a> elements with absolute hrefs, not next/link.
 *
 * Read as full `process.env.X` literals so the Next bundler can inline them
 * into client chunks at build time. There is deliberately no env.ts here: both
 * values have defaults, and a wrong one yields a visibly wrong link rather than
 * a runtime failure, so there is nothing worth gating a boot on.
 *
 * Under `next dev` APP_URL falls back to the web app's own dev server
 * (`pnpm --filter @launchstack/web dev`, port 3000), so "Sign in" and "Start
 * building" keep a local stack local instead of jumping to production.
 * `next build` always runs as production, so no built bundle carries it.
 * SITE_URL keeps its production default even in dev: it only feeds metadata
 * (canonical, Open Graph, JSON-LD, sitemap, robots), never a link anyone
 * clicks, and where a page canonically lives is the production origin.
 *
 * The Docker build passes both as build args, and an unset arg arrives as an
 * empty string, which must still fall back to the default.
 */
function nonEmpty(value: string | undefined): string | undefined {
    return value === "" ? undefined : value;
}

export const SITE_URL = nonEmpty(process.env.NEXT_PUBLIC_SITE_URL) ?? "https://launchstack.app";

export const APP_URL =
    nonEmpty(process.env.NEXT_PUBLIC_APP_URL) ??
    (process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : "https://app.launchstack.app");

export const GITHUB_REPO = "https://github.com/Deodat-Lawson/LaunchStack";

export const SIGN_IN_URL = `${APP_URL}/signin`;
export const SIGN_UP_URL = `${APP_URL}/signup`;

/** Where privacy, data and account-deletion requests go. Shown on /privacy and /terms. */
export const PRIVACY_EMAIL = "privacy@launchstack-internal.com";

/** The date the current Privacy Policy and Terms took effect. */
export const LEGAL_UPDATED = "October 16, 2026";
