import { createHash } from "node:crypto";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import {
    calculateWeeklyReviewBudget,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import {
    WeeklyReviewConflict,
    type SourcePurpose,
    type WeeklyReviewActor,
    type WeeklyReviewContext,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
    type WeeklyReviewSource,
} from "./weekly-review-types";

export const INTERNAL_RETRIEVAL_LIMITS = Object.freeze({
    candidateLimit: 64,
    chunkLimitPerSource: 128,
    maxSourceBytes: 24000,
    maxLoadedTextBytes: 128000,
    deadlineMs: 3000,
    maxQueries: 768,
});
export type ReviewInputIdentity = { candidateId: string; asOf: string };
type Acquisition = {
    candidateLimit: number;
    chunkLimitPerSource: number;
    loadedTextBytes: number;
    maxLoadedTextBytes: number;
    deadlineMs: number;
    queryCount: number;
    maxQueries: number;
};
export type SelectionDiagnostics = Record<string, unknown> & {
    schemaVersion: "vantage-internal-selection/v1";
    cutoff: string;
    selected: Array<{
        id: string;
        version: string;
        purpose: SourcePurpose;
        rationale: string;
        temporalEligibility: "eligible";
    }>;
    omitted: Array<{
        id: string;
        version?: string;
        purpose: SourcePurpose;
        reason: string;
        temporalEligibility: "eligible" | "unavailable";
    }>;
    deniedCount: number;
    budget: ReturnType<typeof calculateWeeklyReviewBudget>;
    mandatoryCoverage: { required: number; included: number };
    acquisition: Acquisition;
};
type Fresh = (
    query: WeeklyReviewQuery,
    expected: WeeklyReviewActor,
    write?: boolean,
    actorDeadline?: number
) => Promise<{ actor: WeeklyReviewAuthorityActor; epoch: string }>;
type PurposeAssertion = (input: {
    purpose: SourcePurpose;
    readable: boolean;
    companyReadable: boolean;
}) => void;

const databaseText = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint")
        return String(value);
    throw new WeeklyReviewConflict("source_context_unavailable");
};
/** One elapsed-time envelope covers epoch acquisition, candidate SQL and all reads. */
export function boundedInternalQuery(raw: WeeklyReviewQuery) {
    const startedAt = Date.now();
    const acquisition: Acquisition = {
        candidateLimit: INTERNAL_RETRIEVAL_LIMITS.candidateLimit,
        chunkLimitPerSource: INTERNAL_RETRIEVAL_LIMITS.chunkLimitPerSource,
        loadedTextBytes: 0,
        maxLoadedTextBytes: INTERNAL_RETRIEVAL_LIMITS.maxLoadedTextBytes,
        deadlineMs: INTERNAL_RETRIEVAL_LIMITS.deadlineMs,
        queryCount: 0,
        maxQueries: INTERNAL_RETRIEVAL_LIMITS.maxQueries,
    };
    const query: WeeklyReviewQuery = async (text, parameters = []) => {
        const remaining = INTERNAL_RETRIEVAL_LIMITS.deadlineMs - (Date.now() - startedAt);
        if (remaining <= 0 || acquisition.queryCount + 2 > INTERNAL_RETRIEVAL_LIMITS.maxQueries)
            throw new WeeklyReviewConflict("retrieval_acquisition_timeout", 503);
        acquisition.queryCount += 2;
        // Transaction-local settings expire at commit/rollback, including on errors.
        await raw(
            "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout','1000ms',true)",
            [remaining + "ms"]
        );
        try {
            const rows = await raw(text, parameters);
            if (Date.now() - startedAt >= INTERNAL_RETRIEVAL_LIMITS.deadlineMs)
                throw new WeeklyReviewConflict("retrieval_acquisition_timeout", 503);
            return rows;
        } catch (error) {
            const value = error as { code?: string; cause?: { code?: string } };
            if (["57014", "55P03"].includes(value.code ?? value.cause?.code ?? ""))
                throw new WeeklyReviewConflict("retrieval_acquisition_timeout", 503);
            throw error;
        }
    };
    return { query, acquisition, deadlineAt: startedAt + INTERNAL_RETRIEVAL_LIMITS.deadlineMs };
}

