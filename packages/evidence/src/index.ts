/**
 * @launchstack/evidence — pure company-state logic (ADR-002, ADR-005).
 *
 * Immutable evidence vocabulary and the functions over it: citation
 * anchors, supersession over immutable source versions, version diffing by
 * content hash, freshness tiers, evidence-backed assertions with conflict
 * detection, and reconciliation into a fact ledger.
 *
 * This package must stay pure: no database, no HTTP, no Node built-ins, no
 * environment access, and no ambient time — clocks are always parameters.
 * It depends on nothing at all.
 */
export {
    anchorKey,
    isValidAnchorSpan,
    isValidCitationAnchor,
    parseAnchorKey,
    type AnchorSpan,
    type CharSpan,
    type CitationAnchor,
    type PageSpan,
    type ParsedAnchorKey,
    type TimeSpan,
} from "./citation-anchors";

export {
    isSuperseded,
    resolveCurrentVersion,
    supersessionChain,
    type SourceVersionMeta,
} from "./version-supersession";

export {
    diffVersions,
    type ChunkFingerprint,
    type ChunkMove,
    type VersionDiff,
} from "./version-diff";

export {
    computeFreshness,
    DEFAULT_FRESHNESS_POLICY,
    isValidFreshnessPolicy,
    type FreshnessPolicy,
    type FreshnessTier,
} from "./version-freshness";

export { normalizeFactValue, type EvidenceAssertion } from "./fact-assertions";

export {
    compareAssertionRecency,
    detectConflicts,
    resolveByRecency,
    type ConflictResolution,
    type ConflictValueGroup,
    type DetectConflictsOptions,
    type FactConflict,
    type RecencyRanked,
} from "./fact-conflicts";

export {
    reconcile,
    type FactChange,
    type FactRecord,
    type ReconcileOptions,
    type ReconcileResult,
    type SupersededValue,
} from "./fact-ledger";
