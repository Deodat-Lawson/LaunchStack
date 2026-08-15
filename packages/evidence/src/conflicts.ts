/**
 * Conflict detection between assertions from different current sources
 * (ADR-005 §4).
 *
 * Only assertions anchored in CURRENT source versions participate: the
 * caller supplies the set of current version ids, and everything anchored
 * elsewhere is superseded evidence, filtered out before any comparison.
 * This is why the same source can never conflict with its own past — the
 * old version's assertions are simply gone from the input by then.
 */
import { anchorKey, type CitationAnchor } from "./anchors";
import { normalizeFactValue, type EvidenceAssertion } from "./assertions";

/** All assertions of one normalized value inside a conflict. */
export interface ConflictValueGroup {
    /** The normalized comparison value (see `normalizeFactValue`). */
    value: string;
    /** The raw assertions backing this value, in input order. */
    assertions: EvidenceAssertion[];
}

/** A fact asserted with distinct values by at least two distinct sources. */
export interface FactConflict {
    factKey: string;
    /** Value groups sorted by normalized value for deterministic output. */
    values: ConflictValueGroup[];
}

export interface DetectConflictsOptions {
    /** Version ids considered current; anything else is superseded evidence. */
    currentVersionIds: ReadonlySet<number>;
}

/**
 * Detects cross-source disagreement. Assertions anchored outside
 * `currentVersionIds` are dropped first; the rest are grouped by `factKey`.
 * A fact is in conflict when it has ≥ 2 distinct normalized values AND its
 * assertions span ≥ 2 distinct `sourceId`s — one source contradicting only
 * itself is not a conflict, and a superseded version can never reintroduce
 * one. Conflicts are sorted by `factKey` and value groups by normalized
 * value, so the output is deterministic.
 */
export function detectConflicts(
    assertions: readonly EvidenceAssertion[],
    opts: DetectConflictsOptions
): FactConflict[] {
    const byFactKey = new Map<string, Map<string, EvidenceAssertion[]>>();
    for (const assertion of assertions) {
        if (!opts.currentVersionIds.has(assertion.anchor.sourceVersionId)) continue;
        let byValue = byFactKey.get(assertion.factKey);
        if (!byValue) {
            byValue = new Map();
            byFactKey.set(assertion.factKey, byValue);
        }
        const normalized = normalizeFactValue(assertion.value);
        const group = byValue.get(normalized);
        if (group) group.push(assertion);
        else byValue.set(normalized, [assertion]);
    }

    const conflicts: FactConflict[] = [];
    for (const [factKey, byValue] of byFactKey) {
        if (byValue.size < 2) continue;
        const sourceIds = new Set<number>();
        for (const group of byValue.values()) {
            for (const assertion of group) sourceIds.add(assertion.anchor.sourceId);
        }
        if (sourceIds.size < 2) continue;
        const values = [...byValue.entries()]
            .map(([value, group]) => ({ value, assertions: group }))
            .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
        conflicts.push({ factKey, values });
    }
    return conflicts.sort((a, b) => (a.factKey < b.factKey ? -1 : a.factKey > b.factKey ? 1 : 0));
}

/** The fields recency ordering needs; both assertions and fact records fit. */
export interface RecencyRanked {
    observedAt: string;
    anchor: CitationAnchor;
    value: string;
}

function parseObservedAt(value: string): number {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
        throw new RangeError(`observedAt is not a parseable ISO timestamp: ${value}`);
    }
    return ms;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Total recency order; the GREATEST element under it wins resolution.
 * Ranks by: later `observedAt`, then higher `anchor.sourceVersionId`, then
 * greater `anchorKey` (UTF-16 code-unit lexicographic), then greater raw
 * `value` (a beyond-spec guard so even pathological duplicates order
 * deterministically). Independent of input order. Throws `RangeError` on
 * unparseable `observedAt` timestamps or invalid anchors.
 */
export function compareAssertionRecency(a: RecencyRanked, b: RecencyRanked): number {
    const timeDelta = parseObservedAt(a.observedAt) - parseObservedAt(b.observedAt);
    if (timeDelta !== 0) return timeDelta;
    const versionDelta = a.anchor.sourceVersionId - b.anchor.sourceVersionId;
    if (versionDelta !== 0) return versionDelta;
    const keyDelta = compareStrings(anchorKey(a.anchor), anchorKey(b.anchor));
    if (keyDelta !== 0) return keyDelta;
    return compareStrings(a.value, b.value);
}

/** Recency resolution of a conflict: one winner, everything else preserved. */
export interface ConflictResolution {
    winner: EvidenceAssertion;
    /** Every non-winning assertion, most recent first. Never dropped. */
    alternatives: EvidenceAssertion[];
}

/**
 * Resolves a conflict by recency: the assertion with the newest `observedAt`
 * wins; ties fall through `compareAssertionRecency` (higher
 * `sourceVersionId`, then anchor-key and value ordering), so resolution is
 * fully deterministic regardless of input order. All losing assertions are
 * returned as `alternatives` — resolution never silently discards evidence.
 * Throws `RangeError` on a conflict with no assertions.
 */
export function resolveByRecency(conflict: FactConflict): ConflictResolution {
    const all = conflict.values.flatMap(group => group.assertions);
    if (all.length === 0) {
        throw new RangeError(
            `Cannot resolve conflict for "${conflict.factKey}" with no assertions`
        );
    }
    const sorted = [...all].sort((a, b) => compareAssertionRecency(b, a));
    return { winner: sorted[0]!, alternatives: sorted.slice(1) };
}
