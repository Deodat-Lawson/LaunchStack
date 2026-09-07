/**
 * The fact-confidence gate, dependency-free.
 *
 * Every consumer of the company-metadata projection reads facts through
 * this one gate so "usable fact" means the same thing in the marketing
 * pipeline, the email merge fields, and the company-facts retrieval leg.
 * It lives apart from ./index so a consumer that must not load the DB
 * client — the retrieval leg's pure scorer, its tests — can still share it.
 */

import type { MetadataFact } from "./schema";

/**
 * Only facts at or above this confidence, with status "active", are used.
 * Shared with email-pipeline's merge fields — previously a documented
 * duplicate that asked to be kept in sync by hand.
 */
export const MIN_CONFIDENCE = 0.5;

/** Read an active fact's value if its confidence meets the threshold. */
export function readFact<T>(fact: MetadataFact<T> | undefined): T | undefined {
    if (!fact) return undefined;
    if (fact.status !== "active") return undefined;
    if (fact.confidence < MIN_CONFIDENCE) return undefined;
    return fact.value;
}
