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
/** Byte length of an item's content, whichever form it takes. */
export function contentByteLength(content) {
    return typeof content === "string" ? Buffer.byteLength(content, "utf-8") : content.byteLength;
}
/** Content as a Buffer, ready for blob upload. */
export function contentToBuffer(content) {
    return typeof content === "string" ? Buffer.from(content, "utf-8") : Buffer.from(content);
}
//# sourceMappingURL=types.js.map