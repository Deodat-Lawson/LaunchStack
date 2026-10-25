/** Pure, opt-in projection of the canonical company profile. No I/O or model calls. */
import { createHash } from "node:crypto";
import type {
    CompanyMetadataJSON,
    CompanyProfileSourceRow,
    MetadataFact,
} from "@launchstack/tools/company-context/schema";
import { flattenFacts } from "../../company-metadata/assemble";
import { labelFor, MIN_VIEW_CONFIDENCE } from "../../company-metadata/views";
import { READER_VERSION } from "../../company-metadata/prompts";
import { METADATA_SCHEMA_VERSION } from "../../company-metadata/types";
import type {
    CompanyArchitectureRefV0,
    ContextBudgetsV0,
    ContextReportWindowV0,
    ContextScopeV0,
    RequiredCompanyArchitectureSourceV0,
} from "../proposals/context-v0";
import type { TrustedContextSourceV0 } from "./contracts";

export const COMPANY_ARCHITECTURE_ADAPTER_VERSION = "company-profile-adapter/v0.1";
/** Bounds projection work, including facts excluded by the declared ontology. */
export const MAX_COMPANY_ARCHITECTURE_FACTS = 512;

/** The host supplies fresh actor authorization, never company-only document ownership. */
export interface CompanyArchitectureDocumentStateV0 {
    id: string;
    companyId: string;
    access: "allowed" | "revoked" | "missing";
    currentVersionId: string | null;
    versionCreatedAt: string | null;
    contentFingerprint: string;
    updatedAt: string | null;
}

export interface CompanyArchitectureProfileSnapshotV0 {
    id: string;
    companyId: string;
    metadata: CompanyMetadataJSON;
    schemaVersion: string;
    createdAt: string;
    updatedAt: string | null;
    builtAt: string | null;
    buildStatus: "idle" | "building" | "failed";
}

export interface CompanyArchitectureReadSnapshotV0 {
    actor: ContextScopeV0;
    reportWindow: ContextReportWindowV0;
    checkedAt: string;
    profile: CompanyArchitectureProfileSnapshotV0 | null;
    sourceRows: readonly CompanyProfileSourceRow[];
    documents: readonly CompanyArchitectureDocumentStateV0[];
}

export interface CompanyArchitectureProjectionOptionsV0 {
    budgets: ContextBudgetsV0;
    /** Additional exact paths; name plus one substantive authorized fact always remain required. */
    requiredFactPaths?: readonly string[];
}

export interface CompanyArchitectureUnknownV0 {
    code: string;
    count?: number;
}

export interface CompanyArchitectureProjectionResultV0 {
    status: "available" | "partial" | "blocked";
    requiredEntry?: RequiredCompanyArchitectureSourceV0;
    record?: TrustedContextSourceV0;
    unknowns: CompanyArchitectureUnknownV0[];
    includedFactPaths: string[];
    omittedFactCount: number;
    canonicalFingerprint: string;
    projectionFingerprint: string;
    accessFingerprint: string;
}

export class CompanyArchitectureProjectionErrorV0 extends Error {
    constructor(readonly code: "invalid_document_id" | "document_limit") {
        super(
            code === "document_limit"
                ? "Company profile dependency limit exceeded."
                : "Company profile contains an invalid document identity."
        );
        this.name = "CompanyArchitectureProjectionErrorV0";
    }
}

/** All raw fact references, including derived/quote-less dependencies; no silent clipping. */
export function collectCompanyArchitectureDocumentIds(
    metadata: CompanyMetadataJSON | null,
    maxDocuments: number
): string[] {
    if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 0)
        throw new CompanyArchitectureProjectionErrorV0("document_limit");
    const ids = new Set<string>();
    const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (key === "sources") {
                if (!Array.isArray(child))
                    throw new CompanyArchitectureProjectionErrorV0("invalid_document_id");
                for (const source of child as unknown[]) {
                    const id =
                        source && typeof source === "object" && "doc_id" in source
                            ? source.doc_id
                            : undefined;
                    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0)
                        throw new CompanyArchitectureProjectionErrorV0("invalid_document_id");
                    if (id > 0) ids.add(String(id));
                    if (ids.size > maxDocuments)
                        throw new CompanyArchitectureProjectionErrorV0("document_limit");
                }
            } else visit(child);
        }
    };
    visit(metadata);
    return [...ids].sort((a, b) => Number(a) - Number(b));
}

