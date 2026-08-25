/**
 * @launchstack/schema-generator — emits the versioned JSON Schema bundle
 * (schemas/v1/) from the wire contracts living inside their features.
 * Run `pnpm schemas:generate`; CI runs `pnpm schemas:check`.
 */
export { PROTOCOL_VERSION, type ProtocolVersion } from "@launchstack/runtime/wire-version";
