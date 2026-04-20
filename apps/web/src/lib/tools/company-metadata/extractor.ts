/**
 * Company Metadata Extractor — Chunk-Level Extraction + Aggregation
 *
 * Instead of sending the whole document in one LLM call, this extractor:
 *   1. Reads all chunks for a document from the database.
 *   2. Groups them into small batches (configurable).
 *   3. Sends each batch to the LLM in parallel (with concurrency cap).
 *   4. Aggregates and deduplicates the per-batch results:
 *      - Company fields: highest confidence wins.
 *      - People/services/projects: matched by normalised name, fields merged.
 *      - Markets: union of unique values.
 *      - Policies: merge by key, highest confidence wins.
 *      - Facts seen in multiple batches get a confidence boost.
 *   5. Returns a single {@link ExtractedCompanyFacts} — same contract as before.
 *
 * This is a pure extraction step — it does NOT write to the database.
 */

import { z } from "zod";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { documentContextChunks, document as documentTable } from "@launchstack/core/db/schema";
import { generateStructured } from "~/lib/llm";
import {
    EXTRACTION_SYSTEM_PROMPT,
    buildChunkExtractionPrompt,
} from "./prompts";
import type {
    ExtractedCompanyFacts,
    MetadataFact,
    MetadataSource,
    Visibility,
    Usage,
    CompanyInfo,
    PersonEntry,
    ServiceEntry,
    ProjectEntry,
    SubprojectEntry,
    LegalEntry,
    MarketsInfo,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

/** Number of chunks per LLM batch. */
const CHUNKS_PER_BATCH = 15;

/**
 * Max parallel LLM calls.
 *
 * Note: this was chosen for OpenAI cloud throughput. When the active provider
 * is Ollama (single-GPU local inference) this may be too aggressive and
 * saturate the local model. The unified LLM library doesn't currently expose
 * per-provider concurrency hints; if we see problems in practice, add a
 * capability-level `maxConcurrency` to the config and plumb it through here.
 */
const MAX_CONCURRENCY = 5;

/**
 * Confidence boost when a fact is seen in multiple batches.
 * Final confidence = min(1.0, base + MULTI_MENTION_BOOST * (mentionCount - 1))
 */
const MULTI_MENTION_BOOST = 0.05;

// ============================================================================
// Boilerplate detection heuristics
// ============================================================================

/** Minimum character count for a chunk to be worth sending to LLM. */
const MIN_CHUNK_CHARS = 40;

/** Patterns that indicate boilerplate content (case-insensitive). */
const BOILERPLATE_PATTERNS = [
    /^table of contents$/i,
    /^\s*contents\s*$/i,
    /^page\s+\d+\s*(of\s+\d+)?$/i,
    /^©\s*\d{4}/,
    /copyright\s+©?\s*\d{4}/i,
    /all rights reserved/i,
    /confidential\s+and\s+proprietary/i,
    /^\s*disclaimer\s*$/i,
    /this document is confidential/i,
    /do not distribute/i,
    /^\s*\d+\s*$/,                            // just a page number
    /^(\.{2,}\s*\d+\s*\n?)+$/,               // TOC dotted lines: "Section...12"
];

/**
 * Returns true if a chunk is likely boilerplate that won't contain
 * useful company metadata. Uses content length and pattern matching.
 */
function isBoilerplate(content: string): boolean {
    const trimmed = content.trim();

    // Too short to contain meaningful facts
    if (trimmed.length < MIN_CHUNK_CHARS) return true;

    // Check against boilerplate patterns
    for (const pattern of BOILERPLATE_PATTERNS) {
        if (pattern.test(trimmed)) return true;
    }

    // TOC heuristic: many lines that end with page numbers (e.g., "Introduction ... 3")
    const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 3) {
        const tocLines = lines.filter((l) => /\.{2,}\s*\d+\s*$/.test(l) || /\s{3,}\d+\s*$/.test(l));
        if (tocLines.length / lines.length > 0.6) return true;
    }

    return false;
}

