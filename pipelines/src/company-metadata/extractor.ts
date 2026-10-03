/**
 * Company fact extraction — one source version's clean passages in, cited
 * facts out.
 *
 *   1. The passages (already stripped of references, tables, figure residue
 *      and boilerplate by ./passages) are numbered [P1]…[Pn] and packed into
 *      calls under a character budget.
 *   2. Each call returns facts with the exact quote and the passage number
 *      that states them.
 *   3. The grounding gate keeps a fact only when its quote appears verbatim
 *      in a passage of that call, and every number in the value appears in
 *      the quote. What survives carries its own page and quote as provenance.
 *   4. Calls are combined with the merger, so the same fact read twice keeps
 *      both citations.
 *
 * Pure apart from the host-supplied `generate`: no database.
 */

import { z, type ZodType } from "zod";

import { mergeCompanyMetadata } from "./merger";
import { normalizeForMatch, quoteAppearsIn, type Passage } from "./passages";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from "./prompts";
import {
    createEmptyMetadata,
    type CompanyInfo,
    type LabeledFact,
    type LegalEntry,
    type MarketsInfo,
    type MetadataFact,
    type MetadataSource,
    type PersonEntry,
    type ProjectEntry,
    type ServiceEntry,
    type SourceFacts,
    type Usage,
    type Visibility,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

/** Passage characters per model call. */
const CALL_BUDGET_CHARS = 12_000;

/** Parallel calls per source. */
const MAX_CONCURRENCY = 4;

/** Facts below this confidence are dropped, as the prompt asks. */
const MIN_CONFIDENCE = 0.4;

/** Stored quote length; the gate checks the full quote first. */
const MAX_QUOTE_CHARS = 300;

/** The reusable facts a proposal or pitch writer keeps at hand, with their labels. */
export const PROFILE_FACT_LABELS = {
    mission: "Mission",
    programs: "Programs",
    beneficiaries: "Who it serves",
    outcomes: "Outcomes",
    need: "Need addressed",
    legal_status: "Legal status",
    annual_budget: "Annual budget",
    funding_sources: "Funding sources",
    funding_raised: "Funding raised",
    customers: "Customers",
    traction: "Traction",
    business_model: "Business model",
    pricing: "Pricing",
    leadership: "Leadership",
    board: "Board",
    partners: "Partners",
    awards: "Awards",
    theory_of_change: "Theory of change",
    evaluation: "Evaluation",
    plans: "Plans",
} as const;
export type ProfileFactKey = keyof typeof PROFILE_FACT_LABELS;
const PROFILE_FACT_KEYS = Object.keys(PROFILE_FACT_LABELS) as [ProfileFactKey, ...ProfileFactKey[]];

// ============================================================================
// Host contract
// ============================================================================

/**
 * Host-supplied structured-extraction function. The vertical has no opinion
 * on which provider answers — apps thread their own `generateStructured`.
 */
export type GenerateStructuredFn = <TSchema extends ZodType>(input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
}) => Promise<z.infer<TSchema>>;

export interface ExtractSourceInput {
    companyName: string;
    documentId: number;
    documentName: string;
    versionId: number | null;
    passages: Passage[];
    generate: GenerateStructuredFn;
    now?: Date;
    /** A person said this source speaks for the organisation (an override), whatever its voice. */
    vouched?: boolean;
}

export interface ExtractSourceResult {
    facts: SourceFacts;
    factCount: number;
    /** Facts the model returned that the grounding gate rejected. */
    rejected: number;
    /** Calls that failed outright; the rest still count. */
    failedCalls: number;
    calls: number;
}

// ============================================================================
// Model output schema
// ============================================================================

/** The fields each section takes; anything else the model names is dropped. */
export const SECTION_FIELDS = {
    company: ["name", "industry", "founded_year", "headquarters", "description", "website", "size"],
    people: ["name", "role", "email", "phone", "department"],
    services: ["name", "description", "status"],
    projects: ["name", "description", "status"],
    legal: ["name", "type", "summary", "effective_date", "expiry_date", "parties", "status"],
    markets: ["primary", "verticals", "geographies"],
    profile: PROFILE_FACT_KEYS,
} as const;
type NamedSection = "people" | "services" | "projects" | "legal";

/**
 * One flat list of statements, not a nested object per section. A nested
 * schema with a fact object at every field is too large for Gemini's
 * structured output ("Request contains an invalid argument") and, when the
 * fact object is shared, turns into `$ref`s it rejects outright — the reason
 * the old extractor never wrote a fact on Gemini. Flat statements keep the
 * schema small; code rebuilds the sections.
 */
