import { eq } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db } from "~/server/db";
import { category, company } from "~/server/db/schema";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
    type SearchResult,
} from "~/lib/tools/rag";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type { CompanyDNA } from "~/lib/tools/marketing-pipeline/types";
import { CompanyDNASchema } from "~/lib/tools/marketing-pipeline/types";

const DIFFERENTIATOR_QUERY_PARTS = [
    "unique strengths",
    "competitive advantages",
    "awards",
    "metrics",
    "customer outcomes",
    "open source",
    "differentiator",
];

export async function buildCompanyKnowledgeContext(args: {
    companyId: number;
    prompt: string;
}): Promise<string> {
    const { companyId, prompt } = args;

    const [companyRow, categoryRows] = await Promise.all([
        db.select().from(company).where(eq(company.id, companyId)).limit(1),
        db.select().from(category).where(eq(category.companyId, BigInt(companyId))).limit(8),
    ]);

    const companyInfo = companyRow[0];
    const categoryNames = categoryRows.map((row) => row.name).filter(Boolean);

    let kbSnippets: string[] = [];
    try {
        const embeddings = createOpenAIEmbeddings();
        const options: CompanySearchOptions = {
            companyId,
            topK: 6,
            weights: [0.4, 0.6],
        };
        const kbResults: SearchResult[] = await companyEnsembleSearch(prompt, options, embeddings);

        kbSnippets = kbResults
            .slice(0, 6)
            .map((row) => row.pageContent.trim().replace(/\s+/g, " ").slice(0, 400))
            .filter(Boolean);
    } catch (error) {
        console.warn("[marketing-pipeline] company KB context retrieval failed:", error);
    }

    const contextParts = [
        `Company Name: ${companyInfo?.name ?? "Unknown Company"}`,
        `Employee Count Range: ${companyInfo?.numberOfEmployees ?? "Unknown"}`,
        `Company Categories: ${categoryNames.length > 0 ? categoryNames.join(", ") : "None"}`,
        `Knowledge Base Signals: ${
            kbSnippets.length > 0 ? kbSnippets.map((s, i) => `${i + 1}. ${s}`).join(" | ") : "No matching KB snippets found"
        }`,
    ];

    return contextParts.join("\n");
}

/**
 * Run RAG for general context and for differentiators, then use LLM to distill into CompanyDNA.
 */
export async function extractCompanyDNA(args: {
    companyId: number;
    prompt: string;
}): Promise<CompanyDNA> {
    const { companyId, prompt } = args;

    const [companyRow, categoryRows] = await Promise.all([
        db.select().from(company).where(eq(company.id, companyId)).limit(1),
        db.select().from(category).where(eq(category.companyId, BigInt(companyId))).limit(8),
    ]);

    const companyInfo = companyRow[0];
    const categoryNames = categoryRows.map((r) => r.name).filter(Boolean);
    const baseMeta = `Company: ${companyInfo?.name ?? "Unknown"}. Categories: ${categoryNames.join(", ") || "None"}.`;

    const embeddings = createOpenAIEmbeddings();
    const options: CompanySearchOptions = { companyId, topK: 4, weights: [0.4, 0.6] };

    let generalSnippets: string[] = [];
    let differentiatorSnippets: string[] = [];

    try {
        const [generalResults, diffResults] = await Promise.all([
            companyEnsembleSearch(prompt, options, embeddings),
            companyEnsembleSearch(
                `${baseMeta} ${DIFFERENTIATOR_QUERY_PARTS.join(" ")}`,
                { ...options, topK: 4 },
                embeddings,
            ),
        ]);

        generalSnippets = generalResults
            .slice(0, 4)
            .map((r) => r.pageContent.trim().replace(/\s+/g, " ").slice(0, 320))
            .filter(Boolean);
        differentiatorSnippets = diffResults
            .slice(0, 4)
            .map((r) => r.pageContent.trim().replace(/\s+/g, " ").slice(0, 320))
            .filter(Boolean);
    } catch (error) {
        console.warn("[marketing-pipeline] extractCompanyDNA RAG failed:", error);
    }

    const combinedSnippets = [...new Set([...generalSnippets, ...differentiatorSnippets])];
    const rawContext =
        combinedSnippets.length > 0
            ? combinedSnippets.map((s, i) => `${i + 1}. ${s}`).join("\n\n")
            : `Company Name: ${companyInfo?.name ?? "Unknown Company"}. No KB snippets available.`;

    const systemPrompt = `You are a strategist. Given raw company knowledge-base snippets, distill them into a structured CompanyDNA.
Rules:
- Use ONLY information present in the snippets. Do not invent.
- If something is missing, use a short placeholder like "Not specified" or an empty array.
- coreMission: one sentence on what the company does and for whom.
- keyDifferentiators: 2-5 short phrases (e.g. "open source", "no vendor lock-in").
- provenResults: metrics, outcomes, awards, case results mentioned.
- humanStory: founding story, team ethos, or values if present; otherwise "Not specified".
- technicalEdge: one simple sentence on how it works or why it's better; keep it non-technical.
Return valid JSON matching the schema.`;

    const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
    const model = chat.withStructuredOutput(CompanyDNASchema, { name: "company_dna" });
    const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Raw KB snippets:\n\n${rawContext}\n\nUser focus: ${prompt}`),
    ]);

    return CompanyDNASchema.parse(response);
}

