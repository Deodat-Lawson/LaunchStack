/**
 * Assembling the profile — pure.
 *
 * The profile is rebuilt from scratch on every build: the facts of every
 * source that counts, merged in document order, then a person's edits laid
 * back on top. Nothing is patched in place, so a deleted document, a source
 * set aside, or a new version that no longer says something simply stops
 * contributing — the retraction the old incremental merge never did.
 *
 * Edits survive because they are carried over from the previous profile:
 * any fact with priority `manual_override` (including a removal, which is a
 * `manual_override` fact with status `deprecated`) replaces whatever the
 * sources say at the same place.
 */
import { createHash } from "node:crypto";

import { mergeCompanyMetadata } from "./merger";
import {
    METADATA_SCHEMA_VERSION,
    createEmptyMetadata,
    type CompanyMetadataJSON,
    type MetadataDiff,
    type MetadataFact,
    type SourceFacts,
} from "./types";

export interface AssembleSource {
    documentId: number;
    title: string;
    facts: SourceFacts;
}

const isManual = (fact: MetadataFact<unknown> | undefined): boolean =>
    fact?.priority === "manual_override";

const normaliseName = (value: unknown): string =>
    String(value).toLowerCase().trim().replace(/\s+/g, " ");

type Entry = { name: MetadataFact } & Record<string, unknown>;
const NAMED_SECTIONS = ["people", "services", "projects", "legal"] as const;

/** The profile from these sources, with the previous profile's edits kept. */
export function assembleMetadata(
    companyId: string,
    sources: AssembleSource[],
    previous: CompanyMetadataJSON | null,
    now: Date
): CompanyMetadataJSON {
    let doc = createEmptyMetadata(companyId, now);
    const ordered = [...sources].sort((a, b) => a.documentId - b.documentId);
    for (const source of ordered) {
        doc = mergeCompanyMetadata(doc, {
            document_id: source.documentId,
            document_name: source.title,
            extracted_at: now.toISOString(),
            facts: source.facts,
        }).updatedMetadata;
    }
    const assembled = applyManualOverrides(doc, previous);
    assembled.updated_at = now.toISOString();
    assembled.provenance = {
        total_documents_processed: ordered.length,
        sources_counted: ordered.length,
        last_document_processed: assembled.provenance.last_document_processed,
        extraction_model: previous?.provenance.extraction_model ?? "",
        extraction_version: METADATA_SCHEMA_VERSION,
    };
    return assembled;
}

/**
 * Lay every `manual_override` fact of `previous` onto `target`. Idempotent:
 * applying it twice changes nothing, so the save step can re-apply it under
 * the row lock to catch an edit made while the build was running.
 */
export function applyManualOverrides(
    target: CompanyMetadataJSON,
    previous: CompanyMetadataJSON | null
): CompanyMetadataJSON {
    if (!previous) return target;
    const out = structuredClone(target);

    for (const [key, fact] of Object.entries(previous.company ?? {}))
        if (fact && isManual(fact)) out.company[key] = fact;

    for (const [key, fact] of Object.entries(previous.policies ?? {}))
        if (isManual(fact)) out.policies[key] = fact;

    const previousProfile = previous.profile ?? {};
    const profile = { ...(out.profile ?? {}) };
    for (const [key, fact] of Object.entries(previousProfile.facts ?? {}))
        if (isManual(fact)) profile.facts = { ...(profile.facts ?? {}), [key]: fact };
    if (isManual(previousProfile.summary)) profile.summary = previousProfile.summary;
    if (isManual(previousProfile.applicant_type))
        profile.applicant_type = previousProfile.applicant_type;
    if (previousProfile.focus_areas?.some(isManual))
        profile.focus_areas = previousProfile.focus_areas;
    out.profile = profile;

    for (const cat of ["primary", "verticals", "geographies"] as const) {
        for (const fact of previous.markets?.[cat] ?? []) {
            if (!isManual(fact)) continue;
            const list = [...(out.markets[cat] ?? [])];
            const at = list.findIndex(f => normaliseName(f.value) === normaliseName(fact.value));
            if (at >= 0) list[at] = fact;
            else list.push(fact);
            out.markets[cat] = list;
        }
    }

    for (const section of NAMED_SECTIONS) {
        const list = [...((out[section] ?? []) as Entry[])];
        for (const entry of (previous[section] ?? []) as Entry[]) {
            const manualFields = Object.entries(entry).filter(
                ([, v]) =>
                    v && typeof v === "object" && "priority" in v && isManual(v as MetadataFact)
            );
            if (manualFields.length === 0) continue;
            const at = list.findIndex(
                e => normaliseName(e.name.value) === normaliseName(entry.name.value)
            );
            if (at >= 0) list[at] = { ...list[at]!, ...Object.fromEntries(manualFields) } as Entry;
            // A person added by hand stays; an edit to someone the sources no
            // longer mention goes with them.
            else if (isManual(entry.name)) list.push(Object.fromEntries(manualFields) as Entry);
        }
        (out as unknown as Record<string, Entry[]>)[section] = list;
    }
    return out;
}