// ============================================================================
// Zod schema for structured output (same schema, used per-batch)
// ============================================================================

const MetadataFactSchema = z.object({
    value: z.union([z.string(), z.number()]),
    visibility: z.enum(["public", "partner", "private", "internal"]),
    usage: z.enum(["outreach_ok", "outreach_ok_with_approval", "no_outreach"]),
    confidence: z.number(),
});

const PersonSchema = z.object({
    name: MetadataFactSchema,
    role: MetadataFactSchema.nullable(),
    email: MetadataFactSchema.nullable(),
    phone: MetadataFactSchema.nullable(),
    department: MetadataFactSchema.nullable(),
});

const ServiceSchema = z.object({
    name: MetadataFactSchema,
    description: MetadataFactSchema.nullable(),
    status: MetadataFactSchema.nullable(),
});

const SubprojectSchema = z.object({
    name: MetadataFactSchema,
    description: MetadataFactSchema.nullable(),
    status: MetadataFactSchema.nullable(),
});

const ProjectSchema = z.object({
    name: MetadataFactSchema,
    description: MetadataFactSchema.nullable(),
    status: MetadataFactSchema.nullable(),
    subprojects: z.array(SubprojectSchema).nullable(),
});

const LegalSchema = z.object({
    name: MetadataFactSchema,
    type: MetadataFactSchema.nullable(),
    summary: MetadataFactSchema.nullable(),
    effective_date: MetadataFactSchema.nullable(),
    expiry_date: MetadataFactSchema.nullable(),
    parties: MetadataFactSchema.nullable(),
    status: MetadataFactSchema.nullable(),
});

const ExtractionOutputSchema = z.object({
    company: z
        .object({
            name: MetadataFactSchema.nullable(),
            industry: MetadataFactSchema.nullable(),
            founded_year: MetadataFactSchema.nullable(),
            headquarters: MetadataFactSchema.nullable(),
            description: MetadataFactSchema.nullable(),
            website: MetadataFactSchema.nullable(),
            size: MetadataFactSchema.nullable(),
        })
        .describe("Core company-level facts"),
    people: z.array(PersonSchema).describe("Key people mentioned"),
    services: z.array(ServiceSchema).describe("Products or services offered"),
    markets: z
        .object({
            primary: z.array(MetadataFactSchema).nullable(),
            verticals: z.array(MetadataFactSchema).nullable(),
            geographies: z.array(MetadataFactSchema).nullable(),
        })
        .describe("Target markets, verticals, and geographies"),
    projects: z.array(ProjectSchema).describe("Projects and subprojects"),
    policies: z
        .array(
            z.object({
                key: z.string().describe("Policy identifier, e.g. 'SOC2', 'GDPR', 'HIPAA'"),
                fact: MetadataFactSchema,
            }),
        )
        .describe("Company policies, certifications, or compliance facts"),
    legal: z
        .array(LegalSchema)
        .describe("Legal documents, contracts, NDAs, terms of service, privacy policies, or regulatory references"),
});

type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
type RawFact = z.infer<typeof MetadataFactSchema>;

// ============================================================================
// Public API
// ============================================================================

export interface ExtractorInput {
    documentId: number;
    companyId: string;
}

/**
 * Extract company metadata facts from a single document using chunk-level
 * extraction with parallel LLM calls and cross-chunk aggregation.
 *
 * Returns `null` if the document has no chunks or no facts were found.
 */
