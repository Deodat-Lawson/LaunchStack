import {
    createScopedSourceReader,
    type WeeklyReviewSourceScopes,
} from "./weekly-review-scoped-selection";
import { createHash } from "node:crypto";
import type { DynamicRetrievalConfiguration } from "./weekly-review-dynamic-retrieval";
import { scopeAllowsDocument, type DocumentScope } from "~/lib/authz/scope-types";
import {
    boundedInternalQuery,
    collectInternalWeeklyReviewContext,
    createInternalSourceReader,
    validateInternalConfiguration,
    type ReviewInputIdentity,
} from "./weekly-review-internal-selection";
import {
    WeeklyReviewConflict,
    type FrozenDependency,
    type SourcePurpose,
    type WeeklyReviewActor,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
    type WeeklyReviewSource,
    type WeeklyReviewContext,
} from "./weekly-review-types";

function sourceId(value: unknown): string {
    if (
        (typeof value === "string" && /^\d+$/.test(value)) ||
        (typeof value === "number" && Number.isSafeInteger(value)) ||
        typeof value === "bigint"
    )
        return String(value);
    throw new WeeklyReviewConflict("required_context_incomplete");
}

export function sourceHash(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

// Source permissions are reconstructed for every boundary, never retained from
// the preparing HTTP request. The epoch lock prevents covered ACL writes from
// committing while fresh scope and exact frozen content are checked.
export type WeeklyReviewAuthorityActor = WeeklyReviewActor & {
    role: string;
    canRead: boolean;
    canMutate: boolean;
    canConfigure?: boolean;
    documentScope: DocumentScope;
};

export function createWeeklyReviewAuthority(
    database: WeeklyReviewDatabase,
    loadActor: () => Promise<WeeklyReviewAuthorityActor>,
    options: {
        internalRetrievalV1?: boolean;
        scopedEvidenceV2?: boolean;
        dynamicRetrieval?: DynamicRetrievalConfiguration;
    } = {}
) {
    async function fresh(
        query: WeeklyReviewQuery,
        expected: WeeklyReviewActor,
        configurationWrite = false,
        actorDeadline?: number
    ) {
        await query(
            "INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES($1::bigint) ON CONFLICT DO NOTHING",
            [expected.companyId]
        );
        const epoch = await query(
            "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=$1::bigint " +
                (configurationWrite ? "FOR UPDATE" : "FOR SHARE"),
            [expected.companyId]
        );
        let actorTimer: ReturnType<typeof setTimeout> | undefined;
        const remaining = actorDeadline === undefined ? undefined : actorDeadline - Date.now();
        if (remaining !== undefined && remaining <= 0)
            throw new WeeklyReviewConflict("retrieval_acquisition_timeout", 503);
        // Reject and release the epoch transaction when a separate auth read stalls.
        // The pending read itself cannot be cancelled by this adapter.
        const actor =
            remaining === undefined
                ? await loadActor()
                : await Promise.race([
                      loadActor(),
                      new Promise<never>((_, reject) => {
                          actorTimer = setTimeout(
                              () =>
                                  reject(
                                      new WeeklyReviewConflict("retrieval_acquisition_timeout", 503)
                                  ),
                              remaining
                          );
                      }),
                  ]).finally(() => {
                      if (actorTimer) clearTimeout(actorTimer);
                  });
        if (
            actor.companyId !== expected.companyId ||
            actor.userId !== expected.userId ||
            !actor.canRead
        )
            throw new WeeklyReviewConflict("review_access_denied", 403);
        return { actor, epoch: String(epoch[0]!.version) };
    }
    async function readDocument(
        query: WeeklyReviewQuery,
        actor: WeeklyReviewAuthorityActor,
        id: string,
        version: string | null,
        purpose: SourcePurpose,
        cutoff?: string
    ) {
        const rows = await query(
            "SELECT d.id,d.title,d.category,v.id AS version_id FROM pdr_ai_v2_document d JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id AND (($3::bigint IS NOT NULL AND v.id=$3::bigint) OR ($3::bigint IS NULL AND v.created_at<=$4::timestamptz)) WHERE d.company_id=$1::bigint AND d.id=$2::bigint ORDER BY v.created_at DESC,v.id DESC LIMIT 1",
            [actor.companyId, id, version, cutoff ?? new Date().toISOString()]
        );
        const row = rows[0];
        if (
            !row ||
            !scopeAllowsDocument(actor.documentScope, {
                id: Number(row.id),
                category: String(row.category),
            })
        )
            throw new WeeklyReviewConflict("source_access_denied", 403);
        const restrictions = await query(
            "SELECT 1 AS restricted FROM pdr_ai_v2_document_settings WHERE document_id=$1::bigint AND restricted=true UNION ALL SELECT 1 FROM pdr_ai_v2_folder_settings f JOIN pdr_ai_v2_category c ON c.id=f.category_id WHERE f.company_id=$2::bigint AND f.visibility='restricted' AND ($3=c.name OR left($3,length(c.name)+1)=c.name||'/')",
            [id, actor.companyId, row.category]
        );
        const companyReadable = restrictions.length === 0;
        assertSourcePurpose({ purpose, readable: true, companyReadable });
        const chunks = await query(
            "SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id",
            [id, row.version_id]
        );
        const text = chunks.map(chunk => String(chunk.content)).join("\n");
        if (!text.trim() || Buffer.byteLength(text) > 24000)
            throw new WeeklyReviewConflict("source_context_unavailable");
        const source = {
            kind: "document" as const,
            id: String(row.id),
            version: String(row.version_id),
            hash: sourceHash(text),
            purpose,
            text,
            title: String(row.title),
            audience: companyReadable ? ("company" as const) : ("actor" as const),
        };
        return { ...source, ref: "doc:" + source.id + "@" + source.version };
    }
    async function withReadableDocuments<T>(
        expected: WeeklyReviewActor,
        read: (
            query: WeeklyReviewQuery,
            documents: { id: string; title: string; category: string }[],
            actor: WeeklyReviewAuthorityActor
        ) => Promise<T>
    ): Promise<T> {
        return database.transaction(async query => {
            const { actor } = await fresh(query, expected);
            const rows = await query(
                "SELECT id,title,category FROM pdr_ai_v2_document WHERE company_id=$1::bigint ORDER BY id DESC LIMIT 500",
                [actor.companyId]
            );
            const documents = rows
                .filter(row =>
                    scopeAllowsDocument(actor.documentScope, {
                        id: Number(row.id),
                        category: String(row.category),
                    })
                )
                .map(row => ({
                    id: String(row.id),
                    title: String(row.title),
                    category: String(row.category),
                }));
            return read(query, documents, actor);
        });
    }
    return {
        withReadableDocuments,
        async validateCompanySources(
            query: WeeklyReviewQuery,
            expected: WeeklyReviewActor,
            architectureId: string,
            requiredIds: string[],
            scopes: WeeklyReviewSourceScopes = {}
        ) {
            if (
                Object.keys(scopes).length &&
                !(options.internalRetrievalV1 && options.scopedEvidenceV2)
            )
                throw new WeeklyReviewConflict("scoped_evidence_disabled", 404);
            if (options.internalRetrievalV1)
                return validateInternalConfiguration(
                    query,
                    fresh,
                    assertSourcePurpose,
                    expected,
                    {
                        architectureId,
                        requiredIds,
                        scopes,
                    },
                    options.scopedEvidenceV2
                );
            const { actor } = await fresh(query, expected, true);
            if (actor.canConfigure !== true)
                throw new WeeklyReviewConflict("review_configuration_denied", 403);
            if (requiredIds.length > 12) throw new WeeklyReviewConflict("context_budget_exceeded");
            const sources = [
                await readDocument(query, actor, architectureId, null, "company-architecture"),
            ];
            for (const id of [...new Set(requiredIds)].filter(id => id !== architectureId))
                sources.push(await readDocument(query, actor, id, null, "workspace-required"));
            return sources;
        },
        async validatePreferenceSources(
            query: WeeklyReviewQuery,
            expected: WeeklyReviewActor,
            starIds: string[],
            scopes: WeeklyReviewSourceScopes = {}
        ) {
            if (
                Object.keys(scopes).length &&
                !(options.internalRetrievalV1 && options.scopedEvidenceV2)
            )
                throw new WeeklyReviewConflict("scoped_evidence_disabled", 404);
            if (options.internalRetrievalV1)
                return validateInternalConfiguration(
                    query,
                    fresh,
                    assertSourcePurpose,
                    expected,
                    {
                        starIds,
                        scopes,
                    },
                    options.scopedEvidenceV2
                );
            const { actor } = await fresh(query, expected, true);
            if (!actor.canMutate) throw new WeeklyReviewConflict("review_mutation_denied", 403);
            if (starIds.length > 8) throw new WeeklyReviewConflict("context_budget_exceeded");
            const sources: WeeklyReviewSource[] = [];
            for (const id of new Set(starIds))
                sources.push(await readDocument(query, actor, id, null, "personal-star"));
            return sources;
        },
        async listReadableDocuments(expected: WeeklyReviewActor) {
            return withReadableDocuments(expected, async (_query, documents) => documents);
        },
        async collectWeeklyReviewContext(
            expected: WeeklyReviewActor,
            week: string,
            identity?: ReviewInputIdentity,
            topic?: Parameters<typeof collectInternalWeeklyReviewContext>[8]
        ): Promise<WeeklyReviewContext> {
            if (
                options.dynamicRetrieval?.mode &&
                options.dynamicRetrieval.mode !== "baseline" &&
                !options.internalRetrievalV1
            )
                throw new WeeklyReviewConflict("dynamic_retrieval_requires_internal_v1");
            if (options.internalRetrievalV1) {
                if (!identity) throw new WeeklyReviewConflict("review_input_identity_required");
                return collectInternalWeeklyReviewContext(
                    database,
                    fresh,
                    assertSourcePurpose,
                    expected,
                    week,
                    identity,
                    options.scopedEvidenceV2,
                    options.dynamicRetrieval,
                    topic
                );
            }
            return database.transaction(async query => {
                const { actor, epoch } = await fresh(query, expected);
                const periodEnd = new Date(week + "T00:00:00.000Z");
                periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
                if (!Number.isFinite(periodEnd.getTime()))
                    throw new WeeklyReviewConflict("invalid_week", 400);
                const cutoff = new Date(Math.min(Date.now(), periodEnd.getTime())).toISOString();
                const policy = (
                    await query(
                        "SELECT * FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint",
                        [actor.companyId]
                    )
                )[0];
                if (!policy?.architecture_document_id)
                    throw new WeeklyReviewConflict("required_context_incomplete");
                const pref = (
                    await query(
                        "SELECT * FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2",
                        [actor.companyId, actor.userId]
                    )
                )[0];
                const required = Array.isArray(policy.required_document_ids)
                    ? policy.required_document_ids.map(String)
                    : [];
                const stars = Array.isArray(pref?.star_document_ids)
                    ? pref.star_document_ids.map(String)
                    : [];
                if (required.length > 12 || stars.length > 8)
                    throw new WeeklyReviewConflict("context_budget_exceeded");
                const selection = new Map<string, SourcePurpose>([
                    [sourceId(policy.architecture_document_id), "company-architecture"],
                ]);
                required.forEach(id => {
                    if (!selection.has(id)) selection.set(id, "workspace-required");
                });
                const mandatoryCount = selection.size;
                stars.forEach(id => {
                    if (!selection.has(id)) selection.set(id, "personal-star");
                });
                const optional = await query(
                    "SELECT id FROM pdr_ai_v2_document WHERE company_id=$1::bigint ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT 20",
                    [actor.companyId]
                );
                const sources: WeeklyReviewSource[] = [];
                for (const [id, purpose] of selection)
                    sources.push(await readDocument(query, actor, id, null, purpose, cutoff));
                for (const item of optional) {
                    if (sources.length >= 16) break;
                    const id = String(item.id);
                    if (selection.has(id)) continue;
                    try {
                        sources.push(
                            await readDocument(query, actor, id, null, "retrieved", cutoff)
                        );
                    } catch (error) {
                        if (!(error instanceof WeeklyReviewConflict)) throw error;
                    }
                }
                if (Buffer.byteLength(JSON.stringify(sources)) > 60000)
                    throw new WeeklyReviewConflict("context_budget_exceeded");
                return {
                    actor: expected,
                    week,
                    sources,
                    role: actor.role,
                    preferenceVersion: Number(pref?.version ?? 0),
                    authorityEpoch: epoch,
                    mandatoryCoverage: {
                        required: mandatoryCount,
                        included: mandatoryCount,
                    },
                };
            });
        },
        async withTopicSourceReader<T>(
            query: WeeklyReviewQuery,
            expected: WeeklyReviewActor,
            work: (read: ReturnType<typeof createScopedSourceReader>) => Promise<T>
        ): Promise<T> {
            const bounded = boundedInternalQuery(query, true);
            const { actor, epoch } = await fresh(
                bounded.query,
                expected,
                false,
                bounded.deadlineAt
            );
            if (!actor.canMutate) throw new WeeklyReviewConflict("review_mutation_denied", 403);
            if (expected.authorityEpoch !== epoch)
                throw new WeeklyReviewConflict("source_authority_changed");
            return work(
                createScopedSourceReader(
                    bounded.query,
                    actor,
                    bounded.acquisition,
                    assertSourcePurpose,
                    epoch
                )
            );
        },
        async assertCurrentWeeklyReviewAuthority(
            query: WeeklyReviewQuery,
            expected: WeeklyReviewActor,
            dependencies: FrozenDependency[],
            phase:
                | "prepare"
                | "dispatch"
                | "activation"
                | "read"
                | "decision"
                | "recovery"
                | "exploration" = "read"
        ) {
            // New acquisition limits govern new candidates. Historical reads and
            // decisions retain the established exact-frozen-dependency reader.
            const bounded =
                dependencies.some(dependency => dependency.kind === "scoped-document") ||
                (options.internalRetrievalV1 && phase !== "read" && phase !== "decision")
                    ? boundedInternalQuery(
                          query,
                          dependencies.some(dep =>
                              dep.scope?.dependency.authorityRevision.startsWith("topic-first:")
                          )
                      )
                    : null;
            if (bounded) query = bounded.query;
            const { actor, epoch } = await fresh(query, expected, false, bounded?.deadlineAt);
            if (
                (phase === "dispatch" || phase === "activation" || phase === "exploration") &&
                (!expected.authorityEpoch || expected.authorityEpoch !== epoch)
            )
                throw new WeeklyReviewConflict("source_authority_changed");
            if (phase !== "read" && !actor.canMutate)
                throw new WeeklyReviewConflict("review_mutation_denied", 403);
            if (phase === "recovery" || phase === "exploration") return;
            const current: FrozenDependency[] = [];
            const read = bounded
                ? createInternalSourceReader(query, actor, bounded.acquisition, assertSourcePurpose)
                : null;
            const readScoped = bounded
                ? createScopedSourceReader(
                      query,
                      actor,
                      bounded.acquisition,
                      assertSourcePurpose,
                      epoch
                  )
                : null;
            for (const dependency of dependencies) {
                if (dependency.kind === "scoped-document") {
                    if (
                        !dependency.scope ||
                        !readScoped ||
                        dependency.scope.dependency.documentId !== dependency.id ||
                        dependency.scope.dependency.parentVersion !== dependency.version ||
                        dependency.scope.dependency.parentHash !== dependency.hash ||
                        dependency.scope.dependency.purpose !== dependency.purpose
                    )
                        throw new WeeklyReviewConflict("source_authority_changed", 403);
                    const frozen = dependency.scope;
                    const result = await readScoped(
                        dependency.id,
                        dependency.purpose,
                        frozen.request.asOf,
                        {
                            version: dependency.version,
                            expectedParentHash: dependency.hash,
                            qualification: frozen.dependency.coverage.qualification,
                            requiredUnits: frozen.dependency.requiredUnits,
                        },
                        frozen.dependency.authorityRevision,
                        frozen,
                        phase === "read" || phase === "decision"
                    );
                    current.push(result.dependency);
                    continue;
                }
                current.push(
                    read
                        ? await read(
                              dependency.id,
                              dependency.purpose,
                              new Date().toISOString(),
                              dependency.version
                          )
                        : await readDocument(
                              query,
                              actor,
                              dependency.id,
                              dependency.version,
                              dependency.purpose
                          )
                );
            }
            assertFrozenSources(dependencies, current);
        },
    };
}

/** Selection never grants access. Company purpose requires independently resolved audience. */
export function assertSourcePurpose(input: {
    purpose: SourcePurpose;
    readable: boolean;
    companyReadable: boolean;
}): void {
    if (!input.readable) throw new WeeklyReviewConflict("source_access_denied", 403);
    if (
        (input.purpose === "company-architecture" || input.purpose === "workspace-required") &&
        !input.companyReadable
    )
        throw new WeeklyReviewConflict("required_context_audience", 409);
}
/** Recheck frozen identities, not mutable current heads or unrelated preferences. */
export function assertFrozenSources(
    expected: FrozenDependency[],
    current: FrozenDependency[]
): void {
    if (!expected.length) throw new WeeklyReviewConflict("required_context_incomplete");
    const map = new Map(
        current.map(source => [source.kind + ":" + source.id + "@" + source.version, source])
    );
    for (const source of expected) {
        const found = map.get(source.kind + ":" + source.id + "@" + source.version);
        if (!found || found.hash !== source.hash)
            throw new WeeklyReviewConflict("source_authority_changed", 403);
    }
}