// ============================================================================
// Flattening, for the diff and the summary
// ============================================================================

export interface FlatFact {
    /** Path in the user's terms: "company.headquarters", "people.0.role", "profile.facts.mission". */
    path: string;
    fact: MetadataFact<unknown>;
}

/** Every fact in the document with its path, in display order. */
export function flattenFacts(metadata: CompanyMetadataJSON): FlatFact[] {
    const out: FlatFact[] = [];
    const push = (path: string, fact: unknown) => {
        if (fact && typeof fact === "object" && "value" in fact)
            out.push({ path, fact: fact as MetadataFact<unknown> });
    };
    for (const [key, fact] of Object.entries(metadata.company ?? {})) push(`company.${key}`, fact);
    for (const [key, fact] of Object.entries(metadata.profile?.facts ?? {}))
        push(`profile.facts.${key}`, fact);
    for (const section of NAMED_SECTIONS) {
        ((metadata[section] ?? []) as Entry[]).forEach((entry, i) => {
            for (const [field, fact] of Object.entries(entry)) {
                if (field === "subprojects" && Array.isArray(fact)) {
                    (fact as Entry[]).forEach((sub, j) => {
                        for (const [subField, subFact] of Object.entries(sub))
                            push(`${section}.${i}.subprojects.${j}.${subField}`, subFact);
                    });
                } else push(`${section}.${i}.${field}`, fact);
            }
        });
    }
    for (const cat of ["primary", "verticals", "geographies"] as const)
        (metadata.markets?.[cat] ?? []).forEach((fact, i) => push(`markets.${cat}.${i}`, fact));
    for (const [key, fact] of Object.entries(metadata.policies ?? {}))
        push(`policies.${key}`, fact);
    return out;
}

/**
 * Identity of a fact for the diff: where it is in the person's terms.
 * Array positions shift between builds, so named entries are keyed by name
 * and market values by value.
 */
function logicalKey(metadata: CompanyMetadataJSON, flat: FlatFact): string {
    const [section, index, ...rest] = flat.path.split(".");
    if (section && (NAMED_SECTIONS as readonly string[]).includes(section)) {
        const list = (metadata as unknown as Record<string, Entry[]>)[section] ?? [];
        const name = list[Number(index)]?.name.value ?? index;
        return `${section}:${normaliseName(name)}:${rest.join(".")}`;
    }
    if (section === "markets") return `markets.${index}:${normaliseName(flat.fact.value)}`;
    return flat.path;
}

function activeByKey(metadata: CompanyMetadataJSON | null): Map<string, FlatFact> {
    const map = new Map<string, FlatFact>();
    if (!metadata) return map;
    for (const flat of flattenFacts(metadata))
        if (flat.fact.status === "active") map.set(logicalKey(metadata, flat), flat);
    return map;
}

/** What changed between two profiles, for the audit history. */
export function diffMetadata(
    previous: CompanyMetadataJSON | null,
    next: CompanyMetadataJSON
): MetadataDiff {
    const diff: MetadataDiff = { added: [], updated: [], deprecated: [] };
    const before = activeByKey(previous);
    const after = activeByKey(next);
    for (const [key, flat] of after) {
        const prior = before.get(key);
        if (!prior) diff.added.push({ path: flat.path, new: flat.fact });
        else if (normaliseName(prior.fact.value) !== normaliseName(flat.fact.value))
            diff.updated.push({ path: flat.path, old: prior.fact, new: flat.fact });
    }
    for (const [key, flat] of before)
        if (!after.has(key)) diff.deprecated.push({ path: flat.path, old: flat.fact });
    return diff;
}

export function isEmptyDiff(diff: MetadataDiff): boolean {
    return diff.added.length + diff.updated.length + diff.deprecated.length === 0;
}

/** Hash of the active facts the summary is written from. */
export function factsHash(metadata: CompanyMetadataJSON): string {
    const lines = flattenFacts(metadata)
        .filter(f => f.fact.status === "active" && !f.path.startsWith("profile.summary"))
        .map(f => `${f.path}=${normaliseName(f.fact.value)}`)
        .sort();
    return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}
