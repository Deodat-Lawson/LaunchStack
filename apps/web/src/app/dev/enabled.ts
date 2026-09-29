/**
 * Whether the `/dev/*` preview routes are reachable.
 *
 * These pages render real product surfaces with fabricated props and no
 * session, which makes them useful for looking at UI and unacceptable to
 * expose on a deployment holding someone's documents.
 *
 * Two ways in:
 *
 * - `next dev` — always on, so the local loop needs no configuration.
 * - A production build — off unless `ENABLE_DEV_ROUTES` is explicitly set.
 *   That is what lets the Compose stack (a production standalone build) serve
 *   them, without the published image doing so by default.
 *
 * Pair every caller with `export const dynamic = "force-dynamic"`. Without it
 * Next prerenders these pages at build time, evaluates this function against
 * the *builder's* environment, and bakes the answer into the image — the flag
 * would then be read once during `docker build` and never again.
 */
export function devRoutesEnabled(): boolean {
    if (process.env.NODE_ENV !== "production") return true;
    const flag = process.env.ENABLE_DEV_ROUTES;
    return flag === "1" || flag === "true";
}
