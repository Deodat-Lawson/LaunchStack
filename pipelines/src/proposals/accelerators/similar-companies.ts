import { z } from "zod";

/**
 * Past accepted companies of a Supported accelerator and the application
 * responses some of them published. Records are collected by a trusted
 * operator into the local installation database; they are not catalogue
 * fixtures and are never committed to the repository.
 */

export const SEASON_START_MONTH = { Winter: 1, Spring: 4, Summer: 6, Fall: 9 } as const;
type Season = keyof typeof SEASON_START_MONTH;

export interface PastCompany {
    /** `${programId}:${slug}` — stable across re-collection. */
    id: string;
    programId: string;
    slug: string;
    externalId: string;
    name: string;
    formerNames: string[];
    /** Batch label as published, e.g. "Winter 2012". */
    batch: string;
    /** First day of the batch's start month (YYYY-MM-DD); used for ordering. */
    batchStartsOn: string;
    oneLiner: string | null;
    description: string | null;
    industries: string[];
    tags: string[];
    location: string | null;
    regions: string[];
    /** Current status as published now (Active, Acquired, …), not at acceptance. */
    status: string | null;
    teamSize: number | null;
    website: string | null;
    /** Official accelerator profile; shown as a link only. */
    profileUrl: string | null;
    sourceUrl: string;
}

/** `original`: published by the founders, or by the accelerator as the company's application. */
export const APPLICATION_PROVENANCE = ["original", "unverified_copy"] as const;
export type ApplicationProvenance = (typeof APPLICATION_PROVENANCE)[number];

/** Where one published application lives and how to cut it out of its page. */
export interface ApplicationSource {
    companySlug: string;
    provenance: ApplicationProvenance;
    url: string;
    originalUrl?: string;
    appliedAs?: string;
    statedBatch?: string;
    note: string;
    caveats?: string[];
    /** Absent: keep a link only and never fetch the page. */
    extract?: {
        startAt: string;
        endBefore?: string;
        /** Prompts this page uses that do not read as questions. */
        extraPrompts?: string[];
        /** Whole lines that belong to the page, not the application. */
        dropLines?: string[];
        /** Labels the page inserts between answers. */
        removeText?: string[];
    };
}

export interface ApplicationSection {
    question: string;
    answer: string;
}

export interface ApplicationResponse {
    id: string;
    programId: string;
    /** Portfolio company this application belongs to, when it resolves. */
    companyId: string | null;
    /** Name the company applied under, when it differs from its current name. */
    appliedAs: string | null;
    /** Batch the publisher states; may disagree with the accelerator's own record. */
    statedBatch: string | null;
    provenance: ApplicationProvenance;
    sourceUrl: string;
    /** Founder's original page, when the stored copy comes from a collection site. */
    originalUrl: string | null;
    /** Publisher's description of what they released. */
    note: string;
    /** Known limitations: commentary mixed in, redactions, preview-only, … */
    caveats: string[];
    /** Null when only a link is kept. */
    sections: ApplicationSection[] | null;
}

export interface SimilarCompany {
    company: PastCompany;
    /** Industries and tags the Core profile also names. */
    sharedTerms: string[];
    /** Application this company published, when one is stored. */
    application: ApplicationResponse | null;
}

/** What a Program page shows about past accepted companies. */
export type SimilarCompaniesView =
    | { supported: false }
    | {
          supported: true;
          profileReady: boolean;
          totalCompanies: number;
          companies: SimilarCompany[];
      };

/** Start date of a batch label such as "Summer 2009"; null when it is not a dated batch. */
export function parseBatchLabel(
    label: string
): { season: Season; year: number; startsOn: string } | null {
    const match = /^(Winter|Spring|Summer|Fall)\s+(\d{4})$/.exec(label.trim());
    if (!match) return null;
    const season = match[1] as Season;
    const year = Number(match[2]);
    const month = String(SEASON_START_MONTH[season]).padStart(2, "0");
    return { season, year, startsOn: `${year}-${month}-01` };
}

/** Only batches that have already started hold accepted companies; future cohorts are excluded. */
export function hasBatchStarted(label: string, now: Date): boolean {
    const batch = parseBatchLabel(label);
    if (!batch) return false;
    return batch.startsOn <= now.toISOString().slice(0, 10);
}

