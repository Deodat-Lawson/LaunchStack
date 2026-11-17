import { createHash } from "node:crypto";

import type { OrgProfile } from "../types";

/** Object keys are canonical; array order (including ordered Form Fields) is significant. */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
            )
            .join(",")}}`;
    }
    throw new TypeError("Only finite JSON values can be hashed");
}

/** SHA-256 over deterministic canonical JSON, shared by imports and stale-input checks. */
export function hashValue(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/**
 * What a fit result was scored from. Rebuilding an unchanged profile only moves
 * `builtAt`, which must not make every saved result out of date.
 */
export function hashProfile(profile: OrgProfile): string {
    const { builtAt: _builtAt, ...content } = profile;
    return hashValue(content);
}
