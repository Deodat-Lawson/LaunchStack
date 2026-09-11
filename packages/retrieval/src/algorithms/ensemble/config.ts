/**
 * Ensemble runtime configuration, injected by the composition root.
 *
 * Nothing in this package reads `process.env` — the app decides which legs
 * run and hands the decision (and any app-owned legs) over before retrieval
 * is used. Three things are injectable:
 *
 * - `graphRetrieval`: whether the knowledge-graph leg joins the ensemble.
 *   The backend (Neo4j vs the Postgres fallback) is chosen per call by
 *   `shouldUseNeo4jRetriever()`; this flag only turns the leg on.
 * - `notesLegs`: a provider for the user-notes leg. Notes live in product
 *   schema owned by the app (not in @launchstack/store), so the retriever
 *   itself cannot live in this package — the app registers factories and the
 *   ensemble unions their results like any other leg. No provider, no leg.
 * - `factsLegs`: a provider for the company-facts leg — curated, cited facts
 *   from the company-metadata projection (people, services, projects, legal,
 *   policies). Same arrangement as notes: the projection is product schema,
 *   so the app owns the retriever and registers factories here.
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

/**
 * Company facts are company-level: the company leg returns any matching
 * fact, while the document and multi-document legs narrow to facts whose
 * cited sources include those documents, so a single-document question is
 * not answered from a fact read elsewhere.
 */
export interface FactsLegProvider {
    createDocumentLeg(documentId: number, companyId: number, topK: number): BaseRetriever;
    /**
     * `scope` is the caller's document scope. A fact quotes the document it
     * was read from, so a fact whose only sources fall outside the scope must
     * not surface — the provider filters by cited source.
     */
    createCompanyLeg(
        companyId: number | string,
        topK: number,
        scope?: DocumentScope
    ): BaseRetriever;
    createMultiDocLeg(documentIds: number[], companyId: number, topK: number): BaseRetriever;
}

export interface EnsembleRuntimeConfig {
    graphRetrieval: boolean;
    notesLegs: NotesLegProvider | null;
    factsLegs: FactsLegProvider | null;
}

let config: EnsembleRuntimeConfig = {
    graphRetrieval: false,
    notesLegs: null,
    factsLegs: null,
};

/** Merge-configure; call from the composition root before retrieval runs. */
export function configureEnsemble(partial: Partial<EnsembleRuntimeConfig>): void {
    config = { ...config, ...partial };
}

export function getEnsembleConfig(): EnsembleRuntimeConfig {
    return config;
}