export async function extractCompanyFacts(
    input: ExtractorInput,
): Promise<ExtractedCompanyFacts | null> {
    const { documentId } = input;

    // 1. Fetch document name
    const [doc] = await db
        .select({ title: documentTable.title })
        .from(documentTable)
        .where(eq(documentTable.id, documentId))
        .limit(1);

    if (!doc) {
        console.warn(`[CompanyMetadataExtractor] Document ${documentId} not found`);
        return null;
    }

    // 2. Fetch chunks for the CURRENT version only, sorted by page.
    //
    // The join + version filter is important: without it, this query returns
    // chunks from every historical version of the document. On a doc with N
    // versions that's N× the chunks and N× the input tokens into the LLM
    // call below, plus it re-extracts facts from content that was already
    // processed when prior versions uploaded — wasted work that scales
    // super-linearly because structured output latency grows with prompt size.
    //
    // The semantics also match RAG: the company metadata should reflect the
    // document's *current* authoritative content, not a union of every
    // historical claim. Reverting to an old version will cause the next run
    // to re-extract from that version's chunks, which is the correct behavior.
    //
    // The IS NULL branches preserve Phase-1 rollout safety: if the document
    // or its chunks predate the versioning backfill, we fall through to
    // returning all chunks rather than hiding them.
    const chunks = await db
        .select({
            content: documentContextChunks.content,
            pageNumber: documentContextChunks.pageNumber,
            semanticType: documentContextChunks.semanticType,
        })
        .from(documentContextChunks)
        .innerJoin(
            documentTable,
            eq(documentContextChunks.documentId, documentTable.id),
        )
        .where(
            and(
                eq(documentContextChunks.documentId, BigInt(documentId)),
                or(
                    isNull(documentTable.currentVersionId),
                    isNull(documentContextChunks.versionId),
                    sql`${documentContextChunks.versionId} = ${documentTable.currentVersionId}`,
                ),
            ),
        );

    if (chunks.length === 0) {
        console.warn(
            `[CompanyMetadataExtractor] No chunks for document ${documentId}`,
        );
        return null;
    }

    const sortedChunks = chunks.sort(
        (a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0),
    );

    // 2b. Filter out low-value chunks to reduce LLM tokens
    const filteredChunks = sortedChunks.filter((c) => {
        // Skip chunks tagged as reference (TOCs, disclaimers)
        if (c.semanticType === "reference") {
            return false;
        }
        // Skip chunks that are mostly boilerplate based on content heuristics
        if (isBoilerplate(c.content)) {
            return false;
        }
        return true;
    });

    if (filteredChunks.length === 0) {
        console.warn(
            `[CompanyMetadataExtractor] All ${chunks.length} chunks filtered as boilerplate for document ${documentId}`,
        );
        return null;
    }

    // 3. Split into batches
    const batches = splitIntoBatches(
        filteredChunks.map((c) => c.content),
        CHUNKS_PER_BATCH,
    );

    console.log(
        `[CompanyMetadataExtractor] Document ${documentId}: ${chunks.length} chunks → ${filteredChunks.length} after filtering → ${batches.length} batches`,
    );

    // 4. Extract from each batch in parallel (capped concurrency)
    const batchResults = await runWithConcurrency(
        batches.map((batch, idx) => () => callLLM(doc.title, batch.join("\n\n"), idx, batches.length)),
        MAX_CONCURRENCY,
    );

    // Filter out failed/empty batches
    const successfulResults = batchResults.filter(
        (r): r is ExtractionOutput => r !== null,
    );

    if (successfulResults.length === 0) {
        console.warn(
            `[CompanyMetadataExtractor] All ${batches.length} batch extractions returned empty for document ${documentId}`,
        );
        return null;
    }

    console.log(
        `[CompanyMetadataExtractor] ${successfulResults.length}/${batches.length} batches returned facts`,
    );

    // 5. Aggregate across all batch results
    const now = new Date().toISOString();
    const source: MetadataSource = {
        doc_id: documentId,
        doc_name: doc.title,
        extracted_at: now,
    };

    return aggregateResults(successfulResults, documentId, doc.title, now, source);
}

// ============================================================================
// Batch helpers
// ============================================================================

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Run async tasks with a concurrency limit.
 * Returns results in the same order as the input tasks.
 */
async function runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    limit: number,
): Promise<T[]> {
    const results = Array.from<T>({ length: tasks.length });
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < tasks.length) {
            const idx = nextIndex++;
            const task = tasks[idx];
            if (task) {
                results[idx] = await task();
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(limit, tasks.length) },
        () => worker(),
    );
    await Promise.all(workers);
    return results;
}

