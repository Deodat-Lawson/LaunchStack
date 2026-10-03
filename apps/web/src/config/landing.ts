/**
 * The public site (apps/landing), served from a different origin.
 *
 * A handful of surfaces in the product legitimately point at marketing pages:
 * the brand logo, the post-sign-out destination, the "Help"/"Contact"
 * affordances, and the deployment guide linked from the upload form.
 *
 * They link to `LANDING_HREF` (`/site/...`), a same-origin route that
 * redirects to the public site at request time (app/site, via
 * server/landing-redirect.ts). They can't link to the landing origin
 * directly: the published images are built once in CI, so anything inlined
 * into the client bundle holds the build machine's value, not the
 * deployment's. That is how every logo came to point at a host that was down.
 */
export const LANDING_HREF = "/site";
export const LANDING_CONTACT_HREF = `${LANDING_HREF}/contact`;
export const LANDING_DEPLOYMENT_HREF = `${LANDING_HREF}/deployment`;

/**
 * The build-time default for that redirect, used when the server has no
 * `LANDING_PUBLIC_URL`. Server code only; client components link to
 * `LANDING_HREF` (enforced by __tests__/server/landing-redirect.test.tsx).
 *
 * Deliberately not routed through ~/env: that module is a 453-line Zod gate,
 * and a wrong value here yields a redirect to the wrong host, not a boot
 * failure, so there is nothing to validate.
 *
 * Under `next dev` the fallback is the landing app's own dev server
 * (`pnpm --filter @launchstack/landing dev`, port 3001), so the logo and
 * sign-out keep a local stack local instead of jumping to the production site.
 */
export const LANDING_URL =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "https://launchstack.app");
