import { z } from "zod";
import {
    hashScopedText,
    SCOPED_EVIDENCE_LIMITS,
} from "@launchstack/pipelines/vantage/scoped-evidence";
import type { WeeklyReviewInput } from "@launchstack/pipelines/vantage/weekly-review-v21";
import { scopeAllowsDocument } from "~/lib/authz/scope-types";
import { assertSourcePurpose, type WeeklyReviewAuthorityActor } from "./weekly-review-authority";
import { boundedInternalQuery } from "./weekly-review-internal-selection";
import { WeeklyReviewSourceScopeSchema } from "./weekly-review-scoped-selection";
import {
    WeeklyReviewConflict,
    type WeeklyReviewActor,
    type WeeklyReviewDatabase,
    type WeeklyReviewQuery,
} from "./weekly-review-types";

const documentId = z.string().regex(/^[1-9]\d{0,17}$/);
export const ContextSourceInspectionSchema = z
    .object({
        documentId,
        purpose: z.enum(["company-architecture", "workspace-required", "personal-star"]),
        version: documentId.optional(),
    })
    .strict();
export type ContextSourceInspection = z.infer<typeof ContextSourceInspectionSchema>;
export const EvidenceInspectionSchema = z
    .object({
        id: z.string().uuid(),
        ref: z.string().min(1).max(300),
    })
    .strict();

/** The caller must first obtain this evidence through repository.get's current authority checks. */
export function inspectFrozenEvidence(evidence: unknown, ref: string) {
    const snapshot = (evidence as { inputSnapshot?: WeeklyReviewInput } | null)?.inputSnapshot;
    if (!snapshot || !Array.isArray(snapshot.sources))
        throw new WeeklyReviewConflict("evidence_unavailable", 409);
    const source = snapshot.sources.find(source => source.ref === ref);
    if (!source) throw new WeeklyReviewConflict("evidence_not_found", 404);
    if (
        typeof source.text !== "string" ||
        Buffer.byteLength(source.text) > SCOPED_EVIDENCE_LIMITS.parentBytes ||
        hashScopedText(source.text) !== source.hash
    )
        throw new WeeklyReviewConflict("evidence_unavailable", 409);
    const proof = snapshot.scopedEvidence?.find(proof =>
        proof.units.some(unit => unit.ref === ref)
    );
    const unit = proof?.units.find(unit => unit.ref === ref);
    if (
        ref.startsWith("unit:") &&
        (!proof ||
            !unit ||
            source.version !== proof.parentVersion ||
            source.hash !== unit.excerptHash ||
            source.text.length !== unit.end - unit.start)
    )
        throw new WeeklyReviewConflict("evidence_unavailable", 409);
    return {
        ...source,
        authorization: "current" as const,
        originalCompleteness: "unknown" as const,
        scope:
            proof && unit
                ? {
                      documentId: proof.documentId,
                      parentVersion: proof.parentVersion,
                      parentHash: proof.parentHash,
                      scopeHash: proof.scopeHash,
                      start: unit.start,
                      end: unit.end,
                      anchors: unit.anchors,
                      coverage: proof.coverage,
                      offsetEncoding: proof.offsetEncoding,
                  }
                : null,
    };
}

type Preview = {
    version: string;
    parentHash: string;
    text: string;
    chunks: { id: string; ordinal: number; start: number; end: number }[];
    originalCompleteness: "unknown";
    offsetEncoding: "utf16_half_open";
};
async function exactPreview(
    query: WeeklyReviewQuery,
    id: string,
    version: string
): Promise<Preview> {
    const [found] = await query(
        "SELECT id FROM pdr_ai_v2_document_versions WHERE document_id=$1::bigint AND id=$2::bigint",
        [id, version]
    );
    if (!found) throw new WeeklyReviewConflict("source_version_unavailable");
    const [stats] = await query(
        "SELECT count(*) AS chunk_count,COALESCE(sum(octet_length(content)),0)+GREATEST(count(*)-1,0) AS text_bytes FROM (SELECT content FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 1025) bounded_inspection_chunks",
        [id, version]
    );
    const count = Number(stats?.chunk_count ?? 0);
    const bytes = Number(stats?.text_bytes ?? 0);
    if (
        !count ||
        count > SCOPED_EVIDENCE_LIMITS.chunks ||
        bytes > SCOPED_EVIDENCE_LIMITS.parentBytes
    )
        throw new WeeklyReviewConflict("source_context_unavailable");
    // The body query repeats the bounds, covering replacement after the aggregate probe.
    const rows = await query(
        "SELECT id,CASE WHEN count(*) OVER()<=1024 AND sum(octet_length(content)) OVER()+GREATEST(count(*) OVER()-1,0)<=128000 THEN content ELSE NULL END AS content FROM (SELECT id,content,page_number,line_start FROM pdr_ai_v2_document_context_chunks WHERE document_id=$1::bigint AND version_id=$2::bigint ORDER BY page_number,line_start,id LIMIT 1025) bounded_inspection_chunks ORDER BY page_number,line_start,id",
        [id, version]
    );
    if (rows.length !== count || rows.some(row => typeof row.content !== "string"))
        throw new WeeklyReviewConflict("source_context_unavailable");
    const text = rows.map(row => String(row.content)).join("\n");
    if (Buffer.byteLength(text) !== bytes || !text.trim())
        throw new WeeklyReviewConflict("source_context_unavailable");
    let offset = 0;
    return {
        version,
        parentHash: hashScopedText(text),
        text,
        chunks: rows.map((row, ordinal) => {
            const start = offset;
            offset += String(row.content).length;
            const chunk = { id: String(row.id), ordinal, start, end: offset };
            offset += 1;
            return chunk;
        }),
        originalCompleteness: "unknown",
        offsetEncoding: "utf16_half_open",
    };
}