// ============================================================================
// LLM call (per-batch)
// ============================================================================

/**
 * Per-batch extraction call. Routes through the unified LLM library rather
 * than instantiating a specific provider, so the same call works against
 * OpenAI, Anthropic, Gemini, or local Ollama depending on which credentials
 * are available. See `src/lib/llm/` for the resolution logic.
 *
 * On any failure (network, rate limit, schema validation) this returns
 * `null` so the caller can drop the batch and continue with the rest.
 * Individual batch failures are logged but not thrown — consistent with
 * the pre-migration behavior that treated partial extraction as acceptable.
 */
async function callLLM(
    documentName: string,
    batchContent: string,
    batchIndex: number,
    totalBatches: number,
): Promise<ExtractionOutput | null> {
    try {
        return await generateStructured({
            capability: "smallExtraction",
            system: EXTRACTION_SYSTEM_PROMPT,
            prompt: buildChunkExtractionPrompt(
                documentName,
                batchContent,
                batchIndex,
                totalBatches,
            ),
            schema: ExtractionOutputSchema,
            schemaName: "company_metadata_extraction",
        });
    } catch (error) {
        console.error(
            `[CompanyMetadataExtractor] Batch ${batchIndex + 1}/${totalBatches} failed:`,
            error,
        );
        return null;
    }
}

// ============================================================================
// Aggregation: merge results from all batches into one ExtractedCompanyFacts
// ============================================================================

function aggregateResults(
    batchResults: ExtractionOutput[],
    documentId: number,
    documentName: string,
    extractedAt: string,
    source: MetadataSource,
): ExtractedCompanyFacts {
    // ---- Company fields: take highest confidence per field ----
    const company: CompanyInfo = {};
    const companyFields = [
        "name",
        "industry",
        "founded_year",
        "headquarters",
        "description",
        "website",
        "size",
    ] as const;

    for (const field of companyFields) {
        const candidates = batchResults
            .map((r) => r.company[field])
            .filter((f): f is RawFact => f != null);

        if (candidates.length > 0) {
            const best = pickHighestConfidence(candidates);
            const boosted = boostConfidence(best.confidence, candidates.length);
            (company as Record<string, unknown>)[field] = hydrate(
                best,
                boosted,
                extractedAt,
                source,
            );
        }
    }

    // ---- People: merge by normalised name ----
    const people = mergeNamedEntries(
        batchResults.flatMap((r) => r.people),
        extractedAt,
        source,
        hydratePersonEntry,
    );

    // ---- Services: merge by normalised name ----
    const services = mergeNamedEntries(
        batchResults.flatMap((r) => r.services),
        extractedAt,
        source,
        hydrateServiceEntry,
    );

    // ---- Projects: merge by normalised name ----
    const projects = mergeNamedEntries(
        batchResults.flatMap((r) => r.projects),
        extractedAt,
        source,
        hydrateProjectEntry,
    );

    // ---- Markets: union unique values per category ----
    const markets: MarketsInfo = {};
    const marketCategories = ["primary", "verticals", "geographies"] as const;

    for (const cat of marketCategories) {
        const allFacts = batchResults
            .flatMap((r) => r.markets[cat] ?? []);
        const unique = deduplicateByValue(allFacts);
        if (unique.length > 0) {
            markets[cat] = unique.map((u) =>
                hydrate(u.best, boostConfidence(u.best.confidence, u.count), extractedAt, source),
            );
        }
    }

    // ---- Policies: merge by key, highest confidence wins ----
    const policies: Record<string, MetadataFact> = {};
    for (const result of batchResults) {
        for (const entry of result.policies) {
            const existing = policies[entry.key];
            const hydrated = hydrate(entry.fact, entry.fact.confidence, extractedAt, source);
            if (!existing || entry.fact.confidence > existing.confidence) {
                policies[entry.key] = hydrated;
            }
        }
    }

    // ---- Legal: merge by normalised name ----
    const legal = mergeNamedEntries(
        batchResults.flatMap((r) => r.legal),
        extractedAt,
        source,
        hydrateLegalEntry,
    );

    // ---- Assemble ----
    return {
        document_id: documentId,
        document_name: documentName,
        extracted_at: extractedAt,
        facts: {
            ...(Object.keys(company).length > 0 && { company }),
            ...(people.length > 0 && { people }),
            ...(services.length > 0 && { services }),
            ...(Object.keys(markets).length > 0 && { markets }),
            ...(projects.length > 0 && { projects }),
            ...(Object.keys(policies).length > 0 && { policies }),
            ...(legal.length > 0 && { legal }),
        },
    };
}