const YcOssCompanySchema = z.object({
    id: z.number().int(),
    name: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    former_names: z.array(z.string()).nullish(),
    website: z.string().nullish(),
    all_locations: z.string().nullish(),
    long_description: z.string().nullish(),
    one_liner: z.string().nullish(),
    team_size: z.number().int().nullish(),
    industries: z.array(z.string()).nullish(),
    tags: z.array(z.string()).nullish(),
    regions: z.array(z.string()).nullish(),
    status: z.string().nullish(),
    batch: z.string(),
    url: z.string().nullish(),
    api: z.string().url(),
});

function text(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed?.length ? trimmed : null;
}

function list(values: string[] | null | undefined): string[] {
    const seen = new Set<string>();
    for (const value of values ?? []) {
        const trimmed = value.trim();
        if (trimmed) seen.add(trimmed);
    }
    return [...seen];
}

/**
 * Map one yc-oss record (a mirror of YC's public directory index) to a
 * PastCompany. Returns null for records without a dated batch.
 */
export function normalizeYcOssCompany(raw: unknown, programId: string): PastCompany | null {
    const record = YcOssCompanySchema.parse(raw);
    const batch = parseBatchLabel(record.batch);
    if (!batch) return null;
    const slug = record.slug.trim();
    return {
        id: `${programId}:${slug}`,
        programId,
        slug,
        externalId: String(record.id),
        name: record.name.trim(),
        formerNames: list(record.former_names).filter(name => name !== record.name.trim()),
        batch: record.batch.trim(),
        batchStartsOn: batch.startsOn,
        oneLiner: text(record.one_liner),
        description: text(record.long_description),
        industries: list(record.industries),
        tags: list(record.tags),
        location: text(record.all_locations),
        regions: list(record.regions),
        status: text(record.status),
        teamSize: record.team_size ?? null,
        website: text(record.website),
        profileUrl: text(record.url),
        sourceUrl: record.api,
    };
}

const EMBEDDING_TEXT_LIMIT = 2_000;

/**
 * The text a company is embedded from: what it does, then how it is
 * classified. The name is left out so a shared name ("Northwind") never makes
 * two unrelated companies look alike.
 */
export function companyEmbeddingText(company: PastCompany): string {
    const parts = [
        company.oneLiner,
        company.description,
        company.industries.length > 0 ? `Industries: ${company.industries.join(", ")}` : null,
        company.tags.length > 0 ? `Tags: ${company.tags.join(", ")}` : null,
    ];
    return parts.filter(Boolean).join("\n").slice(0, EMBEDDING_TEXT_LIMIT);
}

/** Profile facts that describe what the company does, in the order they are embedded. */
const PROFILE_FACT_KEYS = [
    "description",
    "industry",
    "products_and_services",
    "markets",
    "customers",
    "business_model",
    "mission",
    "traction",
];

/**
 * The Core profile as text comparable to `companyEmbeddingText`: what the
 * company does and for whom. Team, funding and legal facts are left out
 * because past companies are compared on their product, not their size.
 */
export function profileEmbeddingText(profile: {
    summary: string;
    focusAreas: string[];
    facts: { key: string; label: string; value: string }[];
}): string {
    const facts = PROFILE_FACT_KEYS.flatMap(key =>
        profile.facts.filter(fact => fact.key === key).map(fact => `${fact.label}: ${fact.value}`)
    );
    const parts = [
        profile.summary.trim() || null,
        profile.focusAreas.length > 0 ? `Focus areas: ${profile.focusAreas.join(", ")}` : null,
        ...facts,
    ];
    return parts.filter(Boolean).join("\n").slice(0, EMBEDDING_TEXT_LIMIT);
}

/**
 * A past company's industries and tags that the profile also names, so a match
 * explains itself with evidence rather than a bare similarity number.
 */
