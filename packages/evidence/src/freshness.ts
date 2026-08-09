/**
 * Freshness tiers computed from version timestamps (ADR-005 §1).
 *
 * Pure: the clock is always a parameter (`now`), never read from the
 * environment, so the same inputs always produce the same tier.
 */

export type FreshnessTier = "fresh" | "aging" | "stale";

/**
 * Freshness thresholds in days. `freshWithinDays` must be non-negative and
 * strictly less than `staleAfterDays`.
 */
export interface FreshnessPolicy {
  freshWithinDays: number;
  staleAfterDays: number;
}

/**
 * Default policy: fresh within 30 days, stale after 180. A convenience only —
 * callers may (and product surfaces with their own retention expectations
 * should) pass their own policy instead.
 */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  freshWithinDays: 30,
  staleAfterDays: 180,
};

/** True when both thresholds are finite, non-negative, and correctly ordered. */
export function isValidFreshnessPolicy(policy: FreshnessPolicy): boolean {
  return (
    Number.isFinite(policy.freshWithinDays) &&
    policy.freshWithinDays >= 0 &&
    Number.isFinite(policy.staleAfterDays) &&
    policy.freshWithinDays < policy.staleAfterDays
  );
}

const MS_PER_DAY = 86_400_000;

function parseIsoTimestamp(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new RangeError(`${label} is not a parseable ISO timestamp: ${value}`);
  }
  return ms;
}

/**
 * Tier of a piece of evidence last updated at `lastUpdatedAt`, evaluated at
 * `now` (both ISO timestamps). Boundaries: age ≤ `freshWithinDays` is
 * "fresh" (exactly at the threshold is still fresh), age ≤ `staleAfterDays`
 * is "aging" (exactly at the threshold is still aging), beyond is "stale".
 * A future `lastUpdatedAt` (negative age) is "fresh". Throws `RangeError`
 * on an invalid policy or unparseable timestamps.
 */
export function computeFreshness(
  lastUpdatedAt: string,
  now: string,
  policy: FreshnessPolicy,
): FreshnessTier {
  if (!isValidFreshnessPolicy(policy)) {
    throw new RangeError(
      "Invalid freshness policy: freshWithinDays must be >= 0 and < staleAfterDays",
    );
  }
  const ageDays =
    (parseIsoTimestamp(now, "now") -
      parseIsoTimestamp(lastUpdatedAt, "lastUpdatedAt")) /
    MS_PER_DAY;
  if (ageDays <= policy.freshWithinDays) return "fresh";
  if (ageDays <= policy.staleAfterDays) return "aging";
  return "stale";
}