function canonical(value: unknown, key = ""): string {
    if (value === undefined || value === null) return "null";
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) {
        const parts = value.map(child => canonical(child));
        return `[${key === "sources" ? parts.sort().join(",") : parts.join(",")}]`;
    }
    if (typeof value === "object")
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([field, child]) => `${JSON.stringify(field)}:${canonical(child, field)}`)
            .join(",")}}`;
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("invalid_snapshot");
    return JSON.stringify(value);
}
const hash = (value: unknown) =>
    createHash("sha256").update(canonical(value), "utf8").digest("hex");
const contentHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function timestamp(value: unknown): number | null {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    )
        return null;
    const year = Number(value.slice(0, 4)),
        month = Number(value.slice(5, 7)),
        day = Number(value.slice(8, 10));
    const dayDate = new Date(Date.UTC(year, month - 1, day));
    if (dayDate.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
    const time = Date.parse(value);
    if (
        !Number.isFinite(time) ||
        (value.length > 10 &&
            (Number(value.slice(11, 13)) > 23 ||
                Number(value.slice(14, 16)) > 59 ||
                Number(value.slice(17, 19)) > 59))
    )
        return null;
    return time;
}
const before = (value: unknown, cutoff: number) => {
    const parsed = timestamp(value);
    return parsed !== null && parsed <= cutoff;
};
const textValue = (fact: MetadataFact<unknown>) =>
    typeof fact.value === "string" || typeof fact.value === "number"
        ? String(fact.value).trim()
        : "";

function factsOf(metadata: CompanyMetadataJSON) {
    const facts = flattenFacts(metadata);
    for (const field of ["summary", "applicant_type"] as const) {
        const fact = metadata.profile?.[field];
        if (fact) facts.push({ path: `profile.${field}`, fact });
    }
    for (const [index, fact] of (metadata.profile?.focus_areas ?? []).entries())
        facts.push({ path: `profile.focus_areas.${index}`, fact });
    return facts;
}
function inOntology(path: string) {
    return (
        /^company\.(name|description|industry|founded_year|headquarters|website|size)$/.test(
            path
        ) ||
        /^people\.\d+\.(name|role|department|responsibilities)$/.test(path) ||
        /^(services|projects)\.\d+\.(name|description|status)$/.test(path) ||
        /^projects\.\d+\.subprojects\.\d+\.(name|description|status)$/.test(path) ||
        /^markets\.(primary|verticals|geographies)\.\d+$/.test(path) ||
        /^policies\.[a-z0-9_]{1,64}$/.test(path) ||
        /^profile\.facts\.[a-z0-9_]{1,64}$/.test(path) ||
        /^profile\.(summary|applicant_type|focus_areas\.\d+)$/.test(path) ||
        /^legal\.\d+\.(name|type|summary|effective_date|expiry_date|parties|status)$/.test(path)
    );
}
function namePaths(path: string): string[] {
    const parts = path.split(".");
    if (!["people", "services", "projects", "legal"].includes(parts[0]!)) return [];
    const names = [`${parts[0]}.${parts[1]}.name`];
    if (parts[2] === "subprojects") names.push(`projects.${parts[1]}.subprojects.${parts[3]}.name`);
    return names.filter(name => name !== path);
}

interface ProjectedFact {
    path: string;
    label: string;
    value: string;
    subject?: string;
    basis:
        | "human-entered-unreviewed"
        | "source-extracted-unreviewed"
        | "model-synthesis-unreviewed";
    sources: Array<{
        documentId: string;
        versionId: string | null;
        quote: string | null;
        snippetRef: string | null;
        page: number | null;
        extractedAt: string;
    }>;
}

/** Availability describes a safe projection, never human approval or a complete required bundle. */
export function projectCompanyArchitectureV0(
    snapshot: CompanyArchitectureReadSnapshotV0,
    options: CompanyArchitectureProjectionOptionsV0
): CompanyArchitectureProjectionResultV0 {
    const unknowns: CompanyArchitectureUnknownV0[] = [];
    const result: CompanyArchitectureProjectionResultV0 = {
        status: "blocked",
        unknowns,
        includedFactPaths: [],
        omittedFactCount: 0,
        canonicalFingerprint: "",
        projectionFingerprint: "",
        accessFingerprint: "",
    };
    const note = (code: string, count?: number) => {
        unknowns.push({ code, ...(count === undefined ? {} : { count }) });
    };
    const blocked = (code: string) => {
        note(code);
        return result;
    };
    try {
        const { actor, profile, reportWindow, checkedAt } = snapshot;
        const cutoff = timestamp(reportWindow.asOf),
            start = timestamp(reportWindow.startInclusive),
            end = timestamp(reportWindow.endExclusive);
        if (
            !actor?.principalRef ||
            !actor.companyId ||
            !actor.aclDigest ||
            actor.audience?.kind !== "actor" ||
            actor.audience.principalRef !== actor.principalRef
        )
            return blocked("invalid_actor_scope");
        if (
            cutoff === null ||
            start === null ||
            end === null ||
            start >= end ||
            timestamp(checkedAt) === null
        )
            return blocked("invalid_reporting_window");
        const budgets = options.budgets;
        if (
            !budgets ||
            [
                budgets.maxSources,
                budgets.maxExcerptChars,
                budgets.maxTokens,
                budgets.timeoutMs,
            ].some(value => !Number.isSafeInteger(value) || value < 1) ||
            !Number.isSafeInteger(budgets.maxQueries) ||
            budgets.maxQueries < 0
        )
            return blocked("invalid_budget");
        if (options.requiredFactPaths?.some(path => typeof path !== "string" || !path))
            return blocked("invalid_required_fields");
        if (!profile) return blocked("profile_missing");
        const metadata = profile.metadata;
        if (
            !profile.id ||
            profile.companyId !== actor.companyId ||
            metadata?.company_id !== actor.companyId ||
            profile.schemaVersion !== metadata.schema_version ||
            metadata.schema_version !== METADATA_SCHEMA_VERSION ||
            !metadata.provenance
        )
            return blocked("invalid_profile_identity");
        if (profile.buildStatus === "building") return blocked("profile_building");
        if (profile.buildStatus === "failed") return blocked("profile_failed");
        if (profile.buildStatus !== "idle") return blocked("invalid_profile_state");
        if (!profile.builtAt) return blocked("profile_not_built");
        if (
            ![
                profile.createdAt,
                profile.builtAt,
                metadata.updated_at,
                ...(profile.updatedAt ? [profile.updatedAt] : []),
            ].every(value => before(value, cutoff))
        )
            return blocked("profile_after_cutoff_or_invalid");
        const all = factsOf(metadata);
        if (all.length > MAX_COMPANY_ARCHITECTURE_FACTS) return blocked("profile_fact_limit");
        // The host applies an explicit native dependency limit before reading; here scan
        // all raw identities without clipping or conflating them with selected maxSources.
        collectCompanyArchitectureDocumentIds(metadata, Number.MAX_SAFE_INTEGER);
        if (
            snapshot.sourceRows.some(row => String(row.companyId) !== actor.companyId) ||
            snapshot.documents.some(doc => doc.companyId !== actor.companyId)
        )
            return blocked("cross_company_dependency");
        const rows = new Map<string, CompanyProfileSourceRow>();
        for (const row of snapshot.sourceRows) {
            const id = String(row.documentId);
            if (rows.has(id) && canonical(rows.get(id)) !== canonical(row))
                return blocked("conflicting_dependency_state");
            rows.set(id, row);
        }
        const documents = new Map<string, CompanyArchitectureDocumentStateV0>();
        for (const doc of snapshot.documents) {
            if (documents.has(doc.id) && canonical(documents.get(doc.id)) !== canonical(doc))
                return blocked("conflicting_dependency_state");
            documents.set(doc.id, doc);
        }
        const documentContentState = [...documents.values()]
            .map(({ access: _access, ...doc }) => doc)
            .sort((a, b) => a.id.localeCompare(b.id));
        result.canonicalFingerprint = hash({
            adapter: COMPANY_ARCHITECTURE_ADAPTER_VERSION,
            profile,
            sourceRows: [...rows.values()].sort((a, b) =>
                String(a.documentId).localeCompare(String(b.documentId))
            ),
            documents: documentContentState,
        });
        result.accessFingerprint = hash({
            actor,
            documents: [...documents.values()]
                .map(doc => ({ id: doc.id, companyId: doc.companyId, access: doc.access }))
                .sort((a, b) => a.id.localeCompare(b.id)),
        });
        const byPath = new Map(all.map(flat => [flat.path, flat.fact]));
        const available = new Map<string, boolean>();
        const usable = (fact: MetadataFact<unknown> | undefined): boolean =>
            !!fact &&
            fact.status === "active" &&
            (fact.priority === "manual_override" ||
                (Number.isFinite(fact.confidence) && fact.confidence >= MIN_VIEW_CONFIDENCE)) &&
            !!textValue(fact);
        const safeFact = (fact: MetadataFact<unknown> | undefined): boolean => {
            if (!usable(fact)) return false;
            const value = fact!;
            if (
                !before(value.last_updated, cutoff) ||
                !Array.isArray(value.sources) ||
                (value.valid_from && !before(value.valid_from, cutoff)) ||
                (value.valid_to &&
                    (timestamp(value.valid_to) === null ||
                        (value.valid_to.length === 10
                            ? value.valid_to < reportWindow.asOf.slice(0, 10)
                            : timestamp(value.valid_to)! < cutoff)))
            )
                return false;
            if (value.sources.length === 0) return false;
            let positive = false;
            for (const source of value.sources) {
                if (!before(source.extracted_at, cutoff)) return false;
                if (source.doc_id === 0) {
                    if (value.priority !== "manual_override") return false;
                    continue;
                }
                positive = true;
                if (
                    !Number.isSafeInteger(source.doc_id) ||
                    source.doc_id < 1 ||
                    !Number.isSafeInteger(source.version_id) ||
                    source.version_id! < 1
                )
                    return false;
                const id = String(source.doc_id),
                    doc = documents.get(id),
                    row = rows.get(id);
                if (
                    !doc ||
                    doc.access !== "allowed" ||
                    !doc.currentVersionId ||
                    doc.currentVersionId !== String(source.version_id) ||
                    !doc.contentFingerprint ||
                    !before(doc.versionCreatedAt, cutoff) ||
                    (doc.updatedAt && !before(doc.updatedAt, cutoff))
                )
                    return false;
                if (
                    !row ||
                    row.status !== "done" ||
                    !!row.error?.trim() ||
                    !row.readAt ||
                    !row.passages ||
                    !Number.isSafeInteger(row.passages.total) ||
                    row.passages.total < 0 ||
                    row.readerVersion !== READER_VERSION ||
                    String(row.versionId) !== doc.currentVersionId ||
                    row.facts === null ||
                    (row.override ? row.override !== "about_us" : row.role !== "about_us")
                )
                    return false;
                // A new extraction/override after assembly cannot certify the old profile.
                if (
                    ![row.createdAt, row.readAt, row.updatedAt]
                        .filter(value => value !== null)
                        .every(value =>
                            before(
                                value instanceof Date ? value.toISOString() : value,
                                timestamp(profile.builtAt)!
                            )
                        )
                )
                    return false;
            }
            return positive || value.priority === "manual_override";
        };
        const isAvailable = (path: string): boolean => {
            if (available.has(path)) return available.get(path)!;
            const okay =
                safeFact(byPath.get(path)) &&
                namePaths(path).every(name => safeFact(byPath.get(name)));
            available.set(path, okay);
            return okay;
        };
        const candidates = all.filter(flat => inOntology(flat.path) && usable(flat.fact));
        const excluded = all.filter(flat => !inOntology(flat.path) && usable(flat.fact)).length;
        if (excluded) note("outside_declared_ontology", excluded);
        const authorized: ProjectedFact[] = [];
        for (const { path, fact } of candidates) {
            if (!isAvailable(path)) {
                result.omittedFactCount++;
                continue;
            }
            const subjectFacts = namePaths(path).map(name => byPath.get(name)!);
            const subjects = subjectFacts.map(textValue);
            const sources = [
                ...new Map(
                    [fact, ...subjectFacts]
                        .flatMap(value => value.sources)
                        .map(source => {
                            const normalized = {
                                documentId: String(source.doc_id),
                                versionId:
                                    source.doc_id > 0 && source.version_id
                                        ? String(source.version_id)
                                        : null,
                                quote: source.quote ?? null,
                                snippetRef: source.doc_id > 0 ? (source.snippet_ref ?? null) : null,
                                page: source.doc_id > 0 ? (source.page ?? null) : null,
                                extractedAt: source.extracted_at,
                            };
                            return [canonical(normalized), normalized];
                        })
                ).values(),
            ].sort((a, b) => canonical(a).localeCompare(canonical(b)));
            authorized.push({
                path,
                label: labelFor(path, fact),
                value: textValue(fact),
                ...(subjects.length ? { subject: subjects.join(" / ") } : {}),
                basis:
                    fact.priority === "manual_override"
                        ? "human-entered-unreviewed"
                        : /^profile\.(summary|applicant_type|focus_areas)/.test(path)
                          ? "model-synthesis-unreviewed"
                          : "source-extracted-unreviewed",
                sources,
            });
        }
        if (result.omittedFactCount) note("candidate_facts_withheld", result.omittedFactCount);
        const authorizedPaths = new Set(authorized.map(fact => fact.path));
        for (const [code, exists] of [
            ["company_description_unknown", authorizedPaths.has("company.description")],
            ["company_industry_unknown", authorizedPaths.has("company.industry")],
            [
                "responsibilities_unknown",
                authorized.some(
                    fact =>
                        /^people\.\d+\.responsibilities$/.test(fact.path) ||
                        fact.path === "profile.facts.responsibilities"
                ),
            ],
            [
                "priorities_unknown",
                authorized.some(fact =>
                    /^profile\.facts\.(priorities|goals|strategy)$/.test(fact.path)
                ),
            ],
            ["markets_unknown", authorized.some(fact => fact.path.startsWith("markets."))],
            ["services_unknown", authorized.some(fact => fact.path.startsWith("services."))],
            ["projects_unknown", authorized.some(fact => fact.path.startsWith("projects."))],
            ["personnel_unknown", authorized.some(fact => fact.path.startsWith("people."))],
            [
                "constraints_unknown",
                authorized.some(
                    fact =>
                        fact.path.startsWith("policies.") ||
                        fact.path.startsWith("legal.") ||
                        fact.path === "profile.facts.constraints"
                ),
            ],
            [
                "hierarchy_unknown",
                authorizedPaths.has("profile.facts.hierarchy") ||
                    authorizedPaths.has("profile.facts.reporting_structure"),
            ],
            ["decision_authority_unknown", authorizedPaths.has("profile.facts.decision_authority")],
        ] as const)
            if (!exists) note(code);
        const required = [...new Set(["company.name", ...(options.requiredFactPaths ?? [])])];
        const requiredPaths = new Set(required);
        if (required.some(path => !inOntology(path) || !authorizedPaths.has(path)))
            return blocked("required_fields_unavailable");
        const substantive = authorized.filter(
            fact =>
                fact.path !== "company.name" &&
                !fact.path.endsWith(".name") &&
                fact.path !== "company.website"
        );
        if (substantive.length === 0) return blocked("substantive_context_unavailable");
        if (authorized.length === 0) return blocked("profile_empty");
        const substantivePaths = new Set(substantive.map(fact => fact.path));
        const ordered = [...authorized].sort(
            (a, b) =>
                Number(requiredPaths.has(b.path)) - Number(requiredPaths.has(a.path)) ||
                Number(substantivePaths.has(b.path)) - Number(substantivePaths.has(a.path)) ||
                a.path.localeCompare(b.path)
        );
        const payload = () =>
            canonical({
                adapterVersion: COMPANY_ARCHITECTURE_ADAPTER_VERSION,
                reviewState: "unreviewed",
                companyId: actor.companyId,
                facts: ordered,
                unknowns,
            });
        // UTF-8 bytes are a conservative token upper bound for this source contribution.
        const fits = (content: string) =>
            content.length <= Math.min(budgets.maxExcerptChars, 12000) &&
            Buffer.byteLength(content, "utf8") <= budgets.maxTokens;
        let content = payload(),
            budgetOmitted = 0,
            substantiveRemaining = substantivePaths.size;
        while (!fits(content) && ordered.length) {
            const last = ordered.at(-1)!;
            if (
                requiredPaths.has(last.path) ||
                (substantivePaths.has(last.path) && substantiveRemaining === 1)
            )
                return blocked("required_context_exceeds_budget");
            ordered.pop();
            if (substantivePaths.has(last.path)) substantiveRemaining--;
            budgetOmitted++;
            const old = unknowns.find(item => item.code === "budget_omitted_facts");
            if (old) old.count = budgetOmitted;
            else note("budget_omitted_facts", budgetOmitted);
            content = payload();
        }
        if (!fits(content) || ordered.length === 0)
            return blocked("required_context_exceeds_budget");
        result.omittedFactCount += budgetOmitted;
        result.includedFactPaths = ordered.map(fact => fact.path);
        result.projectionFingerprint = contentHash(content);
        const version = `company-profile-v0:${hash({ canonical: result.canonicalFingerprint, projection: result.projectionFingerprint, access: result.accessFingerprint })}`;
        const source: CompanyArchitectureRefV0 = {
            kind: "company",
            id: `company-metadata/${actor.companyId}`,
            version,
            companyId: actor.companyId,
            canonical: true,
            reviewState: "unreviewed",
        };
        const sourceDate = new Date(
            Math.max(
                ...[
                    profile.createdAt,
                    profile.builtAt,
                    profile.updatedAt,
                    metadata.updated_at,
                    ...ordered.flatMap(fact => [
                        byPath.get(fact.path)!.last_updated,
                        ...namePaths(fact.path).map(path => byPath.get(path)!.last_updated),
                        ...fact.sources.flatMap(source => [
                            source.extractedAt,
                            ...(source.documentId === "0"
                                ? []
                                : [documents.get(source.documentId)!.versionCreatedAt]),
                        ]),
                    ]),
                ]
                    .filter((value): value is string => value !== null)
                    .map(value => timestamp(value)!)
            )
        ).toISOString();
        const entry: RequiredCompanyArchitectureSourceV0 = {
            source,
            companyId: actor.companyId,
            access: "allowed",
            aclDigest: actor.aclDigest,
            audience: { kind: "company", companyId: actor.companyId },
            sourceDate,
            checkedAt,
            excerpt: content,
            required: true,
            canonical: true,
        };
        result.record = {
            source: entry.source,
            companyId: entry.companyId,
            access: entry.access,
            aclDigest: entry.aclDigest,
            audience: entry.audience,
            sourceDate: entry.sourceDate,
            checkedAt: entry.checkedAt,
            excerpt: entry.excerpt,
            content,
            contentHash: result.projectionFingerprint,
            provenance: {
                connector: "company-metadata",
                locator: `company-metadata/${actor.companyId}`,
                reason: COMPANY_ARCHITECTURE_ADAPTER_VERSION,
            },
        };
        result.status = result.omittedFactCount > 0 ? "partial" : "available";
        if (result.status === "available") result.requiredEntry = entry;
        return result;
    } catch {
        return blocked("invalid_profile_snapshot");
    }
}
