/**
 * The company profile as the screen sees it — pure. Turns the profile row,
 * the per-source rows and the workspace's documents into the one DTO both
 * Settings › Company and Proposals › Profile render.
 */
import {
    BUILD_STUCK_MS,
    METADATA_SCHEMA_VERSION,
    READER_VERSION,
    isCounted,
    profileView,
    type CompanyProfileSourceRow,
    type ProfileDocument,
    type ProfileRow,
} from "@launchstack/pipelines/company-metadata";

import type {
    CompanyProfileDto,
    CompanyProfileStatus,
    DropWordKey,
    FactLabelKey,
    ProfileFailureKey,
    ProfileSourceDto,
    SourceReasonCopy,
} from "~/lib/company-profile/dto";

/** A build that has said "building" this long without finishing is treated as dead. */
export const STUCK_BUILD_MS = BUILD_STUCK_MS;

export function sourceHref(documentId: number): string {
    return `/employer/documents?source=d${documentId}`;
}

export interface ProfileDtoInput {
    row: ProfileRow | null;
    sources: CompanyProfileSourceRow[];
    documents: ProfileDocument[];
    name: string;
    canEdit: boolean;
    /** Whether the viewer may open a document; their profile leaves the rest out. */
    canSee: (doc: { id: number; folder: string }) => boolean;
    now: Date;
}

export function isBuilding(row: ProfileRow | null, now: Date): boolean {
    return (
        row?.buildStatus === "building" &&
        !!row.buildStartedAt &&
        now.getTime() - row.buildStartedAt.getTime() < STUCK_BUILD_MS
    );
}

function statusOf(row: ProfileRow | null, now: Date): CompanyProfileStatus {
    if (isBuilding(row, now)) return "building";
    if (row?.buildStatus === "failed") return "failed";
    if (!row?.builtAt) return "empty";
    return "ready";
}

// ---------------------------------------------------------------------------
// Words the screen says in the reader's language
//
// The company-metadata package writes English: the default fact labels, the
// reasons its rules give for setting a source aside, the fixed failure
// sentences. Each is recognised here by its exact English and sent beside it
// as a message key, which the screen words (`companyProfile.server.*`). The
// English stays for API readers; anything unrecognised — a label a person
// typed, a reason the model wrote — is shown as it came.
// ---------------------------------------------------------------------------

/** The view's default label for each known fact path. */
const FACT_LABEL_KEYS: Record<string, { english: string; key: FactLabelKey }> = {
    "company.name": { english: "Name", key: "company.name" },
    "company.description": { english: "What it does", key: "company.description" },
    "company.industry": { english: "Industry", key: "company.industry" },
    "company.founded_year": { english: "Founded", key: "company.foundedYear" },
    "company.headquarters": { english: "Headquarters", key: "company.headquarters" },
    "company.website": { english: "Website", key: "company.website" },
    "company.size": { english: "Team size", key: "company.size" },
    "profile.facts.mission": { english: "Mission", key: "profile.mission" },
    "profile.facts.programs": { english: "Programs", key: "profile.programs" },
    "profile.facts.beneficiaries": { english: "Who it serves", key: "profile.beneficiaries" },
    "profile.facts.outcomes": { english: "Outcomes", key: "profile.outcomes" },
    "profile.facts.need": { english: "Need addressed", key: "profile.need" },
    "profile.facts.legal_status": { english: "Legal status", key: "profile.legalStatus" },
    "profile.facts.annual_budget": { english: "Annual budget", key: "profile.annualBudget" },
    "profile.facts.funding_sources": { english: "Funding sources", key: "profile.fundingSources" },
    "profile.facts.funding_raised": { english: "Funding raised", key: "profile.fundingRaised" },
    "profile.facts.customers": { english: "Customers", key: "profile.customers" },
    "profile.facts.traction": { english: "Traction", key: "profile.traction" },
    "profile.facts.business_model": { english: "Business model", key: "profile.businessModel" },
    "profile.facts.pricing": { english: "Pricing", key: "profile.pricing" },
    "profile.facts.leadership": { english: "Leadership", key: "profile.leadership" },
    "profile.facts.board": { english: "Board", key: "profile.board" },
    "profile.facts.partners": { english: "Partners", key: "profile.partners" },
    "profile.facts.awards": { english: "Awards", key: "profile.awards" },
    "profile.facts.theory_of_change": {
        english: "Theory of change",
        key: "profile.theoryOfChange",
    },
    "profile.facts.evaluation": { english: "Evaluation", key: "profile.evaluation" },
    "profile.facts.plans": { english: "Plans", key: "profile.plans" },
    // Onboarding's own fact (`IDEA_PATH`, `IDEA_LABEL` in ./onboarding).
    "profile.facts.idea": { english: "The idea", key: "profile.idea" },
};

/** A fact's label as a message key — only while it is still the default for its path. */
export function factLabelKey(path: string, label: string): FactLabelKey | null {
    const known = FACT_LABEL_KEYS[path];
    return known && known.english === label ? known.key : null;
}

