import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getRag, type CompanySearchOptions } from "@launchstack/core/rag";
import { invokeMarketingStructured } from "./models";
import type { BrandVoice, FormalityLevel } from "./types";
import { BrandVoiceSchema } from "./types";

export async function extractBrandVoice(args: {
    companyId: number;
    toneOverride?: FormalityLevel;
}): Promise<BrandVoice> {
    const { companyId, toneOverride } = args;

    const options: CompanySearchOptions = { companyId, topK: 6, weights: [0.4, 0.6] };
    const results = await getRag().companyEnsembleSearch(
        "company tone voice communication style brand personality writing examples",
        options
    );

    const textSamples = results
        .slice(0, 6)
        .map(r => r.pageContent.trim().replace(/\s+/g, " ").slice(0, 400))
        .filter(Boolean);

    const contextBlock =
        textSamples.length > 0
            ? textSamples.map((s, i) => `${i + 1}. ${s}`).join("\n\n")
            : "No text samples available.";

    const toneHint = toneOverride
        ? `\n\nThe user has requested a ${toneOverride} tone. Set formalityLevel to "${toneOverride}" and adapt the other fields accordingly.`
        : "";

    const response = await invokeMarketingStructured(
        BrandVoiceSchema,
        [
            new SystemMessage(
                `You are a brand voice analyst. Given text samples from a company's documents, synthesize a BrandVoice profile that captures how this company communicates.

Rules:
- toneDescriptor: 2-4 adjective phrase (e.g., "confident, technical, approachable").
- vocabularyExamples: 3-6 characteristic words or phrases the company uses.
- sentenceStyle: one sentence describing the typical sentence structure and length.
- formalityLevel: one of "formal", "conversational", "technical", "bold".

Use ONLY patterns visible in the provided text. Return valid JSON.${toneHint}`
            ),
            new HumanMessage(`Company text samples:\n\n${contextBlock}`),
        ],
        "brand_voice"
    );

    return BrandVoiceSchema.parse(response);
}
