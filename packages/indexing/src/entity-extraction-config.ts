/**
 * Entity-extraction gate.
 *
 * Stage F of ingestion — LLM NER over every stored section, then the `kg_*`
 * writes — is optional enrichment and, since ADR-010, off unless the host
 * turns it on. Nothing user-facing reads the `kg_*` tables except the
 * parked knowledge-graph view and the graph retrieval leg (itself off by
 * default), while extraction bills an NER call per five chunks of every
 * upload. Running it for no consumer is pure cost.
 *
 * Nothing here reads `process.env` (ADR-002). The composition root calls
 * `configureEntityExtraction({ enabled })` before ingestion runs;
 * unconfigured means off. The worker boots through the same root as the
 * app, so the two cannot disagree.
 */

import { createSlot } from "@launchstack/runtime";

export interface EntityExtractionConfig {
    enabled: boolean;
}

const configSlot = createSlot<EntityExtractionConfig>("indexing/entityExtraction");

export function configureEntityExtraction(config: EntityExtractionConfig): void {
    configSlot.set({ enabled: config.enabled === true });
}

export function isEntityExtractionEnabled(): boolean {
    return configSlot.get()?.enabled === true;
}

/** Test seam: return to the never-configured state. */
export function resetEntityExtractionConfig(): void {
    configSlot.clear();
}
