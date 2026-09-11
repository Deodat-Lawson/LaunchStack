/**
 * new backend intelligence layer
 */
import { type RagSearchResult as SearchResult } from "@launchstack/search";
import type { CompanyDNA, KnowledgeValidationReport, NormalizedCompanyKnowledge } from "./types.js";
/**
 * runs multiple focused RAG queries over company KB instead of just one generic search
 * this gives better raw material without changing the rest of the RAG system
 */
export declare function retrieveCompanyKnowledgeEvidence(args: {
    companyId: number;
    prompt: string;
}): Promise<SearchResult[]>;
/**
 * first pass LLM - takes the raw retreived evidence and converts it into a stable structure
 * gives normalized format
 */
export declare function normalizeCompanyKnowledge(args: {
    companyId: number;
    prompt: string;
    evidence: SearchResult[];
}): Promise<NormalizedCompanyKnowledge>;
/**
 * second pass LLM - checks if output is grounded, complete, internally consistent, what claims look weak or unsupported
 * grading/validation pass
 */
export declare function validateCompanyKnowledge(args: {
    knowledge: NormalizedCompanyKnowledge;
    evidence: SearchResult[];
}): Promise<KnowledgeValidationReport>;
/**
 * if validation function says result is weak, this pass rewrites it - removes unsupported clains,
 * tightens vague working, preserves supported information only
 * pipeline is now: retreive->normalize->validate->revise
 */
export declare function reviseCompanyKnowledgeIfNeeded(args: {
    knowledge: NormalizedCompanyKnowledge;
    validation: KnowledgeValidationReport;
    evidence: SearchResult[];
}): Promise<NormalizedCompanyKnowledge>;
/**
 * Fast path: single normalize pass, no validation/revise. Use for lower latency.
 */
export declare function buildCompanyKnowledgeFast(args: {
    companyId: number;
    prompt: string;
}): Promise<{
    knowledge: NormalizedCompanyKnowledge;
    evidence: SearchResult[];
}>;
/**
 * returns final knowledge object, validation report, raw evidence
 */
export declare function buildValidatedCompanyKnowledge(args: {
    companyId: number;
    prompt: string;
}): Promise<{
    knowledge: NormalizedCompanyKnowledge;
    validation: KnowledgeValidationReport;
    evidence: SearchResult[];
}>;
/**
 * converts deeper structured object we created here into the simpler object
 * expected by marketing pipeline
 */
export declare function mapValidatedKnowledgeToCompanyDNA(knowledge: NormalizedCompanyKnowledge): CompanyDNA;
//# sourceMappingURL=knowledge.d.ts.map