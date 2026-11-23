import {
    configuredSourceScopes,
    createScopedSourceReader,
    type WeeklyReviewSourceScopes,
} from "./weekly-review-scoped-selection";
import { createHash } from "node:crypto";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import {
    calculateWeeklyReviewBudget,
    type WeeklyReviewInput,
} from "@launchstack/pipelines/vantage/weekly-review-v21";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import { parseConfirmedBusinessRole } from "./weekly-review-business-role";
import { collectTopicSeed } from "./weekly-review-topic-seed";
import {
    TOPIC_FIRST_LIMITS,
    type TopicManifest,
    type TopicProvider,
} from "./weekly-review-topic-types";
import {
    WeeklyReviewConflict,
    type SourcePurpose,
    type FrozenDependency,
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
export function boundedInternalQuery(raw: WeeklyReviewQuery, topicFirst = false) {
    const startedAt = Date.now();
    const acquisition: Acquisition = {
        candidateLimit: INTERNAL_RETRIEVAL_LIMITS.candidateLimit,
        chunkLimitPerSource: INTERNAL_RETRIEVAL_LIMITS.chunkLimitPerSource,
        loadedTextBytes: 0,
        maxLoadedTextBytes: topicFirst
            ? TOPIC_FIRST_LIMITS.loadedParentBytes
            : INTERNAL_RETRIEVAL_LIMITS.maxLoadedTextBytes,
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
    query.executor = raw.executor;
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
    mandatoryCount: number,
    scopedEvidence?: WeeklyReviewContext["scopedEvidence"]
): WeeklyReviewInput {
    return {
        candidateId: identity.candidateId,
        week,
        asOf: identity.asOf,
        role,
        mandatoryCoverage: { required: mandatoryCount, included: mandatoryCount },
        sources,
        ...(scopedEvidence?.length ? { scopedEvidence } : {}),
    };
}

export async function collectInternalWeeklyReviewContext(
    database: WeeklyReviewDatabase,
    fresh: Fresh,
    assertPurpose: PurposeAssertion,
    expected: WeeklyReviewActor,
    week: string,
    identity: ReviewInputIdentity,
    scopedEnabled = false,
    topic?: {
        provider: TopicProvider;
        expectedActiveId: string | null;
        carryover(query: WeeklyReviewQuery): Promise<TopicManifest["carryover"]>;
    }
): Promise<WeeklyReviewContext> {
    return database.transaction(async raw => {
        if (topic) await raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const { query, acquisition, deadlineAt } = boundedInternalQuery(raw, Boolean(topic));
        const { actor, epoch } = await fresh(query, expected, false, deadlineAt);
        if (topic && !actor.canMutate)
            throw new WeeklyReviewConflict("review_mutation_denied", 403);
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
        const dependencies: FrozenDependency[] = [];
        const scopedEvidence: NonNullable<WeeklyReviewContext["scopedEvidence"]> = [];
        const companyIds = [
            String(policy?.architecture_document_id),
            ...ids(policy?.required_document_ids),
        ];
        const companyScopes = scopedEnabled
            ? configuredSourceScopes(policy?.required_source_scopes, companyIds)
            : {};
        const starScopes = scopedEnabled
            ? configuredSourceScopes(pref?.star_source_scopes, ids(pref?.star_document_ids))
            : {};
        const readScoped = createScopedSourceReader(
            query,
            actor,
            acquisition,
            assertPurpose,
            epoch
        );
        for (const [id, purpose] of selection) {
            const scope = purpose === "personal-star" ? starScopes[id] : companyScopes[id];
            if (scope) {
                const result = await readScoped(
                    id,
                    purpose,
                    cutoff,
                    scope,
                    purpose === "personal-star"
                        ? "preferences:" + databaseText(pref?.version ?? 0)
                        : "policy:" + databaseText(policy?.version ?? 0)
                );
                sources.push(...result.sources);
                dependencies.push(result.dependency);
                scopedEvidence.push(result.descriptor);
            } else {
                const source = await read(id, purpose, cutoff);
                sources.push(source);
                dependencies.push(source);
            }
        }
        if (topic) {
            const context: WeeklyReviewContext = {
                actor: expected,
                week,
                role: actor.role,
                sources,
                preferenceVersion: Number(pref?.version ?? 0),
                authorityEpoch: epoch,
                mandatoryCoverage: { required: mandatoryCount, included: mandatoryCount },
                dependencies: dependencies.map(({ kind, id, version, hash, purpose, scope }) => ({
                    kind,
                    id,
                    version,
                    hash,
                    purpose,
                    ...(scope ? { scope } : {}),
                })),
                inputIdentity: identity,
                ...(scopedEvidence.length ? { scopedEvidence } : {}),
            };
            const seed = await collectTopicSeed(query, actor, context, {
                cutoff,
                asOf: identity.asOf,
                policyRevision: Number(policy?.version ?? 0),
                roleRevision:
                    parseConfirmedBusinessRole(pref?.business_role_context, actor)?.revision ??
                    null,
                expectedActiveId: topic.expectedActiveId,
                configuration: { provider: topic.provider, scoped: scopedEnabled },
                carryover: await topic.carryover(query),
            });
            return { ...context, topicSeed: seed };
        }
        throw new WeeklyReviewConflict("topic_seed_required");
    });
}

/** Configuration validation shares the runtime profile; it is advisory across other
 * actors/versions and never replaces runtime feasibility or current authorization. */
export async function validateInternalConfiguration(
    raw: WeeklyReviewQuery,
    fresh: Fresh,
    assertPurpose: PurposeAssertion,
    expected: WeeklyReviewActor,
    update:
        | { architectureId: string; requiredIds: string[]; scopes?: WeeklyReviewSourceScopes }
        | { starIds: string[]; scopes?: WeeklyReviewSourceScopes },
    scopedEnabled = false
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
    const companyIds = [
        String(company ? update.architectureId : policy?.architecture_document_id),
        ...(company ? update.requiredIds : ids(policy?.required_document_ids)),
    ];
    const companyScopes = scopedEnabled
        ? configuredSourceScopes(
              company ? update.scopes : policy?.required_source_scopes,
              companyIds
          )
        : {};
    const starScopes = scopedEnabled
        ? configuredSourceScopes(
              company ? pref?.star_source_scopes : update.scopes,
              company ? ids(pref?.star_document_ids) : update.starIds
          )
        : {};
    if (!company && Object.keys(starScopes).some(id => companyIds.includes(id)))
        throw new WeeklyReviewConflict("personal_scope_cannot_narrow_required", 400);
    const scopedEvidence: NonNullable<WeeklyReviewContext["scopedEvidence"]> = [];
    const readScoped = createScopedSourceReader(
        query,
        actor,
        acquisition,
        assertPurpose,
        "configuration"
    );
    for (const [id, purpose] of selection) {
        const scope = purpose === "personal-star" ? starScopes[id] : companyScopes[id];
        if (scope) {
            const result = await readScoped(id, purpose, now, scope, "configuration");
            sources.push(...result.sources);
            scopedEvidence.push(result.descriptor);
        } else sources.push(await read(id, purpose, now));
    }
    // Production internal selection creates topic-first runs. Configuration has no
    // exploration result yet, so preview fixed evidence with a minimal valid context.
    // Runtime freeze still checks its actual topics, backfill and prepared transport.
    const preview: WeeklyReviewInput = {
        ...inputFor(
            { candidateId: "00000000-0000-4000-8000-000000000000", asOf: now },
            now.slice(0, 10),
            actor.role,
            sources,
            mandatoryCount,
            scopedEvidence
        ),
        retrievalContext: {
            schemaVersion: "vantage-topic-retrieval/v1",
            mode: "topic-first",
            guidanceLabel: "owner notes, not evidence",
            topics: [],
            seedReasons: [],
            lane: { outcome: "none_eligible", candidates: 0, admitted: 0 },
            traceHash: "0".repeat(64),
        },
    };
    const budget = calculateWeeklyReviewBudget(preview, "topic-first");
    if (!budget.feasible) throw new WeeklyReviewConflict("mandatory_context_budget_exceeded");
    return sources.filter(source =>
        company ? source.purpose !== "personal-star" : source.purpose === "personal-star"
    );
}
