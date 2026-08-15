import { Analytics } from "@vercel/analytics/next";
import { getDeploymentMode } from "~/server/deployment";

/**
 * Vercel Analytics, mounted only where it belongs.
 *
 * It used to render unconditionally in the root layout, which put a
 * third-party script tag on every page of every self-hosted instance. It is a
 * no-op off Vercel, but "it does nothing" is not the same as "it is not there"
 * for someone running this on their own hardware — and the whole point of a
 * self-hosted deployment is that nothing phones home.
 *
 * Vercel previews are included deliberately: they run the hosted product's
 * code and are useful to measure, and $VERCEL is only ever set on Vercel.
 */
export function CloudAnalytics() {
  const enabled =
    getDeploymentMode() === "cloud" || process.env.VERCEL === "1";
  if (!enabled) return null;
  return <Analytics />;
}
