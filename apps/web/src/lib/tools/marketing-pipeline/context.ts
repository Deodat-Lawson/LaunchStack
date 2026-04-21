import { eq } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db } from "~/server/db";
import { category, company, companyMetadata } from "@launchstack/core/db/schema";
import {
    companyEnsembleSearch,
    createOpenAIEmbeddings,
    type CompanySearchOptions,
    type SearchResult,
} from "~/lib/tools/rag";
import { getChatModel, MARKETING_MODELS } from "~/lib/models";
import type { CompanyDNA, DNADebugInfo } from "~/lib/tools/marketing-pipeline/types";
import { CompanyDNASchema } from "~/lib/tools/marketing-pipeline/types";
import type { CompanyMetadataJSON, MetadataFact } from "@launchstack/features/company-metadata";

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
        ...(companyInfo?.description ? [`Company Description: ${companyInfo.description}`] : []),
        ...(companyInfo?.industry ? [`Industry / Sector: ${companyInfo.industry}`] : []),
        `Employee Count Range: ${companyInfo?.numberOfEmployees ?? "Unknown"}`,
        `Company Categories: ${categoryNames.length > 0 ? categoryNames.join(", ") : "None"}`,
        `Knowledge Base Signals: ${
            kbSnippets.length > 0 ? kbSnippets.map((s, i) => `${i + 1}. ${s}`).join(" | ") : "No matching KB snippets found"
        }`,
    ];

    return contextParts.join("\n");
}

/**
 * Extract CompanyDNA using stored metadata when available, falling back to RAG.
 *
 * Priority: company_metadata table → dual RAG queries → minimal fallback.
 */
export interface ExtractCompanyDNAResult {
    dna: CompanyDNA;
    debug: DNADebugInfo;
}

export async function extractCompanyDNA(args: {
    companyId: number;
    prompt: string;
}): Promise<ExtractCompanyDNAResult> {
    const { companyId, prompt } = args;

    // Try metadata-first approach
    const metadataContext = await buildMetadataContext(companyId);
    if (metadataContext) {
        console.log("[marketing-pipeline] extractCompanyDNA: using METADATA for company %d", companyId);
        const dna = await synthesizeDNA(metadataContext, prompt);
        return { dna, debug: { source: "metadata", contextUsed: metadataContext, dna } };
    }

    // Fallback: dual RAG extraction for companies without metadata
    console.log("[marketing-pipeline] extractCompanyDNA: using RAG FALLBACK for company %d (no metadata found)", companyId);
    const ragContext = await buildRAGContext(companyId, prompt);
    const dna = await synthesizeDNA(ragContext, prompt);
    return { dna, debug: { source: "rag", contextUsed: ragContext, dna } };
}

// ============================================================================
// Metadata-based context (preferred path)
// ============================================================================

const MIN_CONFIDENCE = 0.5;

/** Read active fact value if confidence meets threshold. */
function readFact<T>(fact: MetadataFact<T> | undefined): T | undefined {
    if (!fact) return undefined;
    if (fact.status !== "active") return undefined;
    if (fact.confidence < MIN_CONFIDENCE) return undefined;
    return fact.value;
}

/**
 * Build a structured text block from the company_metadata JSONB for LLM synthesis.
 * Returns null if no metadata row exists.
 */
