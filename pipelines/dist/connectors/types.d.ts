/**
 * Shared connector contract.
 *
 * A connector turns some external body of knowledge into a flat list of
 * `KnowledgeItem`s that the host can push through the normal document
 * ingestion pipeline. Connectors never talk to the database or to storage
 * themselves — the host supplies a {@link KnowledgeSink}. That keeps the
 * feature package free of `apps/web` imports and makes every connector
 * testable with an in-memory sink.
 */
/** Where a connector found an item, in the connector's own vocabulary. */
export interface KnowledgeItemLocation {
    /** Absolute path / URL on the machine that ran the scan. Not uploaded. */
    readonly origin: string;
    /** Path relative to the scanned root. Stable across machines. */
    readonly relativePath: string;
}
/**
 * One unit of knowledge, before its contents have been read.
 *
 * `sourceId` is the stable identity of the item across syncs. It must not
 * embed machine-specific data (home directory, absolute paths) because it is
 * the basis of the host's idempotency key.
 */
export interface DiscoveredKnowledgeItem {
    readonly sourceId: string;
    readonly connectorId: string;
    readonly title: string;
    readonly kind: string;
    readonly mimeType: string;
    readonly bytes: number;
    readonly modifiedAt: string;
    readonly location: KnowledgeItemLocation;
    readonly metadata: Readonly<Record<string, unknown>>;
}
/** A discovered item whose contents have been read. */
export interface KnowledgeItem extends DiscoveredKnowledgeItem {
    readonly content: string;
    /** sha256 of `content`. Drives change detection. */
    readonly contentHash: string;
}
/** An item the scan deliberately passed over, and why. */
export interface SkippedKnowledgeItem {
    readonly sourceId: string;
    readonly reason: SkipReason;
    readonly detail?: string;
}
export type SkipReason = "unchanged" | "too-large" | "empty" | "excluded" | "unreadable" | "limit-reached";
/**
 * Host-supplied destination for scanned knowledge.
 *
 * `lastSyncedHash` lets the connector skip work that is already in the
 * knowledge base; returning `null` (or omitting the method) makes every sync
 * a full re-upload, which is always correct, just slower.
 */
export interface KnowledgeSink {
    lastSyncedHash?(item: DiscoveredKnowledgeItem): Promise<string | null>;
    store(item: KnowledgeItem): Promise<StoredKnowledgeItem>;
}
export interface StoredKnowledgeItem {
    readonly sourceId: string;
    readonly documentId: number;
    readonly versionId: number;
    readonly jobId: string | null;
    /** True when the sink created a new version of an existing document. */
    readonly revised: boolean;
}
export interface FailedKnowledgeItem {
    readonly sourceId: string;
    readonly error: string;
}
export interface KnowledgeSyncReport {
    readonly connectorId: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly durationMs: number;
    readonly discovered: number;
    readonly stored: readonly StoredKnowledgeItem[];
    readonly skipped: readonly SkippedKnowledgeItem[];
    readonly failed: readonly FailedKnowledgeItem[];
}
//# sourceMappingURL=types.d.ts.map