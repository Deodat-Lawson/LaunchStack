/**
 * Evidence-backed assertions (ADR-005 §4).
 *
 * An assertion is one observed statement of fact — "factKey has value" —
 * always tied to a citation anchor in an immutable source version and to
 * the moment it was observed. Assertions are never edited; newer
 * observations supersede older ones through reconciliation.
 */
import type { CitationAnchor } from "./anchors";

/** One observed fact value, cited to an immutable source version. */
export interface EvidenceAssertion {
  factKey: string;
  value: string;
  anchor: CitationAnchor;
  /** ISO-8601 timestamp of when the value was observed. */
  observedAt: string;
}

/**
 * Canonical comparison form of a fact value: trimmed, internal whitespace
 * runs collapsed to a single space, and case-folded. Two assertions agree
 * exactly when their normalized values are identical; the raw values are
 * preserved everywhere for display.
 */
export function normalizeFactValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
