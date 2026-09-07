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
 * values have production defaults, and a wrong one yields a visibly wrong link
 * rather than a runtime failure, so there is nothing worth gating a boot on.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://launchstack.app";

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.launchstack.app";

export const GITHUB_REPO = "https://github.com/Deodat-Lawson/LaunchStack";

export const SIGN_IN_URL = `${APP_URL}/signin`;
export const SIGN_UP_URL = `${APP_URL}/signup`;
