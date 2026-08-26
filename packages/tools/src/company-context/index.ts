/**
 * company-context — one implementation of "what do we know about this company".
 *
 * Extracted from packages/features/src/marketing-pipeline/context.ts
 * (unification PR-1), where the identity read existed three times and the
 * confidence gate (`readFact`) was deliberately duplicated into
 * email-pipeline with a "keep these in sync" comment. Consumers: the
 * marketing pipeline, the email pipeline, and (for the schema) the
 * company-metadata extraction vertical.
 *
 * Sequencing note (D2): `getCompanyIdentity` — the new entry point — returns
 * the ToolResult envelope. `buildCompanyKnowledgeContext` and
 * `extractCompanyDNA` keep their pre-extraction signatures so this PR stays
 * behavior-preserving for five existing call sites; they adopt the envelope
 * when the P2 stage runner lands. DNA provenance (modelId, promptVersion)
 * already rides in DNADebugInfo.
 */

import { eq } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getDb } from "@launchstack/store/client";
import { category, company } from "@launchstack/store/schema";

import { runTool, type ToolResult } from "../contract";
import {
    formatSnippetBlock,
    retrieveCompanySnippets,
    SNIPPET_POLICIES,
} from "../grounded-retrieval";
import { companyMetadata } from "./schema";
import type { CompanyMetadataJSON, MetadataFact } from "./schema";
import { invokeCompanyContextStructured } from "./models";
import { COMPANY_CONTEXT_PROMPT_VERSION, DNA_SYSTEM_PROMPT } from "./prompts";
import { CompanyDNASchema } from "./types";
import type { CompanyDNA, CompanyIdentity, DNADebugInfo } from "./types";

export * from "./types";
export { COMPANY_CONTEXT_MODELS } from "./models";
export { COMPANY_CONTEXT_PROMPT_VERSION } from "./prompts";

const DIFFERENTIATOR_QUERY_PARTS = [
    "unique strengths",
    "competitive advantages",
    "awards",
    "metrics",
    "customer outcomes",
    "open source",
    "differentiator",
];

// ============================================================================
// Company identity — the one DB read
// ============================================================================

/** Fetch a company's identity facts (company row + up to 8 categories) once. */
export async function getCompanyIdentity(args: {
    companyId: number;
}): Promise<ToolResult<CompanyIdentity>> {
    return runTool("company-context.identity", async () => {
        const db = getDb();
        const [companyRow] = await db
            .select({
                name: company.name,
                description: company.description,
                industry: company.industry,
                numberOfEmployees: company.numberOfEmployees,
            })
            .from(company)
            .where(eq(company.id, args.companyId))
            .limit(1);

        const categoryRows = await db
            .select({ name: category.name })
            .from(category)
            .where(eq(category.companyId, BigInt(args.companyId)))
            .limit(8);

        const value: CompanyIdentity = {
            name: companyRow?.name ?? "Unknown Company",
            description: companyRow?.description ?? "",
            industry: companyRow?.industry ?? "",
            numberOfEmployees: companyRow?.numberOfEmployees ?? null,
            categories: categoryRows.map(r => r.name).filter(Boolean),
        };
        return { value };
    });
}