export function createInternalSourceReader(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewAuthorityActor,
    acquisition: Acquisition,
    assertPurpose: PurposeAssertion
) {
    return async (
        id: string,
        purpose: SourcePurpose,
        cutoff: string,
        exactVersion: string | null = null
    ): Promise<WeeklyReviewSource> => {
        const rows = await query(
            "SELECT d.id,CASE WHEN octet_length(d.title)<=1024 THEN d.title ELSE NULL END AS title,d.category,v.id AS version_id,v.created_at AS version_created_at FROM pdr_ai_v2_document d LEFT JOIN LATERAL (SELECT id,created_at FROM pdr_ai_v2_document_versions WHERE document_id=d.id AND (($3::bigint IS NOT NULL AND id=$3::bigint) OR ($3::bigint IS NULL AND created_at<=$4::timestamptz)) ORDER BY created_at DESC,id DESC LIMIT 1) v ON true WHERE d.company_id=$1::bigint AND d.id=$2::bigint",
            [actor.companyId, id, exactVersion, cutoff]
        );
        const row = rows[0];
        // Check current ACL before disclosing whether a historical version exists.
        if (
            !row ||
            !scopeAllowsDocument(actor.documentScope, {
                id: Number(row.id),
                category: String(row.category),
            })
        )
            throw new WeeklyReviewConflict("source_access_denied", 403);
        if (row.version_id == null) throw new WeeklyReviewConflict("source_version_unavailable");
        if (row.title == null) throw new WeeklyReviewConflict("source_context_unavailable");
        const restrictions = await query(
            "SELECT 1 AS restricted FROM pdr_ai_v2_document_settings WHERE document_id=$1::bigint AND restricted=true UNION ALL SELECT 1 FROM pdr_ai_v2_folder_settings f JOIN pdr_ai_v2_category c ON c.id=f.category_id WHERE f.company_id=$2::bigint AND f.visibility='restricted' AND ($3=c.name OR left($3,length(c.name)+1)=c.name||'/')",
            [id, actor.companyId, row.category]
        );
        const companyReadable = restrictions.length === 0;
        assertPurpose({ purpose, readable: true, companyReadable });
        // Probe at most limit+1 chunks on the server. Do not transfer oversized bodies.
        const [stats] = await query(
            "SELECT count(*) AS chunk_count,COALESCE(sum(octet_length(content)),0)+GREATEST(count(*)-1,0) AS text_bytes,COALESCE(sum(CASE WHEN octet_length(content)<=24000 THEN char_length(content) ELSE 6001 END),0)+GREATEST(count(*)-1,0) AS text_chars FROM (SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 129) bounded_chunks",
            [id, row.version_id]
        );
        const count = Number(stats?.chunk_count ?? 0);
        const textBytes = Number(stats?.text_bytes ?? 0);
        if (
            !count ||
            count > INTERNAL_RETRIEVAL_LIMITS.chunkLimitPerSource ||
            textBytes > INTERNAL_RETRIEVAL_LIMITS.maxSourceBytes ||
            Number(stats?.text_chars ?? 0) > 6000
        )
            throw new WeeklyReviewConflict("source_context_unavailable");
        if (acquisition.loadedTextBytes + textBytes > acquisition.maxLoadedTextBytes)
            throw new WeeklyReviewConflict("acquisition_budget");
        const chunks = await query(
            "SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 129",
            [id, row.version_id]
        );
        const text = chunks.map(chunk => String(chunk.content)).join("\n");
        // Recheck returned size/count; a bound is never permission to truncate evidence.
        if (chunks.length !== count || Buffer.byteLength(text) !== textBytes || !text.trim())
            throw new WeeklyReviewConflict("source_authority_changed");
        acquisition.loadedTextBytes += textBytes;
        return {
            kind: "document",
            id: String(row.id),
            version: databaseText(row.version_id),
            hash: createHash("sha256").update(text, "utf8").digest("hex"),
            purpose,
            text,
            title: databaseText(row.title),
            audience: companyReadable ? "company" : "actor",
            ref: "doc:" + databaseText(row.id) + "@" + databaseText(row.version_id),
        };
    };
}

