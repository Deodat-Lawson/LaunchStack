/**
 * Reading the profile — pure.
 *
 * One read model for everything that shows or quotes the profile: the
 * profile page (Settings › Company and Proposals › Profile) and the
 * Proposals stages that write from it. Facts get their labels here, and the
 * excerpts they cite get numbers here, so a "[3]" means the same excerpt
 * wherever it appears.
 */
import { flattenFacts } from "./assemble";
import { PROFILE_FACT_LABELS } from "./extractor";
import type {
    ApplicantType,
    CompanyMetadataJSON,
    LabeledFact,
    MetadataFact,
    MetadataSource,
} from "./types";

/** Facts below this confidence are not shown or used — same bar as the company-context reader. */
export const MIN_VIEW_CONFIDENCE = 0.5;

const COMPANY_LABELS: Record<string, string> = {
    name: "Name",
    description: "What it does",
    industry: "Industry",
    founded_year: "Founded",
    headquarters: "Headquarters",
    website: "Website",
    size: "Team size",
};
const COMPANY_ORDER = Object.keys(COMPANY_LABELS);
const PROFILE_ORDER = Object.keys(PROFILE_FACT_LABELS);

export interface ViewEvidence {
    n: number;
    documentId: number | null;
    title: string;
    page: number | null;
    quote: string;
}

export interface ViewFact {
    path: string;
    /** The last path segment: "headquarters", "mission". */
    key: string;
    label: string;
    value: string;
    cites: number[];
    source: "documents" | "manual";
}

export interface ViewEntry {
    path: string;
    name: string;
    detail: string | null;
    detailPath: string | null;
    cites: number[];
    source: "documents" | "manual";
}

export interface ProfileView {
    summary: string | null;
    summaryCites: number[];
    applicantType: ApplicantType | null;
    focusAreas: string[];
    geography: string[];
    markets: string[];
    facts: ViewFact[];
    people: ViewEntry[];
    services: ViewEntry[];
    projects: ViewEntry[];
    /** Agreements the organisation is party to. */
    legal: ViewEntry[];
    evidence: ViewEvidence[];
    /** Documents the shown facts rest on. */
    documents: number;
}

export interface ProfileViewOptions {
    /** False for a document the viewer may not open: its facts and excerpts are left out. */
    canSee?: (documentId: number) => boolean;
}

const usable = (fact: MetadataFact<unknown> | undefined): fact is MetadataFact<unknown> =>
    !!fact &&
    fact.status === "active" &&
    (fact.priority === "manual_override" || fact.confidence >= MIN_VIEW_CONFIDENCE) &&
    textOf(fact.value) !== "";