/** The reasons the rules (never the model) give, by their English. */
const RULE_REASONS: Record<string, Exclude<SourceReasonCopy["key"], "onlyNoise">> = {
    "No readable text in this file.": "noReadableText",
    "A mindmap with only a few words on it.": "sparseMindmap",
    "Too little text to say anything about the organisation.": "tooLittleText",
    "Written by or about the organisation.": "aboutUs",
    "Someone else's material, kept for reference.": "thirdParty",
    "Nothing to read.": "nothingToRead",
    "Still being processed — it is read as soon as it is.": "stillProcessing",
};

/** What triage calls each kind of dropped text in "Only … — nothing about …". */
const DROP_WORDS: Record<string, DropWordKey> = {
    "reference lists": "references",
    "number tables": "table",
    "chart residue": "figure",
    boilerplate: "boilerplate",
    "empty placeholders": "placeholder",
    fragments: "tooShort",
    "repeated text": "duplicate",
};

const ONLY_NOISE = /^Only (.+) — nothing about the organisation to read\.$/;

/** A source's reason as message data, when it is one the rules wrote. */
export function sourceReasonCopy(reason: string | null): SourceReasonCopy | null {
    if (!reason) return null;
    const fixed = RULE_REASONS[reason];
    if (fixed) return { key: fixed };
    const noise = ONLY_NOISE.exec(reason)?.[1];
    if (!noise) return null;
    const drops = noise.split(" and ").map(phrase => DROP_WORDS[phrase]);
    return drops.length <= 2 && drops.every(Boolean)
        ? { key: "onlyNoise", drops: drops as DropWordKey[] }
        : null;
}

const FAILURES: Record<string, ProfileFailureKey> = {
    "Reading it failed": "readingFailed",
    "Reading facts from this source failed": "readingFactsFailed",
    "The last build failed": "buildFailed",
};

function failureKey(error: string | null): ProfileFailureKey | null {
    return error ? (FAILURES[error] ?? null) : null;
}

export function toCompanyProfileDto(input: ProfileDtoInput): CompanyProfileDto {
    const visibleDocs = input.documents.filter(d => input.canSee(d));
    const visibleIds = new Set(visibleDocs.map(d => d.id));
    const view = profileView(input.row?.metadata ?? null, { canSee: id => visibleIds.has(id) });
    const byDocument = new Map(input.sources.map(s => [Number(s.documentId), s]));

    const sources: ProfileSourceDto[] = visibleDocs.map(doc => {
        const row = byDocument.get(doc.id) ?? null;
        const counted = row ? isCounted(row) : false;
        const reason = row?.reason ?? null;
        const error = row?.status === "failed" ? (row.error ?? "Reading it failed") : null;
        return {
            documentId: doc.id,
            title: doc.title,
            folder: doc.folder,
            role: row?.role ?? null,
            roleBy: row?.roleBy ?? null,
            reason,
            reasonCopy: sourceReasonCopy(reason),
            override: row?.override ?? null,
            counted,
            facts: counted ? (row?.factCount ?? 0) : 0,
            status: row?.status ?? "pending",
            error,
            errorKey: failureKey(error),
            href: sourceHref(doc.id),
        };
    });

    const status = statusOf(input.row, input.now);
    const metadata = input.row?.metadata ?? null;
    const stale =
        status === "ready" &&
        (metadata?.schema_version !== METADATA_SCHEMA_VERSION ||
            visibleDocs.some(doc => {
                const row = byDocument.get(doc.id);
                return (
                    !row ||
                    row.readerVersion !== READER_VERSION ||
                    (row.versionId === null ? null : Number(row.versionId)) !== doc.currentVersionId
                );
            }));

    const error = status === "failed" ? (input.row?.buildError ?? "The last build failed") : null;
    return {
        status,
        error,
        errorKey: failureKey(error),
        builtAt: input.row?.builtAt?.toISOString() ?? null,
        stale,
        name: input.name,
        summary: view.summary,
        summaryCites: view.summaryCites,
        applicantType: view.applicantType,
        focusAreas: view.focusAreas,
        geography: view.geography,
        markets: view.markets,
        facts: view.facts.map(f => ({
            path: f.path,
            label: f.label,
            labelKey: factLabelKey(f.path, f.label),
            value: f.value,
            cites: f.cites,
            source: f.source,
        })),
        people: view.people,
        services: view.services,
        projects: view.projects,
        legal: view.legal,
        evidence: view.evidence.map(e => ({
            ...e,
            href:
                e.documentId !== null && visibleIds.has(e.documentId)
                    ? sourceHref(e.documentId)
                    : null,
        })),
        sources,
        counts: {
            sources: sources.length,
            counted: sources.filter(s => s.counted).length,
            setAside: sources.filter(s => s.status === "done" && !s.counted).length,
            pending: sources.filter(s => s.status === "pending").length,
        },
        canEdit: input.canEdit,
    };
}