function reservedSelection(architecture: unknown, required: string[], stars: string[]) {
    if (
        (typeof architecture !== "string" &&
            typeof architecture !== "number" &&
            typeof architecture !== "bigint") ||
        !/^\d+$/.test(String(architecture))
    )
        throw new WeeklyReviewConflict("required_context_incomplete");
    if (required.length > 12 || stars.length > 8)
        throw new WeeklyReviewConflict("context_budget_exceeded");
    const selection = new Map<string, SourcePurpose>([
        [String(architecture), "company-architecture"],
    ]);
    for (const id of required) if (!selection.has(id)) selection.set(id, "workspace-required");
    const mandatoryCount = selection.size;
    for (const id of stars) if (!selection.has(id)) selection.set(id, "personal-star");
    if ([...selection.keys()].some(id => !/^\d+$/.test(id)))
        throw new WeeklyReviewConflict("required_context_incomplete");
    return { selection, mandatoryCount };
}
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
function inputFor(
    identity: ReviewInputIdentity,
    week: string,
    role: string,
    sources: WeeklyReviewSource[],
    mandatoryCount: number
): WeeklyReviewInput {
    return {
        candidateId: identity.candidateId,
        week,
        asOf: identity.asOf,
        role,
        mandatoryCoverage: { required: mandatoryCount, included: mandatoryCount },
        sources,
    };
}