// ============================================================================
// Hydration: raw LLM fact → full MetadataFact
// ============================================================================

function hydrate<T = string>(
    fact: RawFact,
    confidence: number,
    extractedAt: string,
    source: MetadataSource,
): MetadataFact<T> {
    return {
        value: fact.value as T,
        visibility: fact.visibility as Visibility,
        usage: fact.usage as Usage,
        confidence,
        priority: "normal" as const,
        status: "active" as const,
        last_updated: extractedAt,
        sources: [source],
    };
}

// ============================================================================
// Deduplication helpers
// ============================================================================

/** Normalise a name for dedup comparison. */
function normaliseName(raw: string | number): string {
    return String(raw).toLowerCase().trim().replace(/\s+/g, " ");
}

/** From a list of raw facts for the same field, pick the one with highest confidence. */
function pickHighestConfidence(candidates: RawFact[]): RawFact {
    return candidates.reduce((best, c) =>
        c.confidence > best.confidence ? c : best,
    );
}

/** Boost confidence when a fact is confirmed by multiple batches. */
function boostConfidence(base: number, mentionCount: number): number {
    if (mentionCount <= 1) return base;
    return Math.min(1.0, base + MULTI_MENTION_BOOST * (mentionCount - 1));
}

/** Deduplicate an array of raw facts by normalised value, tracking mention count. */
function deduplicateByValue(
    facts: RawFact[],
): Array<{ best: RawFact; count: number }> {
    const map = new Map<string, { best: RawFact; count: number }>();

    for (const fact of facts) {
        const key = normaliseName(fact.value);
        const existing = map.get(key);
        if (!existing) {
            map.set(key, { best: fact, count: 1 });
        } else {
            existing.count++;
            if (fact.confidence > existing.best.confidence) {
                existing.best = fact;
            }
        }
    }

    return Array.from(map.values());
}

/**
 * Generic merge for arrays of named entries (people, services, projects).
 * Groups by normalised name, then calls a type-specific hydrator.
 */
function mergeNamedEntries<TRaw extends { name: RawFact }, TOut>(
    entries: TRaw[],
    extractedAt: string,
    source: MetadataSource,
    hydrateEntry: (
        grouped: TRaw[],
        extractedAt: string,
        source: MetadataSource,
    ) => TOut,
): TOut[] {
    const groups = new Map<string, TRaw[]>();

    for (const entry of entries) {
        const key = normaliseName(entry.name.value);
        const group = groups.get(key);
        if (group) {
            group.push(entry);
        } else {
            groups.set(key, [entry]);
        }
    }

    return Array.from(groups.values()).map((group) =>
        hydrateEntry(group, extractedAt, source),
    );
}

// ============================================================================
// Type-specific entry hydrators
// ============================================================================

type RawPerson = z.infer<typeof PersonSchema>;
type RawService = z.infer<typeof ServiceSchema>;
type RawProject = z.infer<typeof ProjectSchema>;
type RawSubproject = z.infer<typeof SubprojectSchema>;
type RawLegal = z.infer<typeof LegalSchema>;

