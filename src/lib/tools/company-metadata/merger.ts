/**
 * Company Metadata Merger
 *
 * Pure function: takes existing canonical metadata + newly extracted facts
 * and produces an updated canonical metadata + a diff for auditing.
 *
 * Merge rules:
 *  1. `manual_override` priority facts are NEVER overwritten by extraction.
 *  2. At the same priority level, higher confidence wins.
 *  3. At equal confidence, newer extraction wins (later `last_updated`).
 *  4. Superseded facts are NOT deleted — they get `status: "deprecated"`,
 *     `valid_to` set, and remain in the array/object for audit.
 *  5. New facts not present in existing metadata are added.
 *  6. People/services/projects are matched by normalised name.
 *  7. Market facts are unioned by normalised value.
 *  8. Policy facts are merged by key.
 */

import type {
    CompanyMetadataJSON,
    ExtractedCompanyFacts,
    MergeResult,
    MetadataDiff,
    MetadataFact,
    CompanyInfo,
    PersonEntry,
    ServiceEntry,
    ProjectEntry,
    SubprojectEntry,
    MarketsInfo,
} from "./types";

// ============================================================================
// Priority ranking (lower index = higher priority)
// ============================================================================

const PRIORITY_RANK: Record<string, number> = {
    manual_override: 0,
    high: 1,
    normal: 2,
    low: 3,
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Merge newly extracted facts into the existing canonical metadata.
 *
 * Both inputs are treated as immutable — a new object is returned.
 */
export function mergeCompanyMetadata(
    existing: CompanyMetadataJSON,
    extracted: ExtractedCompanyFacts,
): MergeResult {
    const now = new Date().toISOString();
    const diff: MetadataDiff = { added: [], updated: [], deprecated: [] };

    // Deep-clone existing so we never mutate the input
    const merged: CompanyMetadataJSON = structuredClone(existing);

    // ---- Company fields ----
    if (extracted.facts.company) {
        merged.company = mergeCompanyInfo(
            merged.company,
            extracted.facts.company,
            diff,
        );
    }

    // ---- People ----
    if (extracted.facts.people) {
        merged.people = mergeNamedArray(
            merged.people,
            extracted.facts.people,
            "people",
            diff,
        );
    }

    // ---- Services ----
    if (extracted.facts.services) {
        merged.services = mergeNamedArray(
            merged.services,
            extracted.facts.services,
            "services",
            diff,
        );
    }

    // ---- Projects ----
    if (extracted.facts.projects) {
        merged.projects = mergeNamedArray(
            merged.projects,
            extracted.facts.projects,
            "projects",
            diff,
        );
    }

    // ---- Markets ----
    if (extracted.facts.markets) {
        merged.markets = mergeMarkets(merged.markets, extracted.facts.markets, diff);
    }

    // ---- Policies ----
    if (extracted.facts.policies) {
        merged.policies = mergePolicies(
            merged.policies,
            extracted.facts.policies,
            diff,
        );
    }

    // ---- Provenance ----
    merged.provenance = {
        ...merged.provenance,
        total_documents_processed: merged.provenance.total_documents_processed + 1,
        last_document_processed: {
            doc_id: extracted.document_id,
            doc_name: extracted.document_name,
            processed_at: extracted.extracted_at,
        },
    };

    merged.updated_at = now;

    return { updatedMetadata: merged, diff };
}

// ============================================================================
// Fact-level merge decision
// ============================================================================

/**
 * Decide whether `incoming` should replace `existing`.
 *
 * Returns `true` if the incoming fact wins.
 */
function shouldReplace(
    existing: MetadataFact<unknown>,
    incoming: MetadataFact<unknown>,
): boolean {
    // Rule 1: manual_override is never overwritten by automated extraction
    if (existing.priority === "manual_override" && incoming.priority !== "manual_override") {
        return false;
    }

    const existingRank = PRIORITY_RANK[existing.priority] ?? 2;
    const incomingRank = PRIORITY_RANK[incoming.priority] ?? 2;

    // Higher priority (lower rank number) wins
    if (incomingRank < existingRank) return true;
    if (incomingRank > existingRank) return false;

    // Same priority — higher confidence wins
    if (incoming.confidence > existing.confidence) return true;
    if (incoming.confidence < existing.confidence) return false;

    // Same confidence — newer wins
    return incoming.last_updated > existing.last_updated;
}

/**
 * Deprecate a fact: mark it as superseded with a valid_to timestamp.
 */
function deprecate(fact: MetadataFact<unknown>): MetadataFact<unknown> {
    return {
        ...fact,
        status: "deprecated",
        valid_to: new Date().toISOString(),
    };
}

// ============================================================================
// Company info merge
// ============================================================================

function mergeCompanyInfo(
    existing: CompanyInfo,
    incoming: Partial<CompanyInfo>,
    diff: MetadataDiff,
): CompanyInfo {
    const result = { ...existing };

    for (const [key, incomingFact] of Object.entries(incoming)) {
        if (!incomingFact) continue;

        const existingFact = existing[key];

        if (!existingFact) {
            // New fact — add it
            result[key] = incomingFact;
            diff.added.push({ path: `company.${key}`, new: incomingFact });
        } else if (shouldReplace(existingFact, incomingFact)) {
            // Incoming wins — replace and record diff
            result[key] = incomingFact;
            diff.updated.push({
                path: `company.${key}`,
                old: existingFact,
                new: incomingFact,
            });
            diff.deprecated.push({
                path: `company.${key}`,
                old: deprecate(existingFact),
            });
        }
        // else: existing wins — no change
    }

    return result;
}

// ============================================================================
// Named-array merge (people, services, projects)
// ============================================================================

/** Normalise a name for matching. */
function normaliseName(fact: MetadataFact<unknown>): string {
    return String(fact.value).toLowerCase().trim().replace(/\s+/g, " ");
}

type NamedEntry = PersonEntry | ServiceEntry | ProjectEntry | SubprojectEntry;

/**
 * Merge an array of named entries. Entries are matched by normalised name.
 * New entries are appended. Existing entries have their fields merged.
 */
function mergeNamedArray<T extends NamedEntry>(
    existing: T[],
    incoming: T[],
    section: string,
    diff: MetadataDiff,
): T[] {
    // Index existing by normalised name
    const existingMap = new Map<string, { entry: T; index: number }>();
    for (let i = 0; i < existing.length; i++) {
        const entry = existing[i]!;
        existingMap.set(normaliseName(entry.name), { entry, index: i });
    }

    const result = existing.map((e) => ({ ...e }));

    for (const incomingEntry of incoming) {
        const key = normaliseName(incomingEntry.name);
        const match = existingMap.get(key);

        if (!match) {
            // New entry — append
            const newIndex = result.length;
            result.push({ ...incomingEntry });
            diff.added.push({
                path: `${section}[${newIndex}]`,
                new: incomingEntry.name,
            });
        } else {
            // Existing entry — merge fields
            const mergedEntry = { ...match.entry } as Record<string, unknown>;
            const idx = match.index;

            for (const [field, incomingFact] of Object.entries(incomingEntry)) {
                if (field === "subprojects") continue; // handled separately below
                if (!incomingFact || typeof incomingFact !== "object" || !("value" in incomingFact)) continue;

                const existingFact = match.entry[field as keyof T] as MetadataFact<unknown> | undefined;
                const typed = incomingFact as MetadataFact<unknown>;

                if (!existingFact) {
                    mergedEntry[field] = typed;
                    diff.added.push({
                        path: `${section}[${idx}].${field}`,
                        new: typed,
                    });
                } else if (shouldReplace(existingFact, typed)) {
                    mergedEntry[field] = typed;
                    diff.updated.push({
                        path: `${section}[${idx}].${field}`,
                        old: existingFact,
                        new: typed,
                    });
                    diff.deprecated.push({
                        path: `${section}[${idx}].${field}`,
                        old: deprecate(existingFact),
                    });
                }
            }

            // Merge subprojects if present on projects
            if ("subprojects" in incomingEntry && incomingEntry.subprojects) {
                const existingSubs = (match.entry as ProjectEntry).subprojects ?? [];
                mergedEntry.subprojects = mergeNamedArray(
                    existingSubs,
                    incomingEntry.subprojects as NamedEntry[],
                    `${section}[${idx}].subprojects`,
                    diff,
                );
            }

            result[idx] = mergedEntry as T;
        }
    }

    return result;
}

// ============================================================================
// Markets merge
// ============================================================================

function mergeMarkets(
    existing: MarketsInfo,
    incoming: Partial<MarketsInfo>,
    diff: MetadataDiff,
): MarketsInfo {
    const result = { ...existing };
    const categories = ["primary", "verticals", "geographies"] as const;

    for (const cat of categories) {
        const incomingFacts = incoming[cat];
        if (!incomingFacts || incomingFacts.length === 0) continue;

        const existingFacts = existing[cat] ?? [];

        // Index existing by normalised value
        const existingValues = new Map<string, MetadataFact>();
        for (const fact of existingFacts) {
            existingValues.set(
                String(fact.value).toLowerCase().trim(),
                fact,
            );
        }

        const merged = [...existingFacts];

        for (const incomingFact of incomingFacts) {
            const key = String(incomingFact.value).toLowerCase().trim();
            const existingFact = existingValues.get(key);

            if (!existingFact) {
                merged.push(incomingFact);
                diff.added.push({
                    path: `markets.${cat}[${merged.length - 1}]`,
                    new: incomingFact,
                });
            } else if (shouldReplace(existingFact, incomingFact)) {
                const idx = merged.indexOf(existingFact);
                merged[idx] = incomingFact;
                diff.updated.push({
                    path: `markets.${cat}[${idx}]`,
                    old: existingFact,
                    new: incomingFact,
                });
            }
        }

        result[cat] = merged;
    }

    return result;
}

// ============================================================================
// Policies merge
// ============================================================================

function mergePolicies(
    existing: Record<string, MetadataFact>,
    incoming: Record<string, MetadataFact>,
    diff: MetadataDiff,
): Record<string, MetadataFact> {
    const result = { ...existing };

    for (const [key, incomingFact] of Object.entries(incoming)) {
        const existingFact = existing[key];

        if (!existingFact) {
            result[key] = incomingFact;
            diff.added.push({ path: `policies.${key}`, new: incomingFact });
        } else if (shouldReplace(existingFact, incomingFact)) {
            result[key] = incomingFact;
            diff.updated.push({
                path: `policies.${key}`,
                old: existingFact,
                new: incomingFact,
            });
            diff.deprecated.push({
                path: `policies.${key}`,
                old: deprecate(existingFact),
            });
        }
    }

    return result;
}
