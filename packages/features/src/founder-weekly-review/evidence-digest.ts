import { createHash } from "node:crypto";

import type { FounderWeeklyReviewEvidenceSnapshot } from "./contracts";

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, entry]) => [key, canonicalize(entry)])
        );
    }
    return value;
}

/** Digest of the complete frozen evidence snapshot, including v2 raw/group audit data. */
export function buildFounderWeeklyReviewEvidenceDigest(
    snapshot: FounderWeeklyReviewEvidenceSnapshot
): string {
    return createHash("sha256")
        .update(JSON.stringify(canonicalize(snapshot)), "utf8")
        .digest("hex");
}
