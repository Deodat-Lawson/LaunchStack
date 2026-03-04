import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { category, company } from "~/server/db/schema";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
    type SearchResult,
} from "~/lib/tools/rag";

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