async function buildMetadataContext(companyId: number): Promise<string | null> {
    const [row] = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, BigInt(companyId)))
        .limit(1);

    if (!row?.metadata) return null;

    const md = row.metadata as CompanyMetadataJSON;
    const parts: string[] = [];

    // Company info
    const name = readFact(md.company.name);
    const description = readFact(md.company.description);
    const industry = readFact(md.company.industry);
    const size = readFact(md.company.size);
    const founded = readFact(md.company.founded_year as MetadataFact<number> | undefined);
    const hq = readFact(md.company.headquarters);

    parts.push("=== Company ===");
    if (name) parts.push(`Name: ${name}`);
    if (description) parts.push(`Description: ${description}`);
    if (industry) parts.push(`Industry: ${industry}`);
    if (size) parts.push(`Size: ${size}`);
    if (founded) parts.push(`Founded: ${founded}`);
    if (hq) parts.push(`Headquarters: ${hq}`);

    // Services → differentiators and technical edge
    if (md.services.length > 0) {
        const serviceLines = md.services
            .map((s): string | null => {
                const sName = readFact(s.name);
                const sDesc = readFact(s.description);
                if (!sName) return null;
                return sDesc ? `- ${sName}: ${sDesc}` : `- ${sName}`;
            })
            .filter((v): v is string => v != null);
        if (serviceLines.length > 0) {
            parts.push("", "=== Services & Products ===", ...serviceLines);
        }
    }

    // Projects → proven results
    if (md.projects.length > 0) {
        const projectLines = md.projects
            .map((p): string | null => {
                const pName = readFact(p.name);
                const pDesc = readFact(p.description);
                const pStatus = readFact(p.status);
                if (!pName) return null;
                const detail = [pDesc, pStatus].filter(Boolean).join(" | ");
                return detail ? `- ${pName}: ${detail}` : `- ${pName}`;
            })
            .filter((v): v is string => v != null);
        if (projectLines.length > 0) {
            parts.push("", "=== Projects & Outcomes ===", ...projectLines);
        }
    }

    // People → human story
    if (md.people.length > 0) {
        const personLines = md.people
            .slice(0, 8)
            .map((p): string | null => {
                const pName = readFact(p.name);
                const pRole = readFact(p.role);
                if (!pName) return null;
                return pRole ? `- ${pName} (${pRole})` : `- ${pName}`;
            })
            .filter((v): v is string => v != null);
        if (personLines.length > 0) {
            parts.push("", "=== Key People ===", ...personLines);
        }
    }

    // Markets → differentiators
    const marketParts: string[] = [];
    if (md.markets.primary?.length) {
        const vals = md.markets.primary.map((f) => readFact(f)).filter((v): v is string => v != null);
        if (vals.length) marketParts.push(`Primary markets: ${vals.join(", ")}`);
    }
    if (md.markets.verticals?.length) {
        const vals = md.markets.verticals.map((f) => readFact(f)).filter((v): v is string => v != null);
        if (vals.length) marketParts.push(`Verticals: ${vals.join(", ")}`);
    }
    if (md.markets.geographies?.length) {
        const vals = md.markets.geographies.map((f) => readFact(f)).filter((v): v is string => v != null);
        if (vals.length) marketParts.push(`Geographies: ${vals.join(", ")}`);
    }
    if (marketParts.length > 0) {
        parts.push("", "=== Markets ===", ...marketParts);
    }

    // Policies → differentiators (certifications, compliance)
    const policyEntries = Object.entries(md.policies);
    if (policyEntries.length > 0) {
        const policyLines = policyEntries
            .map(([key, fact]): string | null => {
                const val = readFact(fact);
                return val ? `- ${key}: ${val}` : null;
            })
            .filter((v): v is string => v != null);
        if (policyLines.length > 0) {
            parts.push("", "=== Policies & Certifications ===", ...policyLines);
        }
    }

    return parts.join("\n");
}

// ============================================================================
// RAG-based context (fallback)
// ============================================================================

async function buildRAGContext(companyId: number, prompt: string): Promise<string> {
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
    return combinedSnippets.length > 0
        ? combinedSnippets.map((s, i) => `${i + 1}. ${s}`).join("\n\n")
        : `Company Name: ${companyInfo?.name ?? "Unknown Company"}. No KB snippets available.`;
}

// ============================================================================
// Shared LLM synthesis
// ============================================================================

const DNA_SYSTEM_PROMPT = `You are a strategist. Given company information, distill it into a structured CompanyDNA.
Rules:
- Use ONLY information present in the input. Do not invent.
- If something is missing, use a short placeholder like "Not specified" or an empty array.
- coreMission: one sentence on what the company does and for whom.
- keyDifferentiators: 2-5 short phrases (e.g. "open source", "no vendor lock-in").
- provenResults: metrics, outcomes, awards, case results mentioned.
- humanStory: founding story, team ethos, or values if present; otherwise "Not specified".
- technicalEdge: one simple sentence on how it works or why it's better; keep it non-technical.
Return valid JSON matching the schema.`;

async function synthesizeDNA(context: string, userPrompt: string): Promise<CompanyDNA> {
    const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
    const model = chat.withStructuredOutput(CompanyDNASchema, { name: "company_dna" });
    const response = await model.invoke([
        new SystemMessage(DNA_SYSTEM_PROMPT),
        new HumanMessage(`Company information:\n\n${context}\n\nUser focus: ${userPrompt}`),
    ]);
    return CompanyDNASchema.parse(response);
}

