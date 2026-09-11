/**
 * Retriever for the company-facts leg (ADR-011).
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

import { and, eq, inArray } from "drizzle-orm";
import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";

import { db } from "~/server/db/index";
import { companyMetadata } from "~/server/db/schema";
import { document } from "@launchstack/store/schema";
import type { FactsLegProvider } from "@launchstack/retrieval/algorithms/ensemble";
import type { SearchScope } from "@launchstack/retrieval/search-types";
import { scopeAllows, scopedDocumentWhere } from "~/lib/authz/scope";
import { isEverythingScope, type DocumentScope } from "~/lib/authz/scope-types";

import {
    type CompanyFactRow,
    flattenCompanyFacts,
    formatCompanyFact,
    rankCompanyFacts,
    rowsCitingDocuments,
    rowsVisibleUnder,
} from "./company-facts";

interface CompanyFactsRetrieverConfig extends BaseRetrieverInput {
    companyId: number | string;
    topK: number;
    searchScope: SearchScope;
    /** When set, only facts citing one of these documents are eligible. */
    documentIds?: number[];
    /**
     * The caller's document scope (ADR-010 roles). A fact quotes the document
     * it was read from, so a fact whose sources all fall outside the scope is
     * filtered out; a fact with no document source stays.
     */
    scope?: DocumentScope;
}

export class CompanyFactsRetriever extends BaseRetriever {
    lc_namespace = ["rag", "retrievers", "company-facts"];

    private companyId: number | string;
    private topK: number;
    private searchScope: SearchScope;
    private documentIds?: number[];
    private scope?: DocumentScope;

    constructor(fields: CompanyFactsRetrieverConfig) {
        super(fields);
        this.companyId = fields.companyId;
        this.topK = fields.topK;
        this.searchScope = fields.searchScope;
        this.documentIds = fields.documentIds;
        this.scope = fields.scope;
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
            facts = await this.applyScope(facts);

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

    /**
     * Drop facts the reader may not see. The scope is resolved against the
     * cited documents in one query, then re-checked per row, the same
     * belt-and-braces the notes leg applies. Ids that name no document read
     * as not visible, never as unrestricted.
     */
    private async applyScope(facts: CompanyFactRow[]): Promise<CompanyFactRow[]> {
        const scope = this.scope;
        if (!scope || isEverythingScope(scope)) return facts;

        const cited = [...new Set(facts.flatMap(f => f.sourceDocumentIds))];
        const visible = new Set<number>();
        if (cited.length > 0) {
            const companyId = BigInt(this.companyId);
            const rows = await db
                .select({ id: document.id, category: document.category })
                .from(document)
                .where(and(inArray(document.id, cited), scopedDocumentWhere(companyId, scope)));
            for (const r of rows) {
                if (scopeAllows(scope, { id: r.id, category: r.category })) {
                    visible.add(Number(r.id));
                }
            }
        }
        return rowsVisibleUnder(facts, visible);
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
    createCompanyLeg: (companyId, topK, scope) =>
        new CompanyFactsRetriever({ companyId, topK, searchScope: "company", scope }),
    createMultiDocLeg: (documentIds, companyId, topK) =>
        new CompanyFactsRetriever({
            companyId,
            topK,
            searchScope: "multi-document",
            documentIds,
        }),
};
