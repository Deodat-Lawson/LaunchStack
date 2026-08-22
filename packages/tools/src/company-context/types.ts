import { z } from "zod";

/** One company's identity facts — the result of the single identity DB read. */
export interface CompanyIdentity {
    name: string;
    description: string;
    industry: string;
    numberOfEmployees: string | null;
    categories: string[];
}

/** Structured company profile distilled from KB for content generation (issue #232). */
export interface CompanyDNA {
    coreMission: string;
    keyDifferentiators: string[];
    provenResults: string[];
    humanStory: string;
    technicalEdge: string;
}

export const CompanyDNASchema = z.object({
    coreMission: z.string(),
    keyDifferentiators: z.array(z.string()),
    provenResults: z.array(z.string()),
    humanStory: z.string(),
    technicalEdge: z.string(),
});

/** Debug info about the DNA extraction source, included when ?debug=true. */
export interface DNADebugInfo {
    source: "metadata" | "rag";
    contextUsed: string;
    dna: CompanyDNA;
    /** Concrete model that synthesized the DNA (provenance, unification D2/D3). */
    modelId?: string;
    /** Prompt version that produced the output (provenance). */
    promptVersion?: string;
}
