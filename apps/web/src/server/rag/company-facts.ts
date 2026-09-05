/**
 * Company facts — the pure half of the company-facts retrieval leg (ADR-010).
 *
 * The company-metadata projection (people, services, projects, legal,
 * policies — each a MetadataFact with confidence, status and cited sources)
 * is already a typed, provenance-carrying graph of the company. This module
 * flattens it into retrievable rows and scores them against a question; the
 * retriever in ./company-facts-retriever.ts does the one DB read.
 *
 * Scoring is lexical on purpose. The projection is one JSON row with at most
 * a few hundred facts, so an embedding round-trip per query buys nothing,
 * and the questions this leg exists for name their subject ("who is our
 * contact at Acme", "when does the lease expire"). The reranker downstream
 * still orders facts against chunks by a real model score.
 */

import type {
    CompanyMetadataJSON,
    MetadataFact,
    MetadataSource,
} from "@launchstack/tools/company-context/schema";
import { readFact } from "@launchstack/tools/company-context/facts";

export type FactSection =
    | "company"
    | "people"
    | "services"
    | "markets"
    | "projects"
    | "policies"
    | "legal";

export interface CompanyFactRow {
    /** Stable path into the projection, e.g. "people[2]" or "policies.refund". */
    path: string;
    section: FactSection;
    /** What the entry is about: a person's name, a service, a policy key. */
    subject: string;
    /** Field/value pairs that passed the confidence gate, in schema order. */
    details: Array<{ field: string; value: string }>;
    /** Highest confidence among the entry's surviving facts. */
    confidence: number;
    /** Most recent last_updated among them (ISO string). */
    lastUpdated: string;
    /** Every document the entry's surviving facts cite (doc_id > 0). */
    sourceDocumentIds: number[];
    /** The citation target: the subject's first document-backed source, else any. */
    source?: MetadataSource;
}

export interface RankedCompanyFact {
    row: CompanyFactRow;
    score: number;
}

const SECTION_LABEL: Record<FactSection, string> = {
    company: "Company",
    people: "Person",
    services: "Service",
    markets: "Markets",
    projects: "Project",
    policies: "Policy",
    legal: "Legal",
};

// ============================================================================
// Flatten
// ============================================================================

type AnyFact = MetadataFact<unknown> | undefined;

function stringify(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join(", ");
    return JSON.stringify(value);
}

/** Gate a fact and stringify its value; undefined when it does not survive. */
function usable(fact: AnyFact): { text: string; fact: MetadataFact<unknown> } | undefined {
    const value = readFact(fact);
    if (value === undefined) return undefined;
    const text = stringify(value);
    if (!text) return undefined;
    return { text, fact: fact! };
}

function documentSource(fact: MetadataFact<unknown> | undefined): MetadataSource | undefined {
    return fact?.sources.find(s => typeof s.doc_id === "number" && s.doc_id > 0);
}

function humanize(key: string): string {
    return key.replace(/[_-]+/g, " ").trim();
}

interface EntryBuild {
    path: string;
    section: FactSection;
    subjectFact?: AnyFact;
    subjectFallback: string;
    fields: Array<[field: string, fact: AnyFact]>;
}

function buildRow(entry: EntryBuild): CompanyFactRow | undefined {
    const subject = usable(entry.subjectFact);
    const details: CompanyFactRow["details"] = [];
    const surviving: MetadataFact<unknown>[] = [];
    if (subject) surviving.push(subject.fact);

    for (const [field, fact] of entry.fields) {
        const hit = usable(fact);
        if (!hit) continue;
        details.push({ field: humanize(field), value: hit.text });
        surviving.push(hit.fact);
    }

    // A subject with nothing to say, or details with no subject at all,
    // gives the model nothing to cite.
    if (surviving.length === 0) return undefined;
    if (!subject && details.length === 0) return undefined;

    const sourceDocumentIds = [
        ...new Set(surviving.flatMap(f => f.sources.map(s => s.doc_id).filter(id => id > 0))),
    ];
    const source = documentSource(subject?.fact) ?? surviving.map(documentSource).find(Boolean);

    return {
        path: entry.path,
        section: entry.section,
        subject: subject?.text ?? entry.subjectFallback,
        details,
        confidence: Math.max(...surviving.map(f => f.confidence)),
        lastUpdated:
            surviving
                .map(f => f.last_updated)
                .sort()
                .at(-1) ?? "",
        sourceDocumentIds,
        source,
    };
}

