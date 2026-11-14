import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import { z } from "zod";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import {
    compileScopedEvidence,
    SCOPED_EVIDENCE_LIMITS,
    type PreparedScopedEvidence,
    type ScopedAuthority,
    type ScopedEvidenceRequest,
    type ScopedParent,
} from "@launchstack/pipelines/vantage/scoped-evidence";
import type { WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import type { boundedInternalQuery } from "./weekly-review-internal-selection";
import {
    WeeklyReviewConflict,
    type FrozenDependency,
    type SourcePurpose,
    type WeeklyReviewQuery,
    type WeeklyReviewSource,
} from "./weekly-review-types";

const id = z.string().regex(/^[1-9]\d{0,17}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const WeeklyReviewSourceScopeSchema = z
    .object({
        version: id,
        expectedParentHash: digest,
        qualification: z.string().trim().min(1).max(500),
        requiredUnits: z
            .array(
                z
                    .object({
                        id: z.string().min(1).max(200),
                        start: z.number().int().nonnegative(),
                        end: z.number().int().positive(),
                        excerptHash: digest,
                    })
                    .strict()
            )
            .min(1)
            .max(SCOPED_EVIDENCE_LIMITS.units),
    })
    .strict();
export const WeeklyReviewSourceScopesSchema = z.record(id, WeeklyReviewSourceScopeSchema);
export type WeeklyReviewSourceScopes = z.infer<typeof WeeklyReviewSourceScopesSchema>;
export type WeeklyReviewSourceScope = z.infer<typeof WeeklyReviewSourceScopeSchema>;
type Acquisition = ReturnType<typeof boundedInternalQuery>["acquisition"];
type PurposeAssertion = (input: {
    purpose: SourcePurpose;
    readable: boolean;
    companyReadable: boolean;
}) => void;

export function configuredSourceScopes(
    value: unknown,
    allowedIds: string[]
): WeeklyReviewSourceScopes {
    const parsed = WeeklyReviewSourceScopesSchema.safeParse(value ?? {});
    if (!parsed.success || Object.keys(parsed.data).some(key => !allowedIds.includes(key)))
        throw new WeeklyReviewConflict("invalid_source_scopes", 400);
    return parsed.data;
}

/** Omitted scope fields preserve surviving configuration when the ID editor changes IDs. */
export function retainedSourceScopes(value: unknown, allowedIds: string[]) {
    const parsed = WeeklyReviewSourceScopesSchema.safeParse(value ?? {});
    if (!parsed.success) throw new WeeklyReviewConflict("invalid_source_scopes", 400);
    return Object.fromEntries(
        Object.entries(parsed.data).filter(([key]) => allowedIds.includes(key))
    );
}

const instant = (value: unknown): string => {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime()))
        throw new WeeklyReviewConflict("source_version_unavailable");
    return date.toISOString();
};