const StatementSchema = z.object({
    section: z.enum([
        "company",
        "people",
        "services",
        "projects",
        "legal",
        "markets",
        "policies",
        "profile",
    ]),
    subject: z
        .string()
        .nullable()
        .describe("people/services/projects/legal: the entry's name. Otherwise null."),
    field: z.string().describe("The field within the section; see the instructions"),
    value: z.string(),
    quote: z.string().describe("Exact words copied from one passage that state this fact"),
    passage: z.number().int().describe("The [P#] number of the passage the quote is copied from"),
    confidence: z.number(),
    visibility: z.enum(["public", "partner", "private", "internal"]),
    usage: z.enum(["outreach_ok", "outreach_ok_with_approval", "no_outreach"]),
});
type Statement = z.infer<typeof StatementSchema>;
type CitedFact = Pick<
    Statement,
    "value" | "quote" | "passage" | "confidence" | "visibility" | "usage"
>;

export const ExtractionOutputSchema = z.object({
    facts: z
        .array(StatementSchema)
        .describe("Every fact the passages state about the organisation"),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

// ============================================================================
// Public API
// ============================================================================

export async function extractSourceFacts(input: ExtractSourceInput): Promise<ExtractSourceResult> {
    const now = (input.now ?? new Date()).toISOString();
    const numbered = input.passages.map((p, i) => ({ ...p, n: i + 1 }));
    const batches = packBatches(numbered, CALL_BUDGET_CHARS);
    let rejected = 0;
    let failedCalls = 0;
    const rejectedSamples: string[] = [];

    const outputs = await runWithConcurrency(
        batches.map((batch, idx) => async () => {
            try {
                return await input.generate({
                    system: EXTRACTION_SYSTEM_PROMPT,
                    prompt: buildExtractionPrompt({
                        companyName: input.companyName,
                        documentName: input.documentName,
                        passages: formatPassages(batch),
                        batchIndex: idx,
                        totalBatches: batches.length,
                        vouched: input.vouched,
                    }),
                    schema: ExtractionOutputSchema,
                    schemaName: "company_profile_facts",
                });
            } catch (error) {
                failedCalls++;
                console.error(
                    `[CompanyProfile] Call ${idx + 1}/${batches.length} for document ${input.documentId} failed:`,
                    error
                );
                return null;
            }
        }),
        MAX_CONCURRENCY
    );

    let combined = createEmptyMetadata("source");
    outputs.forEach((output, idx) => {
        if (!output) return;
        const batch = batches[idx] ?? [];
        const grounded = groundOutput(
            output,
            batch,
            {
                doc_id: input.documentId,
                doc_name: input.documentName,
                extracted_at: now,
                ...(input.versionId ? { version_id: input.versionId } : {}),
            },
            rejectedSamples
        );
        rejected += grounded.rejected;
        combined = mergeCompanyMetadata(combined, {
            document_id: input.documentId,
            document_name: input.documentName,
            extracted_at: now,
            facts: grounded.facts,
        }).updatedMetadata;
    });

    const facts = sectionsOf(combined);
    const returned = outputs.reduce((n, o) => n + (o?.facts.length ?? 0), 0);
    console.info(
        `[CompanyProfile] document ${input.documentId}: ${batches.length} call(s), ${returned} statements, ${countFacts(facts)} facts kept, ${rejected} rejected by the quote check${failedCalls ? `, ${failedCalls} call(s) failed` : ""}${rejectedSamples.length ? ` — e.g. ${rejectedSamples.map(q => `«${q}»`).join(" ")}` : ""}`
    );
    return {
        facts,
        factCount: countFacts(facts),
        rejected,
        failedCalls,
        calls: batches.length,
    };
}

/** How many facts a set of sections holds (entries count once per stated field). */
export function countFacts(facts: SourceFacts): number {
    let n = 0;
    const count = (fact: MetadataFact<unknown> | undefined) => {
        if (fact && fact.status === "active") n++;
    };
    const countEntry = (entry: object) => {
        for (const [key, value] of Object.entries(entry) as Array<[string, unknown]>) {
            if (key === "subprojects" && Array.isArray(value))
                (value as object[]).forEach(countEntry);
            else if (value && typeof value === "object" && "value" in value)
                count(value as MetadataFact<unknown>);
        }
    };
    Object.values(facts.company ?? {}).forEach(count);
    for (const list of [facts.people, facts.services, facts.projects, facts.legal])
        (list ?? []).forEach(countEntry);
    for (const cat of ["primary", "verticals", "geographies"] as const)
        (facts.markets?.[cat] ?? []).forEach(count);
    Object.values(facts.policies ?? {}).forEach(count);
    Object.values(facts.profile?.facts ?? {}).forEach(count);
    return n;
}

// ============================================================================
// Grounding gate
// ============================================================================

type NumberedPassage = Passage & { n: number };

/** Digit runs in a value ("$1.2m in FY2025" → ["1.2", "2025"]). */
function numbersIn(text: string): string[] {
    return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map(n => n.replace(/,/g, ""));
}

/**
 * The passage that proves a fact, or null. The named passage is tried
 * first; a quote copied from a neighbouring passage of the same call still
 * counts. Every number in the value must be in the quote — the cheapest
 * guard against a figure the model added.
 */
export function groundFact(
    fact: Pick<CitedFact, "value" | "quote" | "passage">,
    batch: NumberedPassage[]
): NumberedPassage | null {
    const quote = fact.quote.trim();
    if (!quote) return null;
    const quoteNumbers = new Set(numbersIn(quote));
    for (const n of numbersIn(String(fact.value))) if (!quoteNumbers.has(n)) return null;
    const named = batch.find(p => p.n === fact.passage);
    if (named && quoteAppearsIn(quote, named.text)) return named;
    return batch.find(p => p !== named && quoteAppearsIn(quote, p.text)) ?? null;
}

interface GroundContext {
    batch: NumberedPassage[];
    base: MetadataSource;
    rejected: number;
    /** A few rejected quotes, for the log line that explains a thin source. */
    samples?: string[];
}

function hydrate<T = string>(raw: CitedFact | null, ctx: GroundContext): MetadataFact<T> | null {
    if (!raw) return null;
    if (raw.confidence < MIN_CONFIDENCE || String(raw.value).trim() === "") return null;
    const passage = groundFact(raw, ctx.batch);
    if (!passage) {
        ctx.rejected++;
        if (ctx.samples && ctx.samples.length < 3)
            ctx.samples.push(`[P${raw.passage}] ${raw.quote.slice(0, 120)}`);
        return null;
    }
    const quote = raw.quote.trim().replace(/\s+/g, " ");
    return {
        value: (typeof raw.value === "string" ? raw.value.trim() : raw.value) as T,
        visibility: raw.visibility as Visibility,
        usage: raw.usage as Usage,
        confidence: Math.min(1, Math.max(0, raw.confidence)),
        priority: "normal",
        status: "active",
        last_updated: ctx.base.extracted_at,
        sources: [
            {
                ...ctx.base,
                ...(passage.page !== null ? { page: passage.page } : {}),
                snippet_ref: `chunk:${passage.chunkId}`,
                quote:
                    quote.length > MAX_QUOTE_CHARS
                        ? `${quote.slice(0, MAX_QUOTE_CHARS - 1)}…`
                        : quote,
            },
        ],
    };
}

const normaliseName = (value: string): string => value.toLowerCase().trim().replace(/\s+/g, " ");

/**
 * The quote names the entry: every word of the subject (three letters or
 * more) is in it — "Propositionizer model" is named by "we named the model
 * Propositionizer", "Tong Chen" is not named by "Jane Doe is our CEO".
 */
const SUBJECT_STOPWORDS = new Set(["the", "and", "for", "our", "inc", "llc", "ltd"]);

function subjectInQuote(subject: string, quote: string): boolean {
    const words = new Set(normalizeForMatch(quote).split(/[^\p{L}\p{N}]+/u));
    const wanted = normalizeForMatch(subject)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(w => w.length >= 3 && !SUBJECT_STOPWORDS.has(w));
    return wanted.length > 0 && wanted.every(w => words.has(w));
}

/** The name, as written, inside the quote that states it. */
function nameInQuote(name: string, quote: string): boolean {
    const n = normalizeForMatch(name);
    return n.length > 0 && normalizeForMatch(quote).includes(n);
}

function groundOutput(
    output: ExtractionOutput,
    batch: NumberedPassage[],
    base: MetadataSource,
    samples?: string[]
): { facts: SourceFacts; rejected: number } {
    const ctx: GroundContext = { batch, base, rejected: 0, samples };
    const company: CompanyInfo = {};
    const markets: MarketsInfo = {};
    const policies: Record<string, MetadataFact> = {};
    const profileFacts: Record<string, LabeledFact> = {};
    const entries: Record<NamedSection, Map<string, Record<string, MetadataFact>>> = {
        people: new Map(),
        services: new Map(),
        projects: new Map(),
        legal: new Map(),
    };
    const better = (a: MetadataFact | undefined, b: MetadataFact) =>
        !a || b.confidence > a.confidence;

    for (const statement of output.facts) {
        const field = statement.field
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_");
        const fields = (SECTION_FIELDS as Record<string, readonly string[]>)[statement.section];
        if (fields && !fields.includes(field)) continue;
        const fact = hydrate(statement, ctx);
        if (!fact) continue;
        // A name is copied, never inferred: "LaunchStack Dev" from a quote saying "Launchstack" is a guess.
        if (field === "name" && !nameInQuote(String(fact.value), fact.sources[0]?.quote ?? "")) {
            ctx.rejected++;
            continue;
        }

        switch (statement.section) {
            case "company": {
                if (field === "founded_year") {
                    const year = Number(/\d{4}/.exec(String(fact.value))?.[0]);
                    if (
                        Number.isInteger(year) &&
                        better(company.founded_year as MetadataFact | undefined, fact)
                    )
                        company.founded_year = { ...fact, value: year };
                } else if (better(company[field] as MetadataFact | undefined, fact))
                    company[field] = fact;
                break;
            }
            case "markets": {
                const cat = field as keyof MarketsInfo;
                const list = (markets[cat] ??= []);
                if (
                    !list.some(
                        f => normaliseName(String(f.value)) === normaliseName(String(fact.value))
                    )
                )
                    list.push(fact);
                break;
            }
            case "policies": {
                const key = statement.field.trim();
                if (key && better(policies[key], fact)) policies[key] = fact;
                break;
            }
            case "profile": {
                if (better(profileFacts[field], fact))
                    profileFacts[field] = {
                        ...fact,
                        label: PROFILE_FACT_LABELS[field as ProfileFactKey],
                    };
                break;
            }
            default: {
                // A named entry: its name is the subject, proven by the same quote.
                // Models write the string "null" for a missing subject as often as null.
                const named = statement.subject?.trim();
                const subject = (
                    named && named.toLowerCase() !== "null"
                        ? named
                        : field === "name"
                          ? String(fact.value)
                          : ""
                ).trim();
                if (!subject) continue;
                if (!subjectInQuote(subject, fact.sources[0]?.quote ?? "")) {
                    ctx.rejected++;
                    continue;
                }
                const map = entries[statement.section];
                const key = normaliseName(subject);
                // The name as the document writes it when stated; else the subject the model used.
                const nameFact = field === "name" ? fact : { ...fact, value: subject };
                const entry = map.get(key) ?? { name: nameFact };
                if (field !== "name" && better(entry[field], fact)) entry[field] = fact;
                else if (
                    field === "name" &&
                    (entry.name === nameFact ||
                        better(entry.name, fact) ||
                        entry.name?.value === subject)
                )
                    entry.name = nameFact;
                map.set(key, entry);
            }
        }
    }

    const list = <T>(section: NamedSection) => [...entries[section].values()] as unknown as T[];
    const people = list<PersonEntry>("people");
    const services = list<ServiceEntry>("services");
    const projects = list<ProjectEntry>("projects");
    const legal = list<LegalEntry>("legal");
    return {
        rejected: ctx.rejected,
        facts: {
            ...(Object.keys(company).length && { company }),
            ...(people.length && { people }),
            ...(services.length && { services }),
            ...(Object.keys(markets).length && { markets }),
            ...(projects.length && { projects }),
            ...(Object.keys(policies).length && { policies }),
            ...(legal.length && { legal }),
            ...(Object.keys(profileFacts).length && { profile: { facts: profileFacts } }),
        },
    };
}

/** The fact sections of a merged document, without its envelope. */
function sectionsOf(metadata: ReturnType<typeof createEmptyMetadata>): SourceFacts {
    const out: SourceFacts = {};
    if (Object.keys(metadata.company).length) out.company = metadata.company;
    if (metadata.people.length) out.people = metadata.people;
    if (metadata.services.length) out.services = metadata.services;
    if (Object.keys(metadata.markets).length) out.markets = metadata.markets;
    if (metadata.projects.length) out.projects = metadata.projects;
    if (Object.keys(metadata.policies).length) out.policies = metadata.policies;
    if (metadata.legal.length) out.legal = metadata.legal;
    if (metadata.profile?.facts && Object.keys(metadata.profile.facts).length)
        out.profile = { facts: metadata.profile.facts };
    return out;
}

// ============================================================================
// Batching
// ============================================================================

function formatPassages(batch: NumberedPassage[]): string {
    return batch
        .map(p => `[P${p.n}]${p.page !== null ? ` (p. ${p.page})` : ""} ${p.text}`)
        .join("\n\n");
}

/** Consecutive passages up to a character budget; a single long passage gets a call of its own. */
function packBatches(passages: NumberedPassage[], budget: number): NumberedPassage[][] {
    const batches: NumberedPassage[][] = [];
    let current: NumberedPassage[] = [];
    let size = 0;
    for (const passage of passages) {
        if (current.length && size + passage.text.length > budget) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(passage);
        size += passage.text.length;
    }
    if (current.length) batches.push(current);
    return batches;
}

/** Run async tasks with a concurrency limit; results keep the input order. */
export async function runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    limit: number
): Promise<T[]> {
    const results = Array.from<T>({ length: tasks.length });
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < tasks.length) {
            const idx = nextIndex++;
            const task = tasks[idx];
            if (task) results[idx] = await task();
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    return results;
}