/** The identity block the pipeline hands to competitor/trend research. */
export function formatCompanyIdentity(identity: CompanyIdentity): string {
    return [
        `Company: ${identity.name}.`,
        identity.description ? `Description: ${identity.description}` : "",
        identity.industry ? `Industry: ${identity.industry}` : "",
        identity.categories.length > 0 ? `Categories: ${identity.categories.join(", ")}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

// ============================================================================
// Knowledge-base context
// ============================================================================

/**
 * Company facts + KB snippets as one prompt block. Pass a pre-fetched
 * `identity` to skip the identity read (the pipeline fetches it once up
 * front); omitted, the tool fetches it itself.
 */
export async function buildCompanyKnowledgeContext(args: {
    companyId: number;
    prompt: string;
    identity?: CompanyIdentity;
}): Promise<string> {
    const { companyId, prompt } = args;
    const identity = args.identity ?? (await getCompanyIdentity({ companyId })).data;

    const { snippets: kbSnippets } = await retrieveCompanySnippets({
        companyId,
        query: prompt,
        policy: SNIPPET_POLICIES.standard,
        onError: "empty",
    });

    const contextParts = [
        `Company Name: ${identity.name}`,
        ...(identity.description ? [`Company Description: ${identity.description}`] : []),
        ...(identity.industry ? [`Industry / Sector: ${identity.industry}`] : []),
        `Employee Count Range: ${identity.numberOfEmployees ?? "Unknown"}`,
        `Company Categories: ${identity.categories.length > 0 ? identity.categories.join(", ") : "None"}`,
        `Knowledge Base Signals: ${
            kbSnippets.length > 0
                ? kbSnippets.map((s, i) => `${i + 1}. ${s}`).join(" | ")
                : "No matching KB snippets found"
        }`,
    ];

    return contextParts.join("\n");
}

// ============================================================================
// CompanyDNA — metadata-first, RAG fallback
// ============================================================================

export interface ExtractCompanyDNAResult {
    dna: CompanyDNA;
    debug: DNADebugInfo;
}

/**
 * Extract CompanyDNA using stored metadata when available, falling back to RAG.
 *
 * Priority: company_metadata table → dual RAG queries → minimal fallback.
 */
export async function extractCompanyDNA(args: {
    companyId: number;
    prompt: string;
    identity?: CompanyIdentity;
}): Promise<ExtractCompanyDNAResult> {
    const { companyId, prompt } = args;

    const metadataContext = await buildMetadataContext(companyId);
    if (metadataContext) {
        console.log(
            "[tools/company-context] extractCompanyDNA: using METADATA for company %d",
            companyId
        );
        const { dna, modelId } = await synthesizeDNA(metadataContext, prompt);
        return {
            dna,
            debug: {
                source: "metadata",
                contextUsed: metadataContext,
                dna,
                modelId,
                promptVersion: COMPANY_CONTEXT_PROMPT_VERSION,
            },
        };
    }

    console.log(
        "[tools/company-context] extractCompanyDNA: using RAG FALLBACK for company %d (no metadata found)",
        companyId
    );
    const identity = args.identity ?? (await getCompanyIdentity({ companyId })).data;
    const ragContext = await buildRAGContext(companyId, prompt, identity);
    const { dna, modelId } = await synthesizeDNA(ragContext, prompt);
    return {
        dna,
        debug: {
            source: "rag",
            contextUsed: ragContext,
            dna,
            modelId,
            promptVersion: COMPANY_CONTEXT_PROMPT_VERSION,
        },
    };
}

// ============================================================================
// Metadata-based context (preferred path)
// ============================================================================

/**
 * Only facts at or above this confidence, with status "active", are used.
 * Shared with email-pipeline's merge fields — previously a documented
 * duplicate that asked to be kept in sync by hand.
 */
export const MIN_CONFIDENCE = 0.5;

/** Read an active fact's value if its confidence meets the threshold. */
export function readFact<T>(fact: MetadataFact<T> | undefined): T | undefined {
    if (!fact) return undefined;
    if (fact.status !== "active") return undefined;
    if (fact.confidence < MIN_CONFIDENCE) return undefined;
    return fact.value;
}

/**
 * Build a structured text block from the company_metadata JSONB for LLM
 * synthesis. Pure — exported for tests and for callers that already hold the
 * JSON.
 */
export function formatMetadataContext(md: CompanyMetadataJSON): string {
    const parts: string[] = [];

    const name = readFact(md.company.name);
    const description = readFact(md.company.description);
    const industry = readFact(md.company.industry);
    const size = readFact(md.company.size);
    const founded = readFact(md.company.founded_year);
    const hq = readFact(md.company.headquarters);

    parts.push("=== Company ===");
    if (name) parts.push(`Name: ${name}`);
    if (description) parts.push(`Description: ${description}`);
    if (industry) parts.push(`Industry: ${industry}`);
    if (size) parts.push(`Size: ${size}`);
    if (founded) parts.push(`Founded: ${founded}`);
    if (hq) parts.push(`Headquarters: ${hq}`);

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

    const marketParts: string[] = [];
    if (md.markets.primary?.length) {
        const vals = md.markets.primary.map(f => readFact(f)).filter((v): v is string => v != null);
        if (vals.length) marketParts.push(`Primary markets: ${vals.join(", ")}`);
    }
    if (md.markets.verticals?.length) {
        const vals = md.markets.verticals
            .map(f => readFact(f))
            .filter((v): v is string => v != null);
        if (vals.length) marketParts.push(`Verticals: ${vals.join(", ")}`);
    }
    if (md.markets.geographies?.length) {
        const vals = md.markets.geographies
            .map(f => readFact(f))
            .filter((v): v is string => v != null);
        if (vals.length) marketParts.push(`Geographies: ${vals.join(", ")}`);
    }
    if (marketParts.length > 0) {
        parts.push("", "=== Markets ===", ...marketParts);
    }

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

/** Read the company_metadata row and format it; null when no row exists. */
async function buildMetadataContext(companyId: number): Promise<string | null> {
    const db = getDb();
    const [row] = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, BigInt(companyId)))
        .limit(1);

    if (!row?.metadata) return null;
    return formatMetadataContext(row.metadata);
}

// ============================================================================
// RAG-based context (fallback)
// ============================================================================

async function buildRAGContext(
    companyId: number,
    prompt: string,
    identity: CompanyIdentity
): Promise<string> {
    const baseMeta = `Company: ${identity.name}. Categories: ${identity.categories.join(", ") || "None"}.`;

    let generalSnippets: string[] = [];
    let differentiatorSnippets: string[] = [];

    // One try around both searches, matching the pre-extraction behavior:
    // either query failing empties both snippet sets.
    try {
        const [generalResult, diffResult] = await Promise.all([
            retrieveCompanySnippets({
                companyId,
                query: prompt,
                policy: SNIPPET_POLICIES.compact,
                onError: "throw",
            }),
            retrieveCompanySnippets({
                companyId,
                query: `${baseMeta} ${DIFFERENTIATOR_QUERY_PARTS.join(" ")}`,
                policy: SNIPPET_POLICIES.compact,
                onError: "throw",
            }),
        ]);
        generalSnippets = generalResult.snippets;
        differentiatorSnippets = diffResult.snippets;
    } catch (error) {
        console.warn("[tools/company-context] extractCompanyDNA RAG failed:", error);
    }

    const combinedSnippets = [...new Set([...generalSnippets, ...differentiatorSnippets])];
    return combinedSnippets.length > 0
        ? formatSnippetBlock(combinedSnippets, "")
        : `Company Name: ${identity.name}. No KB snippets available.`;
}

// ============================================================================
// Shared LLM synthesis
// ============================================================================

async function synthesizeDNA(
    context: string,
    userPrompt: string
): Promise<{ dna: CompanyDNA; modelId: string }> {
    const { result, modelId } = await invokeCompanyContextStructured(
        "dnaSynthesis",
        CompanyDNASchema,
        [
            new SystemMessage(DNA_SYSTEM_PROMPT),
            new HumanMessage(`Company information:\n\n${context}\n\nUser focus: ${userPrompt}`),
        ],
        "company_dna"
    );
    return { dna: result, modelId };
}
