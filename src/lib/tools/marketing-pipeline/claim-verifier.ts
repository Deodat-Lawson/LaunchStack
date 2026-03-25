import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
} from "~/lib/tools/rag";
import type { ClaimSource } from "~/lib/tools/marketing-pipeline/types";

const ExtractedClaimsSchema = z.object({
    claims: z.array(z.string()),
});

const CLAIM_EXTRACTION_PROMPT = `Extract all factual claims from the following marketing post. A "claim" is any statement about the company's product, capabilities, metrics, customers, or results.

Do NOT include:
- Generic industry observations
- Questions
- Opinions without factual basis

Return a JSON object with a "claims" array of short claim strings (max 5 claims).`;

export async function verifyClaimSources(args: {
    companyId: number;
    message: string;
}): Promise<ClaimSource[]> {
    const { companyId, message } = args;

    const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
    const extractModel = chat.withStructuredOutput(ExtractedClaimsSchema, {
        name: "extracted_claims",
    });

    let claims: string[];
    try {
        const response = await extractModel.invoke([
            new SystemMessage(CLAIM_EXTRACTION_PROMPT),
            new HumanMessage(message),
        ]);
        claims = ExtractedClaimsSchema.parse(response).claims;
    } catch {
        return [];
    }

    if (claims.length === 0) return [];

    const embeddings = createOpenAIEmbeddings();
    const options: CompanySearchOptions = {
        companyId,
        topK: 2,
        weights: [0.4, 0.6],
    };

    const claimSources: ClaimSource[] = [];

    const searchResults = await Promise.all(
        claims.map((claim) =>
            companyEnsembleSearch(claim, options, embeddings).catch(() => []),
        ),
    );

    for (let i = 0; i < claims.length; i++) {
        const results = searchResults[i] ?? [];
        const topResult = results[0];

        if (topResult) {
            const confidence = topResult.metadata?.confidence;
            const numericScore = typeof confidence === "number" ? confidence : 0.5;

            claimSources.push({
                claim: claims[i]!,
                sourceDoc: topResult.metadata?.documentTitle ?? "Unknown document",
                chunk: topResult.pageContent.trim().replace(/\s+/g, " ").slice(0, 300),
                confidence: Math.round(numericScore * 100) / 100,
            });
        } else {
            claimSources.push({
                claim: claims[i]!,
                sourceDoc: "No direct source found",
                chunk: "",
                confidence: 0,
            });
        }
    }

    return claimSources;
}
