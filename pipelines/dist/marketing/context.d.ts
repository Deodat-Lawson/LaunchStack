import type { CompanyDNA, DNADebugInfo } from "./types.js";
export declare function buildCompanyKnowledgeContext(args: {
    companyId: number;
    prompt: string;
}): Promise<string>;
/**
 * Extract CompanyDNA using stored metadata when available, falling back to RAG.
 *
 * Priority: company_metadata table → dual RAG queries → minimal fallback.
 */
export interface ExtractCompanyDNAResult {
    dna: CompanyDNA;
    debug: DNADebugInfo;
}
export declare function extractCompanyDNA(args: {
    companyId: number;
    prompt: string;
}): Promise<ExtractCompanyDNAResult>;
//# sourceMappingURL=context.d.ts.map