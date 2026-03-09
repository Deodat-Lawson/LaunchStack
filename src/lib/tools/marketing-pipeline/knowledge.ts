/**
 * new backend intelligence layer
 */

import { eq } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { db } from "~/server/db";
import { company, category } from "~/server/db/schema";

import {
  companyEnsembleSearch,
  createOpenAIEmbeddings,
  type CompanySearchOptions,
  type SearchResult,
} from "~/lib/tools/rag";

import { getChatModel, MARKETING_MODELS } from "~/lib/models";

import type {
  CompanyDNA,
  EvidenceCitation,
  KnowledgeValidationReport,
  NormalizedCompanyKnowledge,
} from "~/lib/tools/marketing-pipeline/types";

import {
  CompanyDNASchema,
  KnowledgeValidationReportSchema,
  NormalizedCompanyKnowledgeSchema,
} from "~/lib/tools/marketing-pipeline/types";

const DEFAULT_TOP_K = 4;

function cleanSnippet(text: string, maxLen = 500): string {
  return text.trim().replace(/\s+/g, " ").slice(0, maxLen);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function buildKnowledgeQueries(baseMeta: string, userPrompt: string): string[] {
  return [
    `${baseMeta} company overview what does the company do target customer`,
    `${baseMeta} products services capabilities features`,
    `${baseMeta} differentiators competitive advantages why choose this company`,
    `${baseMeta} proof points metrics case studies outcomes customer results`,
    `${baseMeta} founder story team mission values brand philosophy`,
    `${baseMeta} technical edge implementation workflow methodology`,
    `${baseMeta} customer pain points problems solved objections`,
    `${baseMeta} ${userPrompt}`,
  ];
}

function searchResultToCitation(result: SearchResult): EvidenceCitation {
  return {
    documentId: result.documentId,
    title: result.title,
    page: result.pageNumber,
    sectionPath: result.source,
    snippet: cleanSnippet(result.pageContent, 280),
    sourceType: result.retrievalMethod,
  };
}

function formatEvidenceForPrompt(results: SearchResult[]): string {
  if (!results.length) return "No evidence retrieved.";

  return results
    .map((r, i) => {
      const citation = searchResultToCitation(r);
      return [
        `Evidence ${i + 1}:`,
        `Title: ${citation.title ?? "Unknown"}`,
        `Document ID: ${String(citation.documentId ?? "Unknown")}`,
        `Page: ${citation.page ?? "Unknown"}`,
        `Section: ${citation.sectionPath ?? "Unknown"}`,
        `Source type: ${citation.sourceType ?? "Unknown"}`,
        `Snippet: ${citation.snippet}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function getCompanyMetadata(companyId: number): Promise<{
  companyName: string;
  categoryNames: string[];
  baseMeta: string;
}> {
  const [companyRow, categoryRows] = await Promise.all([
    db.select().from(company).where(eq(company.id, companyId)).limit(1),
    db.select().from(category).where(eq(category.companyId, BigInt(companyId))).limit(8),
  ]);

  const companyName = companyRow[0]?.name ?? "Unknown Company";
  const categoryNames = categoryRows.map((r) => r.name).filter(Boolean);
  const baseMeta = `Company: ${companyName}. Categories: ${categoryNames.join(", ") || "None"}.`;

  return { companyName, categoryNames, baseMeta };
}
/**
 * runs multiple focused RAG queries over company KB instead of just one generic search
 * this gives better raw material without changing the rest of the RAG system
 */
export async function retrieveCompanyKnowledgeEvidence(args: {
  companyId: number;
  prompt: string;
}): Promise<SearchResult[]> {
  const { companyId, prompt } = args;
  const { baseMeta } = await getCompanyMetadata(companyId);

  const embeddings = createOpenAIEmbeddings();
  const options: CompanySearchOptions = {
    companyId,
    topK: DEFAULT_TOP_K,
    weights: [0.4, 0.6],
  };

  const queries = buildKnowledgeQueries(baseMeta, prompt);

  const resultsPerQuery = await Promise.all(
    queries.map(async (query) => {
      try {
        return await companyEnsembleSearch(query, options, embeddings);
      } catch (error) {
        console.warn("[marketing-pipeline] evidence retrieval failed for query:", query, error);
        return [];
      }
    }),
  );

  const flattened = resultsPerQuery.flat();

  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of flattened) {
    const key = [
      result.documentId ?? "",
      result.pageNumber ?? "",
      cleanSnippet(result.pageContent, 200),
    ].join("::");

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }

  return deduped.slice(0, 20);
}

/**
 * first pass LLM - takes the raw retreived evidence and converts it into a stable structure
 * gives normalized format 
 */
export async function normalizeCompanyKnowledge(args: {
  companyId: number;
  prompt: string;
  evidence: SearchResult[];
}): Promise<NormalizedCompanyKnowledge> {
  const { companyId, prompt, evidence } = args;
  const { companyName, categoryNames } = await getCompanyMetadata(companyId);

  const evidenceBlock = formatEvidenceForPrompt(evidence);

  const systemPrompt = `You are a document intelligence system that converts company knowledge-base evidence into a normalized structured profile.

Rules:
- Use ONLY information supported by the provided evidence.
- Do not invent product claims, metrics, customers, partnerships, or differentiators.
- If something is not supported, say "Not specified" for strings or [] for arrays.
- Keep wording concise and factual.
- claims should contain only evidence-backed claims.
- confidence should reflect how directly the evidence supports the claim.
- missingInformation should list important gaps.
- risksOrUnknowns should capture ambiguity, weak support, or unclear positioning.
Return valid JSON exactly matching the schema.`;

  const humanPrompt = [
    `Company name: ${companyName}`,
    `Categories: ${categoryNames.join(", ") || "None"}`,
    `User focus: ${prompt}`,
    "",
    "Evidence:",
    evidenceBlock,
  ].join("\n");

  const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
  const model = chat.withStructuredOutput(NormalizedCompanyKnowledgeSchema, {
    name: "normalized_company_knowledge",
  });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanPrompt),
  ]);

  return NormalizedCompanyKnowledgeSchema.parse(response);
}

/**
 * second pass LLM - checks if output is grounded, complete, internally consistent, what claims look weak or unsupported
 * grading/validation pass
 */
export async function validateCompanyKnowledge(args: {
  knowledge: NormalizedCompanyKnowledge;
  evidence: SearchResult[];
}): Promise<KnowledgeValidationReport> {
  const { knowledge, evidence } = args;

  const evidenceBlock = formatEvidenceForPrompt(evidence);

  const systemPrompt = `You are a strict reviewer checking whether a normalized company profile is grounded in retrieved evidence.

Score each dimension from 0 to 10:
- groundednessScore: are claims supported by evidence?
- completenessScore: does the profile cover the important company fields well?
- consistencyScore: are there contradictions or mismatches?

Rules:
- Flag unsupported or weakly supported claims.
- Flag critical missing fields if they matter for downstream marketing.
- needsRevision should be true if the profile is too weak, incomplete, or contains unsupported claims.
- revisionNotes should be practical and brief.
Return valid JSON exactly matching the schema.`;

  const humanPrompt = [
    "Normalized company knowledge:",
    JSON.stringify(knowledge, null, 2),
    "",
    "Retrieved evidence:",
    evidenceBlock,
  ].join("\n");

  const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
  const model = chat.withStructuredOutput(KnowledgeValidationReportSchema, {
    name: "knowledge_validation_report",
  });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanPrompt),
  ]);

  return KnowledgeValidationReportSchema.parse(response);
}

/**
 * if validation function says result is weak, this pass rewrites it - removes unsupported clains,
 * tightens vague working, preserves supported information only
 * pipeline is now: retreive->normalize->validate->revise
 */
export async function reviseCompanyKnowledgeIfNeeded(args: {
  knowledge: NormalizedCompanyKnowledge;
  validation: KnowledgeValidationReport;
  evidence: SearchResult[];
}): Promise<NormalizedCompanyKnowledge> {
  const { knowledge, validation, evidence } = args;

  if (!validation.needsRevision) {
    return knowledge;
  }

  const evidenceBlock = formatEvidenceForPrompt(evidence);

  const systemPrompt = `You are revising a normalized company profile after QA review.

Rules:
- Remove unsupported claims.
- Tighten vague or speculative statements.
- Preserve supported information.
- Fill missing fields only if the evidence directly supports them.
- Keep the same schema.
Return valid JSON exactly matching the schema.`;

  const humanPrompt = [
    "Current normalized company knowledge:",
    JSON.stringify(knowledge, null, 2),
    "",
    "Validation report:",
    JSON.stringify(validation, null, 2),
    "",
    "Evidence:",
    evidenceBlock,
  ].join("\n");

  const chat = getChatModel(MARKETING_MODELS.dnaExtraction);
  const model = chat.withStructuredOutput(NormalizedCompanyKnowledgeSchema, {
    name: "revised_normalized_company_knowledge",
  });

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanPrompt),
  ]);

  return NormalizedCompanyKnowledgeSchema.parse(response);
}
/**
 * returns final knowledge object, validation report, raw evidence
 */
export async function buildValidatedCompanyKnowledge(args: {
  companyId: number;
  prompt: string;
}): Promise<{
  knowledge: NormalizedCompanyKnowledge;
  validation: KnowledgeValidationReport;
  evidence: SearchResult[];
}> {
  const evidence = await retrieveCompanyKnowledgeEvidence(args);

  const normalized = await normalizeCompanyKnowledge({
    companyId: args.companyId,
    prompt: args.prompt,
    evidence,
  });

  const validation = await validateCompanyKnowledge({
    knowledge: normalized,
    evidence,
  });

  const revised = await reviseCompanyKnowledgeIfNeeded({
    knowledge: normalized,
    validation,
    evidence,
  });

  return {
    knowledge: revised,
    validation,
    evidence,
  };
}

/**
 * converts deeper structured object we created here into the simpler object
 * expected by marketing pipeline
 */
export function mapValidatedKnowledgeToCompanyDNA(
  knowledge: NormalizedCompanyKnowledge,
): CompanyDNA {
  const coreMission =
    knowledge.whatItDoes && knowledge.whatItDoes !== "Not specified"
      ? knowledge.targetAudience.length > 0
        ? `${knowledge.whatItDoes} for ${knowledge.targetAudience.join(", ")}.`
        : knowledge.whatItDoes
      : "Not specified";

  const provenResults = dedupeStrings([
    ...knowledge.proofPoints,
    ...knowledge.outcomes,
  ]).slice(0, 5);

  const humanStory =
    knowledge.founderStory && knowledge.founderStory !== "Not specified"
      ? knowledge.founderStory
      : knowledge.brandValues.length > 0
        ? `Values signaled: ${knowledge.brandValues.join(", ")}`
        : "Not specified";

  const technicalEdge =
    knowledge.technicalEdge && knowledge.technicalEdge !== "Not specified"
      ? knowledge.technicalEdge
      : knowledge.capabilities.length > 0
        ? `Capabilities include ${knowledge.capabilities.slice(0, 3).join(", ")}.`
        : "Not specified";

  return CompanyDNASchema.parse({
    coreMission,
    keyDifferentiators: knowledge.keyDifferentiators.slice(0, 5),
    provenResults,
    humanStory,
    technicalEdge,
  });
}