export async function inspectContextSource(
    database: WeeklyReviewDatabase,
    expected: WeeklyReviewActor,
    loadActor: () => Promise<WeeklyReviewAuthorityActor>,
    input: ContextSourceInspection
) {
    return database.transaction(async raw => {
        const { query, deadlineAt } = boundedInternalQuery(raw);
        await query(
            "INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs(company_id) VALUES($1::bigint) ON CONFLICT DO NOTHING",
            [expected.companyId]
        );
        await query(
            "SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=$1::bigint FOR SHARE",
            [expected.companyId]
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const actor = await Promise.race([
            loadActor(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new WeeklyReviewConflict("retrieval_acquisition_timeout", 503)),
                    Math.max(0, deadlineAt - Date.now())
                );
            }),
        ]).finally(() => {
            if (timer) clearTimeout(timer);
        });
        if (
            actor.companyId !== expected.companyId ||
            actor.userId !== expected.userId ||
            !actor.canRead ||
            !actor.canMutate
        )
            throw new WeeklyReviewConflict("review_access_denied", 403);
        if (input.purpose !== "personal-star" && !actor.canConfigure)
            throw new WeeklyReviewConflict("review_configuration_denied", 403);
        const [document] = await query(
            "SELECT id,CASE WHEN octet_length(title)<=1200 THEN title ELSE NULL END AS title,category FROM pdr_ai_v2_document WHERE company_id=$1::bigint AND id=$2::bigint",
            [actor.companyId, input.documentId]
        );
        if (
            !document ||
            !scopeAllowsDocument(actor.documentScope, {
                id: Number(document.id),
                category: String(document.category),
            })
        )
            throw new WeeklyReviewConflict("source_access_denied", 403);
        const restrictions = await query(
            "SELECT 1 AS restricted FROM pdr_ai_v2_document_settings WHERE document_id=$1::bigint AND restricted=true UNION ALL SELECT 1 FROM pdr_ai_v2_folder_settings f JOIN pdr_ai_v2_category c ON c.id=f.category_id WHERE f.company_id=$2::bigint AND f.visibility='restricted' AND ($3=c.name OR left($3,length(c.name)+1)=c.name||'/')",
            [input.documentId, actor.companyId, document.category]
        );
        assertSourcePurpose({
            purpose: input.purpose,
            readable: true,
            companyReadable: restrictions.length === 0,
        });
        if (typeof document.title !== "string" || document.title.length > 300)
            throw new WeeklyReviewConflict("source_context_unavailable");
        const personal = input.purpose === "personal-star";
        const [configuration] = await query(
            personal
                ? "SELECT star_document_ids,star_source_scopes,version FROM pdr_ai_v2_vantage_weekly_review_preferences WHERE company_id=$1::bigint AND actor_id=$2"
                : "SELECT architecture_document_id,required_document_ids,required_source_scopes,version FROM pdr_ai_v2_vantage_weekly_review_policy WHERE company_id=$1::bigint",
            personal ? [actor.companyId, actor.userId] : [actor.companyId]
        );
        const selectedIds = personal
            ? configuration?.star_document_ids
            : configuration?.required_document_ids;
        const configured =
            input.purpose === "company-architecture"
                ? String(configuration?.architecture_document_id) === input.documentId
                : Array.isArray(selectedIds) && selectedIds.map(String).includes(input.documentId);
        if (!configured) throw new WeeklyReviewConflict("source_not_configured", 404);
        const scopes = (
            personal ? configuration?.star_source_scopes : configuration?.required_source_scopes
        ) as Record<string, unknown> | undefined;
        const scope =
            scopes?.[input.documentId] === undefined
                ? null
                : WeeklyReviewSourceScopeSchema.parse(scopes[input.documentId]);
        let pin: {
            status: "valid" | "missing_version" | "content_changed" | "unavailable";
            scope: NonNullable<typeof scope>;
        } | null = null;
        let pinnedPreview: Preview | null = null;
        if (scope) {
            try {
                pinnedPreview = await exactPreview(query, input.documentId, scope.version);
                pin = {
                    scope,
                    status:
                        pinnedPreview.parentHash === scope.expectedParentHash
                            ? "valid"
                            : "content_changed",
                };
            } catch (error) {
                if (
                    !(error instanceof WeeklyReviewConflict) ||
                    !["source_version_unavailable", "source_context_unavailable"].includes(
                        error.code
                    )
                )
                    throw error;
                pin = {
                    scope,
                    status:
                        error.code === "source_version_unavailable"
                            ? "missing_version"
                            : "unavailable",
                };
            }
        }
        // At most two exact parents are loaded, each <=128000 bytes and <=1024 chunks.
        const preview = input.version
            ? input.version === pinnedPreview?.version
                ? pinnedPreview
                : await exactPreview(query, input.documentId, input.version)
            : pinnedPreview;
        const versions = await query(
            "SELECT id,created_at FROM pdr_ai_v2_document_versions WHERE document_id=$1::bigint ORDER BY created_at DESC,id DESC LIMIT 50",
            [input.documentId]
        );
        return {
            document: { id: input.documentId, title: document.title },
            purpose: input.purpose,
            configurationVersion: Number(configuration!.version),
            pin,
            versions: versions.map(row => ({
                version: String(row.id),
                createdAt: (row.created_at instanceof Date
                    ? row.created_at
                    : new Date(String(row.created_at))
                ).toISOString(),
            })),
            preview,
        };
    });
}