export async function collectInternalWeeklyReviewContext(
    database: WeeklyReviewDatabase,
    fresh: Fresh,
    assertPurpose: PurposeAssertion,
    expected: WeeklyReviewActor,
    week: string,
    identity: ReviewInputIdentity
): Promise<WeeklyReviewContext> {
    return database.transaction(async raw => {
        const { query, acquisition, deadlineAt } = boundedInternalQuery(raw);
        const { actor, epoch } = await fresh(query, expected, false, deadlineAt);
        const periodEnd = Date.parse(week + "T00:00:00.000Z") + 7 * 86400000;
        const asOf = Date.parse(identity.asOf);
        if (!Number.isFinite(periodEnd) || !Number.isFinite(asOf))
            throw new WeeklyReviewConflict("invalid_week", 400);
        const cutoff = new Date(Math.min(asOf, periodEnd)).toISOString();
        const [policy] = await query(
            "SELECT * FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint",
            [actor.companyId]
        );
        const [pref] = await query(
            "SELECT * FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2",
            [actor.companyId, actor.userId]
        );
        const { selection, mandatoryCount } = reservedSelection(
            policy?.architecture_document_id,
            ids(policy?.required_document_ids),
            ids(pref?.star_document_ids)
        );
        const read = createInternalSourceReader(query, actor, acquisition, assertPurpose);
        const sources: WeeklyReviewSource[] = [];
        for (const [id, purpose] of selection) sources.push(await read(id, purpose, cutoff));
        const budget = () =>
            calculateWeeklyReviewBudget(
                inputFor(identity, week, actor.role, sources, mandatoryCount),
                "internal-v1"
            );
        if (!budget().feasible) throw new WeeklyReviewConflict("mandatory_context_budget_exceeded");
        const diagnostics: SelectionDiagnostics = {
            schemaVersion: "vantage-internal-selection/v1",
            cutoff,
            selected: [],
            omitted: [],
            deniedCount: 0,
            budget: budget(),
            mandatoryCoverage: { required: mandatoryCount, included: mandatoryCount },
            acquisition,
        };
        // Reserve mandatory/star IDs before the bounded eligible-version scan. Future-only
        // documents sort last, so current-head churn cannot crowd out historical versions.
        const candidates = await query(
            "SELECT d.id,v.id AS version_id,v.created_at AS version_created_at FROM pdr_ai_v2_document d LEFT JOIN LATERAL (SELECT id,created_at FROM pdr_ai_v2_document_versions WHERE document_id=d.id AND created_at<=$2::timestamptz ORDER BY created_at DESC,id DESC LIMIT 1) v ON true WHERE d.company_id=$1::bigint AND NOT (d.id=ANY($3::bigint[])) ORDER BY v.created_at DESC NULLS LAST,v.id DESC,d.id DESC LIMIT 64",
            [actor.companyId, cutoff, [...selection.keys()]]
        );
        for (const item of candidates) {
            const id = String(item.id);
            try {
                // Always authorize even lower-ranked candidates before adding private diagnostics.
                const source = await read(id, "retrieved", cutoff);
                if (sources.length >= diagnostics.budget.limits.sourceCount) {
                    diagnostics.omitted.push({
                        id,
                        version: source.version,
                        purpose: "retrieved",
                        reason: "ranked_lower",
                        temporalEligibility: "eligible",
                    });
                    continue;
                }
                const next = calculateWeeklyReviewBudget(
                    inputFor(identity, week, actor.role, [...sources, source], mandatoryCount),
                    "internal-v1"
                );
                if (!next.feasible) {
                    diagnostics.omitted.push({
                        id,
                        version: source.version,
                        purpose: "retrieved",
                        reason: "budget_exceeded",
                        temporalEligibility: "eligible",
                    });
                    continue;
                }
                sources.push(source);
            } catch (error) {
                if (!(error instanceof WeeklyReviewConflict)) throw error;
                if (error.code === "source_access_denied") {
                    diagnostics.deniedCount++;
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
                diagnostics.omitted.push({
                    id,
                    ...(item.version_id == null ? {} : { version: databaseText(item.version_id) }),
                    purpose: "retrieved",
                    reason: error.code,
                    temporalEligibility:
                        error.code === "source_version_unavailable" ? "unavailable" : "eligible",
                });
            }
        }
        diagnostics.selected = sources.map(source => ({
            id: source.id,
            version: source.version,
            purpose: source.purpose,
            rationale:
                source.purpose === "retrieved"
                    ? "eligible_version_recency_within_budget"
                    : "reserved_" + source.purpose,
            temporalEligibility: "eligible",
        }));
        diagnostics.budget = budget();
        return {
            actor: expected,
            week,
            sources,
            role: actor.role,
            preferenceVersion: Number(pref?.version ?? 0),
            authorityEpoch: epoch,
            mandatoryCoverage: diagnostics.mandatoryCoverage,
            inputIdentity: identity,
            selectionDiagnostics: diagnostics,
        };
    });
}

/** Configuration validation shares the runtime profile; it is advisory across other
 * actors/versions and never replaces runtime feasibility or current authorization. */
export async function validateInternalConfiguration(
    raw: WeeklyReviewQuery,
    fresh: Fresh,
    assertPurpose: PurposeAssertion,
    expected: WeeklyReviewActor,
    update: { architectureId: string; requiredIds: string[] } | { starIds: string[] }
) {
    const { query, acquisition, deadlineAt } = boundedInternalQuery(raw);
    const { actor } = await fresh(query, expected, true, deadlineAt);
    const company = "architectureId" in update;
    if (company ? actor.canConfigure !== true : !actor.canMutate)
        throw new WeeklyReviewConflict(
            company ? "review_configuration_denied" : "review_mutation_denied",
            403
        );
    const [policy] = await query(
        "SELECT * FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint",
        [actor.companyId]
    );
    const [pref] = await query(
        "SELECT * FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2",
        [actor.companyId, actor.userId]
    );
    const { selection, mandatoryCount } = reservedSelection(
        company ? update.architectureId : policy?.architecture_document_id,
        company ? update.requiredIds : ids(policy?.required_document_ids),
        company ? ids(pref?.star_document_ids) : update.starIds
    );
    const now = new Date().toISOString();
    const read = createInternalSourceReader(query, actor, acquisition, assertPurpose);
    const sources: WeeklyReviewSource[] = [];
    for (const [id, purpose] of selection) sources.push(await read(id, purpose, now));
    const budget = calculateWeeklyReviewBudget(
        inputFor(
            { candidateId: "00000000-0000-4000-8000-000000000000", asOf: now },
            now.slice(0, 10),
            actor.role,
            sources,
            mandatoryCount
        ),
        "internal-v1"
    );
    if (!budget.feasible) throw new WeeklyReviewConflict("mandatory_context_budget_exceeded");
    return sources.filter(source =>
        company ? source.purpose !== "personal-star" : source.purpose === "personal-star"
    );
}