function hydratePersonEntry(
    group: RawPerson[],
    extractedAt: string,
    source: MetadataSource,
): PersonEntry {
    const count = group.length;
    const bestName = pickHighestConfidence(group.map((g) => g.name));

    const entry: PersonEntry = {
        name: hydrate(bestName, boostConfidence(bestName.confidence, count), extractedAt, source),
    };

    const optionalFields = ["role", "email", "phone", "department"] as const;
    for (const field of optionalFields) {
        const candidates = group
            .map((g) => g[field])
            .filter((f): f is RawFact => f != null);
        if (candidates.length > 0) {
            const best = pickHighestConfidence(candidates);
            entry[field] = hydrate(best, boostConfidence(best.confidence, candidates.length), extractedAt, source);
        }
    }

    return entry;
}

function hydrateServiceEntry(
    group: RawService[],
    extractedAt: string,
    source: MetadataSource,
): ServiceEntry {
    const count = group.length;
    const bestName = pickHighestConfidence(group.map((g) => g.name));

    const entry: ServiceEntry = {
        name: hydrate(bestName, boostConfidence(bestName.confidence, count), extractedAt, source),
    };

    const optionalFields = ["description", "status"] as const;
    for (const field of optionalFields) {
        const candidates = group
            .map((g) => g[field])
            .filter((f): f is RawFact => f != null);
        if (candidates.length > 0) {
            const best = pickHighestConfidence(candidates);
            entry[field] = hydrate(best, boostConfidence(best.confidence, candidates.length), extractedAt, source);
        }
    }

    return entry;
}

function hydrateProjectEntry(
    group: RawProject[],
    extractedAt: string,
    source: MetadataSource,
): ProjectEntry {
    const count = group.length;
    const bestName = pickHighestConfidence(group.map((g) => g.name));

    const entry: ProjectEntry = {
        name: hydrate(bestName, boostConfidence(bestName.confidence, count), extractedAt, source),
    };

    const optionalFields = ["description", "status"] as const;
    for (const field of optionalFields) {
        const candidates = group
            .map((g) => g[field])
            .filter((f): f is RawFact => f != null);
        if (candidates.length > 0) {
            const best = pickHighestConfidence(candidates);
            entry[field] = hydrate(best, boostConfidence(best.confidence, candidates.length), extractedAt, source);
        }
    }

    // Merge subprojects across all mentions of this project
    const allSubprojects = group.flatMap((g) => g.subprojects ?? []);
    if (allSubprojects.length > 0) {
        entry.subprojects = mergeNamedEntries(
            allSubprojects,
            extractedAt,
            source,
            hydrateSubprojectEntry,
        );
    }

    return entry;
}

function hydrateSubprojectEntry(
    group: RawSubproject[],
    extractedAt: string,
    source: MetadataSource,
): SubprojectEntry {
    const count = group.length;
    const bestName = pickHighestConfidence(group.map((g) => g.name));

    const entry: SubprojectEntry = {
        name: hydrate(bestName, boostConfidence(bestName.confidence, count), extractedAt, source),
    };

    const optionalFields = ["description", "status"] as const;
    for (const field of optionalFields) {
        const candidates = group
            .map((g) => g[field])
            .filter((f): f is RawFact => f != null);
        if (candidates.length > 0) {
            const best = pickHighestConfidence(candidates);
            entry[field] = hydrate(best, boostConfidence(best.confidence, candidates.length), extractedAt, source);
        }
    }

    return entry;
}

function hydrateLegalEntry(
    group: RawLegal[],
    extractedAt: string,
    source: MetadataSource,
): LegalEntry {
    const count = group.length;
    const bestName = pickHighestConfidence(group.map((g) => g.name));

    const entry: LegalEntry = {
        name: hydrate(bestName, boostConfidence(bestName.confidence, count), extractedAt, source),
    };

    const optionalFields = ["type", "summary", "effective_date", "expiry_date", "parties", "status"] as const;
    for (const field of optionalFields) {
        const candidates = group
            .map((g) => g[field])
            .filter((f): f is RawFact => f != null);
        if (candidates.length > 0) {
            const best = pickHighestConfidence(candidates);
            entry[field] = hydrate(best, boostConfidence(best.confidence, candidates.length), extractedAt, source);
        }
    }

    return entry;
}
