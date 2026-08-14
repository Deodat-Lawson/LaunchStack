/**
 * @launchstack/core compatibility facade (ADR-002): this subpath's
 * implementation moved to @launchstack/adapters. Re-export only — no logic
 * may be added here (enforced by scripts/ci/check-core-facade.mjs).
 */
export * from "@launchstack/adapters/collab/store";
