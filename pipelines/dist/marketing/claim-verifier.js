import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getRag } from "@launchstack/search";
import { invokeMarketingStructured } from "./models.js";
const ClaimListSchema = z.object({
    claims: z.array(z.string()),
});
export async function verifyClaimSources(args) {
    const { companyId, message } = args;
    const extractResponse = await invokeMarketingStructured(
        ClaimListSchema,
        [
            new SystemMessage(
                `Extract all factual claims from this marketing message. A "claim" is any specific statement about the company, product, capability, metric, or outcome. Return a JSON object with a "claims" array of strings. If no factual claims, return an empty array.`
            ),
            new HumanMessage(message),
        ],
        "claim_list"
    );
    const { claims } = ClaimListSchema.parse(extractResponse);
    if (claims.length === 0) return [];
    const rag = getRag();
    const options = { companyId, topK: 2, weights: [0.4, 0.6] };
    const results = await Promise.all(
        claims.slice(0, 5).map(async claim => {
            try {
                const searchResults = await rag.companyEnsembleSearch(claim, options);
                const topResult = searchResults[0];
                if (!topResult) {
                    return { claim, sourceDoc: "No direct source found", chunk: "", confidence: 0 };
                }
                return {
                    claim,
                    sourceDoc: topResult.metadata?.documentTitle ?? "Unknown document",
                    chunk: topResult.pageContent.slice(0, 200),
                    confidence: topResult.metadata?.confidence ?? 0,
                };
            } catch {
                return { claim, sourceDoc: "Verification failed", chunk: "", confidence: 0 };
            }
        })
    );
    return results;
}
//# sourceMappingURL=claim-verifier.js.map
