/**
 * Canonical hashing for v2 artifacts. Every spec, manifest, context, request
 * and world state is hashed over the same canonical JSON: object keys sorted,
 * `undefined` dropped, bigints as strings, dates as ISO strings. Two runs with
 * equal inputs therefore produce equal hashes on any host.
 */
import { createHash } from "node:crypto";

import type { ModelRequest, World } from "@launchstack/simulation";

import { V2_VERSIONS } from "./contracts";

function normalize(value: unknown): unknown {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(v => (v === undefined ? null : normalize(v)));
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const v = (value as Record<string, unknown>)[key];
            if (v !== undefined) out[key] = normalize(v);
        }
        return out;
    }
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value));
}

export function sha256Hex(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

export function hashOf(value: unknown): string {
    return sha256Hex(canonicalJson(value));
}

/** The journal's and the replay recorder's request identity: the full request plus the frozen model-policy and prompt versions. */
export function requestHash(
    request: ModelRequest,
    versions: Pick<typeof V2_VERSIONS, "modelPolicy" | "prompts"> = V2_VERSIONS
): string {
    return hashOf({ request, modelPolicy: versions.modelPolicy, prompts: versions.prompts });
}

/** A world's state hash; replay must reproduce it exactly. */
export function stateHash(world: World): string {
    return hashOf(world);
}

/** Rough token count used for budgets (4 characters per token). */
export function approxTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
