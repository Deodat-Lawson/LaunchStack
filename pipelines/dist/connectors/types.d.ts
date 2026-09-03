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
    /**
     * Text connectors produce a string; remote connectors that carry binary
     * formats (PDF, DOCX, images) produce raw bytes. Sinks that only handle
     * text must narrow and reject bytes rather than coerce them.
     */
    readonly content: string | Uint8Array;
    /**
     * Stable fingerprint of `content`. Text connectors use sha256 of the text;
     * remote connectors may use the provider's revision identity (md5Checksum,
     * headRevisionId) so change detection needs no download. Opaque to the
     * host — only equality matters.
     */
    readonly contentHash: string;
}
/** Byte length of an item's content, whichever form it takes. */
export declare function contentByteLength(content: string | Uint8Array): number;
/** Content as a Buffer, ready for blob upload. */
export declare function contentToBuffer(content: string | Uint8Array): Buffer;
/** An item the scan deliberately passed over, and why. */
export interface SkippedKnowledgeItem {
    readonly sourceId: string;
    readonly reason: SkipReason;
    readonly detail?: string;
}
export type SkipReason = "unchanged" | "too-large" | "empty" | "excluded" | "unreadable" | "limit-reached"
/** The file is still being written to (modified within the quiescence window). */
 | "active";
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