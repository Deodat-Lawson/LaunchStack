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
export {};
//# sourceMappingURL=types.js.map