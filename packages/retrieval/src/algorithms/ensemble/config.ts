/**
 * Ensemble runtime configuration, injected by the composition root.
 *
 * Nothing in this package reads `process.env` — the app decides which legs
 * run and hands the decision (and any app-owned legs) over before retrieval
 * is used. Two things are injectable:
 *
 * - `graphRetrieval`: whether the knowledge-graph leg joins the ensemble.
 *   The backend (Neo4j vs the Postgres fallback) is chosen per call by
 *   `shouldUseNeo4jRetriever()`; this flag only turns the leg on.
 * - `notesLegs`: a provider for the user-notes leg. Notes live in product
 *   schema owned by the app (not in @launchstack/store), so the retriever
 *   itself cannot live in this package — the app registers factories and the
 *   ensemble unions their results like any other leg. No provider, no leg.
 */

import type { BaseRetriever } from "@langchain/core/retrievers";
import type { DocumentScope, EmbeddingsProvider } from "../../search-types";

export interface NotesLegProvider {
    createDocumentLeg(
        documentId: number,
        embeddings: EmbeddingsProvider,
        topK: number
    ): BaseRetriever;
    /**
     * `scope` is the caller's document scope. Notes are per-user, but a note
     * anchored to a restricted document carries that document's quote, so a
     * provider should honour it where it can.
     */
    createCompanyLeg(
        companyId: number | string,
        embeddings: EmbeddingsProvider,
        topK: number,
        scope?: DocumentScope
    ): BaseRetriever;
    createMultiDocLeg(
        documentIds: number[],
        embeddings: EmbeddingsProvider,
        topK: number
    ): BaseRetriever;
}

export interface EnsembleRuntimeConfig {
    graphRetrieval: boolean;
    notesLegs: NotesLegProvider | null;
}

let config: EnsembleRuntimeConfig = {
    graphRetrieval: false,
    notesLegs: null,
};

/** Merge-configure; call from the composition root before retrieval runs. */
export function configureEnsemble(partial: Partial<EnsembleRuntimeConfig>): void {
    config = { ...config, ...partial };
}

export function getEnsembleConfig(): EnsembleRuntimeConfig {
    return config;
}