/** A full exact canonical parent is bounded in SQL before any body is transferred. */
export function createScopedSourceReader(
    query: WeeklyReviewQuery,
    actor: WeeklyReviewAuthorityActor,
    acquisition: Acquisition,
    assertPurpose: PurposeAssertion,
    aclRevision: string
) {
    return async (
        documentId: string,
        purpose: SourcePurpose,
        cutoff: string,
        scope: WeeklyReviewSourceScope,
        authorityRevision: string,
        frozen?: NonNullable<FrozenDependency["scope"]>,
        historical = false
    ) => {
        const request: ScopedEvidenceRequest = frozen?.request ?? {
            actorId: actor.userId,
            companyId: actor.companyId,
            documentId,
            version: scope.version,
            asOf: cutoff,
            expectedParentHash: scope.expectedParentHash,
            selectedUnitIds: scope.requiredUnits.map(unit => unit.id),
        };
        if (
            request.actorId !== actor.userId ||
            request.companyId !== actor.companyId ||
            request.documentId !== documentId ||
            request.version !== scope.version
        )
            throw new WeeklyReviewConflict("source_authority_changed", 403);
        const rows = await query(
            "SELECT d.id,CASE WHEN octet_length(d.title)<=1200 THEN d.title ELSE NULL END AS title,d.category,v.id AS version_id,v.created_at AS version_created_at FROM pdr_ai_v2_document d LEFT JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id AND v.id=$3::bigint AND v.created_at<=$4::timestamptz WHERE d.company_id=$1::bigint AND d.id=$2::bigint",
            [actor.companyId, documentId, scope.version, request.asOf]
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
        if (row.version_id == null) throw new WeeklyReviewConflict("source_version_unavailable");
        const createdAt = instant(row.version_created_at);
        if (Date.parse(createdAt) > Date.parse(request.asOf))
            throw new WeeklyReviewConflict("source_version_unavailable");
        if (typeof row.title !== "string" || row.title.length > 300)
            throw new WeeklyReviewConflict("source_context_unavailable");
        const restrictions = await query(
            "SELECT 1 AS restricted FROM pdr_ai_v2_document_settings WHERE document_id=$1::bigint AND restricted=true UNION ALL SELECT 1 FROM pdr_ai_v2_folder_settings f JOIN pdr_ai_v2_category c ON c.id=f.category_id WHERE f.company_id=$2::bigint AND f.visibility='restricted' AND ($3=c.name OR left($3,length(c.name)+1)=c.name||'/')",
            [documentId, actor.companyId, row.category]
        );
        const companyReadable = restrictions.length === 0;
        assertPurpose({ purpose, readable: true, companyReadable });
        const [stats] = await query(
            "SELECT count(*) AS chunk_count,COALESCE(sum(octet_length(content)),0)+GREATEST(count(*)-1,0) AS text_bytes FROM (SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 1025) bounded_scoped_chunks",
            [documentId, scope.version]
        );
        const count = Number(stats?.chunk_count ?? 0);
        const bytes = Number(stats?.text_bytes ?? 0);
        if (
            !count ||
            count > SCOPED_EVIDENCE_LIMITS.chunks ||
            bytes > SCOPED_EVIDENCE_LIMITS.parentBytes
        )
            throw new WeeklyReviewConflict("source_context_unavailable");
        const remaining = acquisition.maxLoadedTextBytes - acquisition.loadedTextBytes;
        if (bytes > remaining) throw new WeeklyReviewConflict("acquisition_budget");
        // Recheck the aggregate bound in the body query as well, covering concurrent reindexing.
        const chunks = await query(
            "SELECT id,CASE WHEN count(*) OVER()<=1024 AND sum(octet_length(content)) OVER()+GREATEST(count(*) OVER()-1,0)<=$3 THEN content ELSE NULL END AS content FROM (SELECT id,content,page_number,line_start FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 1025) bounded_scoped_chunks ORDER BY page_number,line_start,id",
            [documentId, scope.version, Math.min(remaining, SCOPED_EVIDENCE_LIMITS.parentBytes)]
        );
        if (chunks.length !== count || chunks.some(chunk => typeof chunk.content !== "string"))
            throw new WeeklyReviewConflict("source_authority_changed");
        const text = chunks.map(chunk => String(chunk.content)).join("\n");
        if (Buffer.byteLength(text) !== bytes || !text.trim())
            throw new WeeklyReviewConflict("source_authority_changed");
        acquisition.loadedTextBytes += bytes;
        const parent: ScopedParent = {
            companyId: actor.companyId,
            documentId,
            version: scope.version,
            versionDate: createdAt,
            availableAt: createdAt,
            title: row.title,
            purpose,
            chunks: chunks.map((chunk, ordinal) => ({
                id: String(chunk.id),
                ordinal,
                text: String(chunk.content),
            })),
            originalCompleteness: "unknown",
        };
        const authority: ScopedAuthority = {
            actorId: actor.userId,
            companyId: actor.companyId,
            documentId,
            version: scope.version,
            authorized: true,
            purpose,
            // Current ACL and purpose were checked above. Historical citation identity
            // retains its captured audience while exact parent and unit checks still run.
            audience:
                historical && frozen
                    ? frozen.dependency.audience
                    : companyReadable
                      ? "company"
                      : "actor",
            companyReadable:
                historical && frozen ? frozen.dependency.companyReadable : companyReadable,
            aclRevision: frozen?.dependency.aclRevision ?? aclRevision,
            authorityRevision,
            finiteScope: { qualification: scope.qualification, requiredUnits: scope.requiredUnits },
        };
        let prepared: PreparedScopedEvidence;
        try {
            prepared = compileScopedEvidence(request, parent, authority);
            if (frozen && fingerprint(prepared.dependency) !== fingerprint(frozen.dependency))
                throw new Error("scoped_dependency_changed");
        } catch {
            throw new WeeklyReviewConflict("source_authority_changed", 409);
        }
        const dependency: FrozenDependency = {
            kind: "scoped-document",
            id: documentId,
            version: scope.version,
            hash: prepared.dependency.parentHash,
            purpose,
            scope: { request: prepared.request, dependency: prepared.dependency },
        };
        const sources: WeeklyReviewSource[] = prepared.modelFacingProjection.sources.map(unit => ({
            kind: "document",
            id: documentId,
            version: scope.version,
            hash: unit.hash,
            purpose,
            ref: unit.ref,
            text: unit.text,
            title: unit.title,
            audience: unit.audience,
        }));
        return { sources, dependency, descriptor: prepared.dependency };
    };
}