/** Everything in an entry except the named keys, as extra fields. */
function extraFields(entry: Record<string, unknown>, known: string[]): Array<[string, AnyFact]> {
    return Object.entries(entry)
        .filter(([key, value]) => !known.includes(key) && isFact(value))
        .map(([key, value]) => [key, value as MetadataFact<unknown>]);
}

function isFact(value: unknown): value is MetadataFact<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        "value" in value &&
        "confidence" in value &&
        "status" in value
    );
}

/**
 * Flatten the projection into one row per entry. Deprecated, superseded and
 * low-confidence facts are dropped here, so a row is always citeable as-is.
 */
export function flattenCompanyFacts(metadata: CompanyMetadataJSON): CompanyFactRow[] {
    const rows: Array<CompanyFactRow | undefined> = [];

    const company = metadata.company ?? {};
    rows.push(
        buildRow({
            path: "company",
            section: "company",
            subjectFact: company.name,
            subjectFallback: "The company",
            fields: [
                ["industry", company.industry],
                ["description", company.description],
                ["headquarters", company.headquarters],
                ["founded_year", company.founded_year],
                ["size", company.size],
                ["website", company.website],
                ...extraFields(company, [
                    "name",
                    "industry",
                    "description",
                    "headquarters",
                    "founded_year",
                    "size",
                    "website",
                ]),
            ],
        })
    );

    (metadata.people ?? []).forEach((person, i) =>
        rows.push(
            buildRow({
                path: `people[${i}]`,
                section: "people",
                subjectFact: person.name,
                subjectFallback: "",
                fields: [
                    ["role", person.role],
                    ["department", person.department],
                    ["email", person.email],
                    ["phone", person.phone],
                    ...extraFields(person, ["name", "role", "department", "email", "phone"]),
                ],
            })
        )
    );

    (metadata.services ?? []).forEach((service, i) =>
        rows.push(
            buildRow({
                path: `services[${i}]`,
                section: "services",
                subjectFact: service.name,
                subjectFallback: "",
                fields: [
                    ["description", service.description],
                    ["status", service.status],
                    ...extraFields(service, ["name", "description", "status"]),
                ],
            })
        )
    );

    const markets = metadata.markets ?? {};
    rows.push(
        buildRow({
            path: "markets",
            section: "markets",
            subjectFallback: "Markets",
            fields: (["primary", "verticals", "geographies"] as const).map(key => [
                key,
                listFact(markets[key]),
            ]),
        })
    );

    (metadata.projects ?? []).forEach((project, i) =>
        rows.push(
            buildRow({
                path: `projects[${i}]`,
                section: "projects",
                subjectFact: project.name,
                subjectFallback: "",
                fields: [
                    ["description", project.description],
                    ["status", project.status],
                    ["subprojects", listFact((project.subprojects ?? []).map(s => s.name))],
                ],
            })
        )
    );

    Object.entries(metadata.policies ?? {}).forEach(([key, fact]) =>
        rows.push(
            buildRow({
                path: `policies.${key}`,
                section: "policies",
                subjectFallback: humanize(key),
                fields: [[key, fact]],
            })
        )
    );

    (metadata.legal ?? []).forEach((legal, i) =>
        rows.push(
            buildRow({
                path: `legal[${i}]`,
                section: "legal",
                subjectFact: legal.name,
                subjectFallback: "",
                fields: [
                    ["type", legal.type],
                    ["summary", legal.summary],
                    ["parties", legal.parties],
                    ["effective_date", legal.effective_date],
                    ["expiry_date", legal.expiry_date],
                    ["status", legal.status],
                    ...extraFields(legal, [
                        "name",
                        "type",
                        "summary",
                        "parties",
                        "effective_date",
                        "expiry_date",
                        "status",
                    ]),
                ],
            })
        )
    );

    return rows.filter((r): r is CompanyFactRow => r !== undefined && r.subject !== "");
}

