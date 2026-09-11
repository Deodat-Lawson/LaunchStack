/**
 * The document converter: one converter per supported type, a registry that
 * declares what it can convert, the wire contract for the backing service,
 * and the typed HTTP client. `file bytes → EvidenceDocument`.
 */
export * from "./wire";
export * from "./converters";
export { HttpDocumentConverterClient, type ConverterClientConfig } from "./client";