/** A fact's value as text; values are strings or numbers, anything else reads as empty. */
function textOf(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

const docSources = (fact: MetadataFact<unknown>): MetadataSource[] =>
    fact.sources.filter(s => s.doc_id > 0);

/** "profile.facts.annual_budget" → "Annual budget"; custom keys use their stored label. */
export function labelFor(path: string, fact?: MetadataFact<unknown>): string {
    const [section, a, b] = path.split(".");
    if (section === "company" && a) return COMPANY_LABELS[a] ?? humanise(a);
    if (section === "profile" && a === "facts" && b)
        return (
            (fact as LabeledFact | undefined)?.label ??
            PROFILE_FACT_LABELS[b as keyof typeof PROFILE_FACT_LABELS] ??
            humanise(b)
        );
    if (section === "policies" && a) return humanise(a);
    return humanise(path.split(".").pop() ?? path);
}

function humanise(key: string): string {
    const words = key.replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The profile as people read it. `null` metadata reads as an empty profile. */
export function profileView(
    metadata: CompanyMetadataJSON | null,
    options: ProfileViewOptions = {}
): ProfileView {
    const canSee = options.canSee ?? (() => true);
    const evidence: ViewEvidence[] = [];
    const evidenceKey = new Map<string, number>();
    const documents = new Set<number>();

    /**
     * The fact if the viewer may see it, with the excerpt numbers it cites.
     * `whole`: shown only when every source is visible — for what was
     * written from several facts (summary, applicant type, focus areas),
     * whose wording can carry what a hidden source said.
     */
    const read = (
        fact: MetadataFact<unknown> | undefined,
        whole = false
    ): { fact: MetadataFact<unknown>; cites: number[] } | null => {
        if (!usable(fact)) return null;
        const sources = docSources(fact);
        const visible = sources.filter(s => canSee(s.doc_id));
        // A document fact whose every source is hidden from this viewer is hidden too.
        if (whole && visible.length < sources.length) return null;
        if (fact.priority !== "manual_override" && sources.length > 0 && visible.length === 0)
            return null;
        const cites: number[] = [];
        for (const source of visible) {
            documents.add(source.doc_id);
            if (!source.quote) continue;
            const key = `${source.doc_id}|${source.page ?? ""}|${source.quote}`;
            let n = evidenceKey.get(key);
            if (n === undefined) {
                n = evidence.length + 1;
                evidenceKey.set(key, n);
                evidence.push({
                    n,
                    documentId: source.doc_id,
                    title: source.doc_name,
                    page: source.page ?? null,
                    quote: source.quote,
                });
            }
            if (!cites.includes(n)) cites.push(n);
        }
        return { fact, cites };
    };

    const sourceOf = (fact: MetadataFact<unknown>): "documents" | "manual" =>
        fact.priority === "manual_override" ? "manual" : "documents";

    if (!metadata)
        return {
            summary: null,
            summaryCites: [],
            applicantType: null,
            focusAreas: [],
            geography: [],
            markets: [],
            facts: [],
            people: [],
            services: [],
            projects: [],
            legal: [],
            evidence: [],
            documents: 0,
        };

    // Facts first, so the excerpt numbers follow reading order down the page.
    const facts: ViewFact[] = [];
    const company = Object.entries(metadata.company ?? {}).sort(
        ([a], [b]) => rank(COMPANY_ORDER, a) - rank(COMPANY_ORDER, b)
    );
    for (const [key, raw] of company) {
        const got = read(raw);
        if (!got) continue;
        facts.push({
            path: `company.${key}`,
            key,
            label: labelFor(`company.${key}`),
            value: String(got.fact.value),
            cites: got.cites,
            source: sourceOf(got.fact),
        });
    }
    const profileFacts = Object.entries(metadata.profile?.facts ?? {}).sort(
        ([a], [b]) => rank(PROFILE_ORDER, a) - rank(PROFILE_ORDER, b)
    );
    for (const [key, raw] of profileFacts) {
        const got = read(raw);
        if (!got) continue;
        facts.push({
            path: `profile.facts.${key}`,
            key,
            label: labelFor(`profile.facts.${key}`, raw),
            value: String(got.fact.value),
            cites: got.cites,
            source: sourceOf(got.fact),
        });
    }
    for (const [key, raw] of Object.entries(metadata.policies ?? {})) {
        const got = read(raw);
        if (!got) continue;
        facts.push({
            path: `policies.${key}`,
            key,
            label: key,
            value: String(got.fact.value),
            cites: got.cites,
            source: sourceOf(got.fact),
        });
    }

    const entries = (
        section: "people" | "services" | "projects" | "legal",
        detailField: "role" | "description" | "summary"
    ): ViewEntry[] => {
        const out: ViewEntry[] = [];
        (metadata[section] ?? []).forEach((entry, i) => {
            const name = read(entry.name);
            if (!name) return;
            const detailFact = entry[detailField] as MetadataFact<unknown> | undefined;
            const detail = read(detailFact);
            out.push({
                path: `${section}.${i}`,
                name: String(name.fact.value),
                detail: detail ? String(detail.fact.value) : null,
                detailPath: `${section}.${i}.${detailField}`,
                cites: [...new Set([...name.cites, ...(detail?.cites ?? [])])],
                source:
                    name.fact.priority === "manual_override" ||
                    detail?.fact.priority === "manual_override"
                        ? "manual"
                        : "documents",
            });
        });
        return out;
    };
    const people = entries("people", "role");
    const services = entries("services", "description");
    const projects = entries("projects", "description");
    const legal = entries("legal", "summary");

    const values = (list: MetadataFact[] | undefined, whole = false): string[] => [
        ...new Set(
            (list ?? [])
                .map(f => read(f, whole))
                .filter(Boolean)
                .map(g => String(g!.fact.value))
        ),
    ];
    const geography = values(metadata.markets?.geographies);
    const markets = [
        ...new Set([...values(metadata.markets?.primary), ...values(metadata.markets?.verticals)]),
    ];

    // The summary cites the excerpts of the facts it rests on, so it reads last.
    const summary = read(metadata.profile?.summary, true);
    const applicant = read(metadata.profile?.applicant_type, true);
    const focusAreas = values(metadata.profile?.focus_areas, true);

    return {
        summary: summary ? String(summary.fact.value) : null,
        summaryCites: summary?.cites ?? [],
        applicantType: applicant ? (String(applicant.fact.value) as ApplicantType) : null,
        focusAreas,
        geography,
        markets,
        facts,
        people,
        services,
        projects,
        legal,
        evidence,
        documents: documents.size,
    };
}

function rank(order: string[], key: string): number {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
}

/** Active facts as a numbered list for a prompt: "[F3] Headquarters: Baltimore, MD". */
export function numberedFacts(
    metadata: CompanyMetadataJSON
): Array<{ id: number; path: string; label: string; value: string; fact: MetadataFact<unknown> }> {
    return flattenFacts(metadata)
        .filter(f => usable(f.fact) && !f.path.startsWith("profile.summary"))
        .map((f, i) => ({
            id: i + 1,
            path: f.path,
            label: labelFor(f.path, f.fact),
            value: String(f.fact.value),
            fact: f.fact,
        }));
}
