import {
    calculateWeeklyReviewBudget,
    reviewFingerprint,
    type WeeklyReviewInput,
    type WeeklyReviewRetrievalContext,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import { rankRoleAwareCandidates } from "@launchstack/pipelines/vantage/role-aware-ranking";
import {
    decideInternalFollowUp,
    finalizeInternalFollowUp,
    type InternalRetrievalDecision,
} from "@launchstack/pipelines/vantage/internal-retrieval-decision";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import { parseConfirmedBusinessRole } from "./weekly-review-business-role";
import { searchInternalEvidence } from "./weekly-review-internal-search";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import type { DynamicRetrievalConfiguration } from "./weekly-review-dynamic-retrieval";
import type { SelectionDiagnostics, ReviewInputIdentity } from "./weekly-review-internal-selection";
import {
    WeeklyReviewConflict,
    type WeeklyReviewSource,
    type WeeklyReviewContext,
    type WeeklyReviewQuery,
    type FrozenDependency,
    type SourcePurpose,
} from "./weekly-review-types";

type Candidate = {
    id: string;
    version: string;
    title: string;
    category: string;
    availableAt: string;
};
function databaseIdentity(value: unknown): string {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint")
        return String(value);
    throw new WeeklyReviewConflict("source_context_unavailable");
}
export async function collectDynamicOptionalEvidence(args: {
    query: WeeklyReviewQuery;
    actor: WeeklyReviewAuthorityActor;
    epoch: string;
    week: string;
    cutoff: string;
    identity: ReviewInputIdentity;
    configuration: DynamicRetrievalConfiguration;
    preference: Record<string, unknown> | undefined;
    sources: WeeklyReviewSource[];
    dependencies: FrozenDependency[];
    scopedEvidence: NonNullable<WeeklyReviewContext["scopedEvidence"]>;
    mandatoryCount: number;
    acquisition: SelectionDiagnostics["acquisition"];
    read: (
        id: string,
        purpose: SourcePurpose,
        cutoff: string,
        version?: string | null
    ) => Promise<WeeklyReviewSource>;
}): Promise<WeeklyReviewContext> {
    const { actor, configuration, query, cutoff, week, identity, scopedEvidence } = args;
    if (configuration.mode === "baseline") throw new WeeklyReviewConflict("invalid_retrieval_mode");
    const role = parseConfirmedBusinessRole(args.preference?.business_role_context, actor);
    const useRanking = configuration.mode === "role" || configuration.mode === "combined";
    const useFollowUp =
        configuration.mode === "internal-research" || configuration.mode === "combined";
    const context: WeeklyReviewRetrievalContext = {
        schemaVersion: "vantage-dynamic-retrieval/v3",
        mode: configuration.mode,
        traceHash: "0".repeat(64),
        ...(role
            ? {
                  businessRole: {
                      primaryRole: role.primaryRole,
                      responsibilities: role.responsibilities,
                      priorities: role.priorities,
                      revision: role.revision,
                  },
              }
            : {}),
    };
    const sources = [...args.sources];
    const fixed = [...args.sources];
    const dependencies = [...args.dependencies];
    const fixedDependencies = [...args.dependencies];
    const reservedIds = [...new Set(fixed.map(source => source.id))];
    const profile = scopedEvidence.length ? "scoped-v2" : "internal-v1";
    const input = (selected: WeeklyReviewSource[] = sources): WeeklyReviewInput => ({
        candidateId: identity.candidateId,
        week,
        asOf: identity.asOf,
        role: actor.role,
        mandatoryCoverage: { required: args.mandatoryCount, included: args.mandatoryCount },
        sources: selected,
        retrievalContext: context,
        ...(scopedEvidence.length ? { scopedEvidence } : {}),
    });
    const budget = () => calculateWeeklyReviewBudget(input(), profile);
    if (!budget().feasible) throw new WeeklyReviewConflict("mandatory_context_budget_exceeded");
    const diagnostics: SelectionDiagnostics = {
        schemaVersion: "vantage-internal-selection/v1",
        cutoff,
        selected: [],
        omitted: [],
        deniedCount: 0,
        budget: budget(),
        mandatoryCoverage: input().mandatoryCoverage,
        acquisition: args.acquisition,
    };
    const denied = new Set<string>();
    const errors = new Map<string, SelectionDiagnostics["omitted"][number]>();
    const cached = new Map<string, WeeklyReviewSource>();
    // Internal modes reserve sixteen optional acquisition slots for their sole follow-up.
    const initialLimit = useFollowUp ? 48 : 64;
    const rows = await query(
        "SELECT d.id,CASE WHEN octet_length(d.title)<=1000 THEN d.title ELSE NULL END AS title,d.category,v.id AS version_id,v.created_at AS version_created_at FROM pdr_ai_v2_document d LEFT JOIN LATERAL (SELECT id,created_at FROM pdr_ai_v2_document_versions WHERE document_id=d.id AND created_at<=$2::timestamptz ORDER BY created_at DESC,id DESC LIMIT 1) v ON true WHERE d.company_id=$1::bigint AND NOT (d.id=ANY($3::bigint[])) ORDER BY v.created_at DESC NULLS LAST,v.id DESC,d.id DESC LIMIT $4",
        [actor.companyId, cutoff, reservedIds, initialLimit]
    );
    const candidates: Candidate[] = [];
    const rankingWindow = {
        start: new Date(
            Math.min(Date.parse(week + "T00:00:00.000Z"), Date.parse(cutoff))
        ).toISOString(),
        cutoff,
    };
    for (const row of rows) {
        const id = String(row.id);
        if (
            !scopeAllowsDocument(actor.documentScope, {
                id: Number(id),
                category: String(row.category),
            })
        ) {
            denied.add(id);
            continue;
        }
        if (
            row.version_id == null ||
            typeof row.title !== "string" ||
            String(row.category).length > 1000
        ) {
            errors.set(id, {
                id,
                purpose: "retrieved",
                reason:
                    row.version_id == null
                        ? "source_version_unavailable"
                        : "source_context_unavailable",
                temporalEligibility: row.version_id == null ? "unavailable" : "eligible",
            });
            continue;
        }
        candidates.push({
            id,
            version: databaseIdentity(row.version_id),
            title: row.title,
            category: String(row.category),
            availableAt:
                row.version_created_at instanceof Date
                    ? row.version_created_at.toISOString()
                    : String(row.version_created_at),
        });
    }
    const ranked = useRanking
        ? rankRoleAwareCandidates(candidates, role, rankingWindow)
        : candidates.map((candidate, index) => ({ candidate, rank: index + 1 }));
    const acquire = async (items: Candidate[]) => {
        for (const item of items) {
            if (cached.has(item.id)) continue;
            try {
                const source = await args.read(item.id, "retrieved", cutoff, item.version);
                if (source.version !== item.version)
                    throw new WeeklyReviewConflict("source_authority_changed");
                cached.set(item.id, source);
            } catch (error) {
                if (!(error instanceof WeeklyReviewConflict)) throw error;
                if (error.code === "source_access_denied") {
                    denied.add(item.id);
                    continue;
                }
                if (
                    ![
                        "source_version_unavailable",
                        "source_context_unavailable",
                        "acquisition_budget",
                    ].includes(error.code)
                )
                    throw error;
                errors.set(item.id, {
                    id: item.id,
                    version: item.version,
                    purpose: "retrieved",
                    reason: error.code,
                    temporalEligibility:
                        error.code === "source_version_unavailable" ? "unavailable" : "eligible",
                });
            }
        }
    };
    const select = (ordered: Candidate[]) => {
        sources.splice(0, sources.length, ...fixed);
        dependencies.splice(0, dependencies.length, ...fixedDependencies);
        diagnostics.omitted = [...errors.values()];
        if (!budget().feasible) throw new WeeklyReviewConflict("dynamic_context_budget_exceeded");
        const included = new Set(sources.map(source => source.id));
        for (const item of ordered) {
            const source = cached.get(item.id);
            if (!source || included.has(item.id)) continue;
            const next = calculateWeeklyReviewBudget(input([...sources, source]), profile);
            if (!next.feasible) {
                diagnostics.omitted.push({
                    id: item.id,
                    version: item.version,
                    purpose: "retrieved",
                    reason:
                        sources.length >= next.limits.sourceCount
                            ? "ranked_lower"
                            : "budget_exceeded",
                    temporalEligibility: "eligible",
                });
                continue;
            }
            sources.push(source);
            dependencies.push(source);
            included.add(source.id);
        }
    };
    const ordered = ranked.map(item => item.candidate);
    await acquire(ordered);
    select(ordered);
    let decision: InternalRetrievalDecision | undefined;
    let finalDecision: InternalRetrievalDecision | undefined;
    let searched: Awaited<ReturnType<typeof searchInternalEvidence>> | undefined;
    let added: Candidate[] = [];
    const initialSelected = sources.map(source => source.ref);
    if (useFollowUp) {
        decision = decideInternalFollowUp({
            sources,
            role,
            roundsUsed: 0,
            maxRounds: configuration.maxFollowUpRounds,
        });
        context.internalDecision = {
            outcome: decision.outcome,
            questions: decision.unresolved.map(gap => gap.question),
        };
        // Every source supporting a retained question remains a frozen dependency.
        const supportingRefs = new Set(decision.gaps.flatMap(gap => [...gap.supportingRefs]));
        for (const source of sources)
            if (supportingRefs.has(source.ref) && !fixed.some(item => item.id === source.id)) {
                fixed.push(source);
                fixedDependencies.push(source);
            }
        select(ordered);
        if (decision.outcome === "INTERNAL_FOLLOW_UP") {
            searched = await searchInternalEvidence(query, actor, cutoff, {
                queries: decision.queries,
                excludeIds: [...reservedIds, ...rows.map(row => String(row.id))],
                limit: 16,
            });
            const selectedIds = new Set(sources.map(source => source.id));
            const localMatches = ordered.filter(item => {
                const source = cached.get(item.id);
                if (!source || selectedIds.has(item.id)) return false;
                const text = (source.title + " " + source.text).toLowerCase();
                return decision!.queries.some(value => {
                    const terms = value.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,39}/g) ?? [];
                    return terms.length > 0 && terms.every(term => text.includes(term));
                });
            });
            added = [
                ...searched.candidates.map(item => ({
                    ...item,
                    availableAt:
                        item.availableAt instanceof Date
                            ? item.availableAt.toISOString()
                            : item.availableAt,
                })),
                ...localMatches,
            ].slice(0, 16);
            if (useRanking)
                added = rankRoleAwareCandidates(added, role, rankingWindow).map(
                    item => item.candidate
                );
            await acquire(added);
            select([...added, ...ordered]);
            finalDecision = finalizeInternalFollowUp(decision, {
                sources,
                role,
                roundsUsed: 1,
                maxRounds: configuration.maxFollowUpRounds,
            });
        } else finalDecision = decision;
        context.internalDecision = {
            outcome: finalDecision.outcome,
            questions: finalDecision.unresolved.map(gap => gap.question),
        };
    }
    const selectedIds = new Set(sources.map(source => source.id));
    // Older readers already remove omitted entries. Keep unfrozen discovery
    // identities there, so a compatible reader rollback cannot disclose them.
    diagnostics.omitted = diagnostics.omitted.map(item => ({
        ...item,
        ranking: ranked.find(ranking => ranking.candidate.id === item.id),
    }));
    const trace = {
        schemaVersion: "vantage-dynamic-retrieval-trace/v3",
        mode: configuration.mode,
        roleStatus: role ? "confirmed" : "missing",
        roleRevision: role?.revision ?? null,
        ranking: ranked.filter(item => selectedIds.has(item.candidate.id)),
        rankingCandidateCount: ranked.length,
        discoveryDigest: reviewFingerprint(ranked),
        initialSelected: initialSelected.filter(ref => sources.some(source => source.ref === ref)),
        initialSelectedCount: initialSelected.length,
        initialSelectionDigest: reviewFingerprint(initialSelected),
        decision,
        finalDecision,
        followUp: {
            rounds: searched ? 1 : 0,
            queryCount: searched?.queryCount ?? 0,
            queries: decision?.queries ?? [],
            acquired: added
                .filter(item => cached.has(item.id) && selectedIds.has(item.id))
                .map(item => ({ id: item.id, version: item.version })),
            acquiredCount: added.filter(item => cached.has(item.id)).length,
            admitted: sources
                .filter(source => added.some(item => item.id === source.id))
                .map(source => source.ref),
        },
        selectedRefs: sources.map(source => source.ref),
        bounds: {
            initialCandidates: initialLimit,
            followUpReturned: 16,
            followUpScan: 64,
            maxFollowUpRounds: configuration.maxFollowUpRounds,
        },
    };
    context.traceHash = reviewFingerprint(trace);
    diagnostics.dynamicRetrieval = trace;
    diagnostics.deniedCount = denied.size + (searched?.deniedCount ?? 0);
    diagnostics.selected = sources.map(source => ({
        id: source.id,
        version: source.version,
        purpose: source.purpose,
        rationale:
            source.purpose !== "retrieved"
                ? "reserved_" + source.purpose
                : added.some(item => item.id === source.id)
                  ? "internal_follow_up_within_budget"
                  : useRanking && role
                    ? "confirmed_role_rank_within_budget"
                    : "eligible_version_recency_within_budget",
        temporalEligibility: "eligible",
    }));
    diagnostics.budget = budget();
    if (!diagnostics.budget.feasible) throw new WeeklyReviewConflict("context_budget_exceeded");
    return {
        actor,
        week,
        sources,
        role: actor.role,
        preferenceVersion: Number(args.preference?.version ?? 0),
        authorityEpoch: args.epoch,
        mandatoryCoverage: diagnostics.mandatoryCoverage,
        inputIdentity: identity,
        selectionDiagnostics: diagnostics,
        retrievalContext: context,
        ...(scopedEvidence.length
            ? {
                  scopedEvidence,
                  dependencies: dependencies.map(({ kind, id, version, hash, purpose, scope }) => ({
                      kind,
                      id,
                      version,
                      hash,
                      purpose,
                      ...(scope ? { scope } : {}),
                  })),
              }
            : {}),
    };
}
