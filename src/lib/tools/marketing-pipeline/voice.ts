import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
} from "~/lib/tools/rag";
import type { BrandVoice, FormalityLevel } from "~/lib/tools/marketing-pipeline/types";
import { BrandVoiceSchema } from "~/lib/tools/marketing-pipeline/types";

const VOICE_QUERIES = [
    "company tone writing style voice messaging",
    "brand language vocabulary communication",
    "mission values culture how we communicate",
];

const VOICE_SYSTEM_PROMPT = `You are a brand linguist. Given text samples from a company's documents, analyze their writing patterns and produce a BrandVoice profile.

Rules:
- toneDescriptor: 1–2 sentences describing the overall voice (e.g. "Direct and data-driven with occasional dry humor").
- vocabularyExamples: 3–6 characteristic words or phrases the company uses frequently.
- sentenceStyle: 1 sentence on how they structure sentences (short/long, active/passive, jargon-heavy or plain).
- formalityLevel: one of "formal", "conversational", "technical", or "bold" — pick the closest match.

Use ONLY information from the provided text. Return valid JSON matching the schema.`;

export async function extractBrandVoice(args: {
    companyId: number;
    toneOverride?: FormalityLevel;
}): Promise<BrandVoice> {
    const { companyId, toneOverride } = args;

    const embeddings = createOpenAIEmbeddings();
    const options: CompanySearchOptions = {
        companyId,
        topK: 4,
        weights: [0.4, 0.6],
    };

    let snippets: string[] = [];
    try {
        const allResults = await Promise.all(
            VOICE_QUERIES.map((q) => companyEnsembleSearch(q, options, embeddings)),
        );
        const seen = new Set<string>();
        for (const results of allResults) {
            for (const r of results) {
                const text = r.pageContent.trim().replace(/\s+/g, " ").slice(0, 400);
                if (text && !seen.has(text)) {
                    seen.add(text);
                    snippets.push(text);
                }
            }
        }
    } catch (error) {
        console.warn("[marketing-pipeline] brand voice RAG failed:", error);
    }

    if (snippets.length === 0) {
        return {
            toneDescriptor: "Professional and clear",
            vocabularyExamples: [],
            sentenceStyle: "Standard business prose",
            formalityLevel: toneOverride ?? "conversational",
        };
    }

    const context = snippets.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join("\n\n");

    const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
    const model = chat.withStructuredOutput(BrandVoiceSchema, { name: "brand_voice" });
    const response = await model.invoke([
        new SystemMessage(VOICE_SYSTEM_PROMPT),
        new HumanMessage(`Company text samples:\n\n${context}`),
    ]);

    const voice = BrandVoiceSchema.parse(response);

    if (toneOverride) {
        voice.formalityLevel = toneOverride;
    }

    return voice;
}