/**
 * Fold a list of facts into one synthetic fact so a list field ("primary
 * markets") passes through the same gate and carries the union of sources.
 */
function listFact(facts: Array<MetadataFact<unknown>> | undefined): AnyFact {
    const kept = (facts ?? []).filter(f => readFact(f) !== undefined);
    if (kept.length === 0) return undefined;
    return {
        value: kept.map(f => stringify(f.value)).filter(Boolean),
        visibility: kept[0]!.visibility,
        usage: kept[0]!.usage,
        confidence: Math.max(...kept.map(f => f.confidence)),
        priority: kept[0]!.priority,
        status: "active",
        last_updated:
            kept
                .map(f => f.last_updated)
                .sort()
                .at(-1) ?? "",
        sources: kept.flatMap(f => f.sources),
    };
}

// ============================================================================
// Scope
// ============================================================================

/** Rows whose surviving facts cite at least one of the given documents. */
export function rowsCitingDocuments(
    rows: CompanyFactRow[],
    documentIds: number[]
): CompanyFactRow[] {
    const wanted = new Set(documentIds);
    return rows.filter(row => row.sourceDocumentIds.some(id => wanted.has(id)));
}

// ============================================================================
// Rank
// ============================================================================

const STOPWORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "did",
    "do",
    "does",
    "for",
    "from",
    "has",
    "have",
    "how",
    "i",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "s",
    "tell",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "to",
    "us",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "why",
    "will",
    "with",
    "you",
    "your",
]);

function stem(token: string): string {
    // Enough to let "contracts" find "contract" and "policies" find "policy".
    if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
    if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
    if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
    return token;
}

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9@.]+/)
        .map(t => t.replace(/^[.@]+|[.@]+$/g, ""))
        .filter(t => t.length >= 2 && !STOPWORDS.has(t))
        .map(stem);
}

function rowText(row: CompanyFactRow): string {
    return [row.subject, ...row.details.flatMap(d => [d.field, d.value])].join(" ");
}

/**
 * Score rows against a question. One point per distinct question token found
 * in the row, plus a point when the row's subject appears whole in the
 * question — the signal that separates "Jane Doe" from a row that merely
 * mentions a Doe. Ties break on confidence, then recency.
 */
export function rankCompanyFacts(
    query: string,
    rows: CompanyFactRow[],
    topK: number
): RankedCompanyFact[] {
    const queryTokens = [...new Set(tokenize(query))];
    if (queryTokens.length === 0 || topK <= 0) return [];
    const queryLower = query.toLowerCase();

    const ranked: RankedCompanyFact[] = [];
    for (const row of rows) {
        const rowTokens = new Set(tokenize(rowText(row)));
        let score = 0;
        for (const token of queryTokens) if (rowTokens.has(token)) score += 1;
        const subject = row.subject.toLowerCase();
        if (subject.length >= 3 && queryLower.includes(subject)) score += 1;
        if (score > 0) ranked.push({ row, score });
    }

    ranked.sort(
        (a, b) =>
            b.score - a.score ||
            b.row.confidence - a.row.confidence ||
            b.row.lastUpdated.localeCompare(a.row.lastUpdated)
    );
    return ranked.slice(0, topK);
}

// ============================================================================
// Render
// ============================================================================

/**
 * The text the model reads and the snippet the citation shows. Says what
 * kind of thing the fact is, states it, and names where it came from.
 */
export function formatCompanyFact(row: CompanyFactRow): string {
    const details = row.details.map(d => `${d.field}: ${d.value}`).join("; ");
    const statement = details ? `${row.subject}. ${details}.` : `${row.subject}.`;
    const parts = [`${SECTION_LABEL[row.section]} — ${statement}`];

    if (row.source) {
        const where = row.source.page
            ? `${row.source.doc_name}, p. ${row.source.page}`
            : row.source.doc_name;
        const quote = row.source.quote ? ` — "${row.source.quote}"` : "";
        parts.push(`Source: ${where}${quote}.`);
    }

    const updated = row.lastUpdated ? `, updated ${row.lastUpdated.slice(0, 10)}` : "";
    parts.push(`Confidence ${row.confidence.toFixed(2)}${updated}.`);
    return parts.join(" ");
}
