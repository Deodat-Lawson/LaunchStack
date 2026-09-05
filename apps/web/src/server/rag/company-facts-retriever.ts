/**
 * Retriever for the company-facts leg (ADR-010).
 *
 * Mirrors the notes retriever's shape so facts union into the ensemble
 * without bespoke plumbing. One indexed read of `company_metadata`, then the
 * pure scorer in ./company-facts.ts does the rest. Produces LangChain
 * `Document`s with `source: "company_fact"` and the fact's cited document,
 * version and page, so a fact renders as an ordinary citation.
 *
 * Facts are company-level; the document and multi-document legs narrow to
 * facts whose sources cite those documents, so a single-document question
 * is never answered from a fact read elsewhere.
 */

import { eq } from "drizzle-orm";
import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";

import { db } from "~/server/db/index";
import { companyMetadata } from "~/server/db/schema";
import type { FactsLegProvider } from "@launchstack/retrieval/algorithms/ensemble";
import type { SearchScope } from "@launchstack/retrieval/search-types";

import {
    flattenCompanyFacts,
    formatCompanyFact,
    rankCompanyFacts,
    rowsCitingDocuments,
} from "./company-facts";

interface CompanyFactsRetrieverConfig extends BaseRetrieverInput {
    companyId: number | string;
    topK: number;
    searchScope: SearchScope;
    /** When set, only facts citing one of these documents are eligible. */
    documentIds?: number[];
}

export class CompanyFactsRetriever extends BaseRetriever {
    lc_namespace = ["rag", "retrievers", "company-facts"];

    private companyId: number | string;
    private topK: number;
    private searchScope: SearchScope;
    private documentIds?: number[];

    constructor(fields: CompanyFactsRetrieverConfig) {
        super(fields);
        this.companyId = fields.companyId;
        this.topK = fields.topK;
        this.searchScope = fields.searchScope;
        this.documentIds = fields.documentIds;
    }

    async _getRelevantDocuments(
        query: string,
        _run?: CallbackManagerForRetrieverRun
    ): Promise<Document[]> {
        try {
            const [row] = await db
                .select({ metadata: companyMetadata.metadata })
                .from(companyMetadata)
                .where(eq(companyMetadata.companyId, BigInt(this.companyId)))
                .limit(1);
            if (!row) return [];

            let facts = flattenCompanyFacts(row.metadata);
            if (this.documentIds) facts = rowsCitingDocuments(facts, this.documentIds);

            return rankCompanyFacts(query, facts, this.topK).map(
                ({ row: fact, score }) =>
                    new Document({
                        pageContent: formatCompanyFact(fact),
                        metadata: {
                            source: "company_fact",
                            factPath: fact.path,
                            factSection: fact.section,
                            lexicalScore: score,
                            confidence: fact.confidence,
                            documentId: fact.source?.doc_id,
                            versionId: fact.source?.version_id,
                            page: fact.source?.page,
                            documentTitle: fact.source?.doc_name,
                            searchScope: this.searchScope,
                        },
                    })
            );
        } catch (err) {
            // Never fail a search over a missing or malformed projection —
            // the leg thins to nothing, and the leg-breakdown log shows it.
            console.error("[CompanyFactsRetriever] error:", err);
            return [];
        }
    }
}

export const companyFactsLegs: FactsLegProvider = {
    createDocumentLeg: (documentId, companyId, topK) =>
        new CompanyFactsRetriever({
            companyId,
            topK,
            searchScope: "document",
            documentIds: [documentId],
        }),
    createCompanyLeg: (companyId, topK) =>
        new CompanyFactsRetriever({ companyId, topK, searchScope: "company" }),
    createMultiDocLeg: (documentIds, companyId, topK) =>
        new CompanyFactsRetriever({
            companyId,
            topK,
            searchScope: "multi-document",
            documentIds,
        }),
};
