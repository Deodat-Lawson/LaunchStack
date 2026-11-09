import { createHash } from "node:crypto";
import { scopeAllowsDocument, type DocumentScope } from "~/lib/authz/scope-types";
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
    documentScope: DocumentScope;
};

export function createWeeklyReviewAuthority(
    database: WeeklyReviewDatabase,
    loadActor: () => Promise<WeeklyReviewAuthorityActor>
) {
    async function fresh(query: WeeklyReviewQuery, expected: WeeklyReviewActor) {
        await query(
            "INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES($1::bigint) ON CONFLICT DO NOTHING",
            [expected.companyId]
        );
        const epoch = await query(
            "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=$1::bigint FOR SHARE",
            [expected.companyId]
        );
        const actor = await loadActor();
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
    return {
        async validateCompanySources(
            query: WeeklyReviewQuery,
            expected: WeeklyReviewActor,
            architectureId: string,
            requiredIds: string[]
        ) {
            const { actor } = await fresh(query, expected);
            if (!actor.canMutate) throw new WeeklyReviewConflict("review_mutation_denied", 403);
            if (requiredIds.length > 12) throw new WeeklyReviewConflict("context_budget_exceeded");
            const sources = [
                await readDocument(query, actor, architectureId, null, "company-architecture"),
            ];
            for (const id of [...new Set(requiredIds)].filter(id => id !== architectureId))
                sources.push(await readDocument(query, actor, id, null, "workspace-required"));
            return sources;
        },
        async listReadableDocuments(expected: WeeklyReviewActor) {
            return database.transaction(async query => {
                const { actor } = await fresh(query, expected);
                const rows = await query(
                    "SELECT id,title,category FROM pdr_ai_v2_document WHERE company_id=$1::bigint ORDER BY id DESC LIMIT 500",
                    [actor.companyId]
                );
                return rows
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
            });
        },
        async collectWeeklyReviewContext(
            expected: WeeklyReviewActor,
            week: string
        ): Promise<WeeklyReviewContext> {
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
        async assertCurrentWeeklyReviewAuthority(
            query: WeeklyReviewQuery,
            expected: WeeklyReviewActor,
            dependencies: FrozenDependency[],
            phase: "prepare" | "dispatch" | "activation" | "read" | "decision" | "recovery" = "read"
        ) {
            const { actor, epoch } = await fresh(query, expected);
            if (
                (phase === "dispatch" || phase === "activation") &&
                (!expected.authorityEpoch || expected.authorityEpoch !== epoch)
            )
                throw new WeeklyReviewConflict("source_authority_changed");
            if (phase !== "read" && !actor.canMutate)
                throw new WeeklyReviewConflict("review_mutation_denied", 403);
            if (phase === "recovery") return;
            const current: FrozenDependency[] = [];
            for (const dependency of dependencies)
                current.push(
                    await readDocument(
                        query,
                        actor,
                        dependency.id,
                        dependency.version,
                        dependency.purpose
                    )
                );
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
