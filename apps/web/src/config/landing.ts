/**
 * The public site (apps/landing), served from a different origin.
 *
 * A handful of surfaces in the product legitimately point at marketing pages:
 * the brand logo on the auth screens, the post-sign-out destination, the
 * "Help"/"Contact" affordances, and the deployment guide linked from the
 * upload form. Those all became cross-origin when the landing site split out,
 * so they need an absolute URL.
 *
 * Deliberately not routed through ~/env: that module is a 453-line Zod gate,
 * and importing it from client components to read one optional URL would pull
 * it into far more bundles than it belongs in. A wrong value here yields a
 * link to the wrong host, not a boot failure, so there is nothing to validate.
 */
export const LANDING_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://launchstack.app";

export const LANDING_CONTACT_URL = `${LANDING_URL}/contact`;
export const LANDING_DEPLOYMENT_URL = `${LANDING_URL}/deployment`;