export function sharedTerms(company: PastCompany, profileText: string): string[] {
    const haystack = ` ${profileText.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    return [...new Set([...company.industries, ...company.tags])].filter(term => {
        const words = term
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        return words.length > 1 && haystack.includes(` ${words} `);
    });
}

/**
 * The application text between two anchors of a fetched page, excluding the
 * page's navigation and footer. Returns null when the start anchor is missing,
 * so a changed page fails loudly instead of storing the wrong text.
 */
export function extractApplicationWindow(
    pageText: string,
    anchors: { startAt: string; endBefore?: string }
): string | null {
    const start = pageText.indexOf(anchors.startAt);
    if (start < 0) return null;
    const end = anchors.endBefore ? pageText.indexOf(anchors.endBefore, start) : -1;
    return pageText.slice(start, end > start ? end : undefined).trim();
}

const QUESTION_OPENER =
    /^(what|why|how|who|whom|where|when|which|do|does|did|is|are|was|were|have|has|had|if|please|tell|describe|explain|list|anything|will|would|can|could|should|in what|of all)\b/i;
const INSTRUCTION_OPENER = /^(please|explain|describe|list|tell us)\b/i;

function promptShaped(line: string): boolean {
    return line.length >= 15 && line.length <= 400 && QUESTION_OPENER.test(line);
}

/**
 * A whole line that reads as an application prompt rather than an answer: a
 * question, a question followed by a bracketed note, an instruction, or a
 * conditional that asks ("If you have …, please tell us about it."). An answer
 * that merely opens with "If" is not a prompt.
 */
export function isQuestionLine(line: string): boolean {
    const trimmed = line.trim();
    if (!promptShaped(trimmed)) return false;
    if (trimmed.endsWith("?")) return true;
    if (/\?\s*\([^)]*\)$/.test(trimmed)) return true;
    if (!/[.)]$/.test(trimmed)) return false;
    return (
        INSTRUCTION_OPENER.test(trimmed) ||
        /^if you\b.*\b(tell us|list|describe|attach|explain)\b/i.test(trimmed)
    );
}

/**
 * Prompts shared by at least `minSources` windows. A shared line may be an
 * instruction ("Describe … in 50 characters or less.") rather than a question;
 * answers do not repeat verbatim across companies, so sharing marks a prompt.
 */
export function buildQuestionBank(windows: string[], minSources = 2): string[] {
    const counts = new Map<string, number>();
    for (const window of windows) {
        const seen = new Set(
            window
                .split("\n")
                .map(line => line.trim())
                .filter(line => promptShaped(line) && (line.includes("?") || line.endsWith(".")))
        );
        for (const question of seen) counts.set(question, (counts.get(question) ?? 0) + 1);
    }
    return [...counts]
        .filter(([, count]) => count >= minSources)
        .map(([question]) => question)
        .sort((left, right) => right.length - left.length);
}

const SECTION_HEADING =
    /^(company|company information|founders?|founder profile|category|progress|idea|equity|legal|others|curious|users)$/i;

/** The application text of a fetched page with the page's own labels removed. */
export function prepareApplicationText(
    pageText: string,
    extract: NonNullable<ApplicationSource["extract"]>
): string | null {
    const window = extractApplicationWindow(pageText, extract);
    if (window === null) return null;
    const drop = new Set(extract.dropLines ?? []);
    let text = window
        .split("\n")
        .filter(line => !drop.has(line.trim()))
        .join("\n");
    for (const label of extract.removeText ?? []) text = text.split(label).join(" ");
    return text;
}

/**
 * Split an application into prompts and answers. Prompts are this window's own
 * question lines plus any known prompt found inline (some copies run the whole
 * form together on one line). Prompts without an answer are dropped.
 */
export function segmentApplication(
    window: string,
    knownPrompts: readonly string[]
): ApplicationSection[] {
    const prompts = new Set(knownPrompts);
    for (const line of window.split("\n")) if (isQuestionLine(line)) prompts.add(line.trim());

    const hits: { start: number; end: number; question: string }[] = [];
    for (const question of [...prompts].sort((left, right) => right.length - left.length)) {
        let from = 0;
        for (;;) {
            const start = window.indexOf(question, from);
            if (start < 0) break;
            const end = start + question.length;
            if (!hits.some(hit => start < hit.end && end > hit.start))
                hits.push({ start, end, question });
            from = end;
        }
    }
    hits.sort((left, right) => left.start - right.start);

    const sections: ApplicationSection[] = [];
    hits.forEach((hit, index) => {
        const answer = window
            .slice(hit.end, hits[index + 1]?.start ?? window.length)
            .split("\n")
            .map(line => line.replace(/[ \t]+/g, " ").trim())
            .filter(line => !SECTION_HEADING.test(line))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/([^\n.!?:])\n(?=[a-z(])/g, "$1 ")
            .replace(/\s+(Company|Founders|Progress|Idea|Equity|Legal|Others|Curious)$/, "")
            .trim();
        if (answer) sections.push({ question: hit.question, answer });
    });
    return sections;
}
