import { createHash } from "node:crypto";
import { z } from "zod";
import { calculateWeeklyReviewBudget, type WeeklyReviewInput } from "./weekly-review-v21";

export const SCOPED_EVIDENCE_VERSION = "vantage-scoped-evidence/v2" as const;
export const SCOPED_EVIDENCE_LIMITS = Object.freeze({
    parentBytes: 128000,
    chunks: 1024,
    units: 16,
    unitChars: 6000,
});
const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const purpose = z.enum([
    "company-architecture",
    "workspace-required",
    "personal-star",
    "retrieved",
]);
const range = z
    .object({
        id,
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        excerptHash: hash,
    })
    .strict();
export const ScopedEvidenceRequestSchema = z
    .object({
        actorId: id,
        companyId: id,
        documentId: id,
        version: id,
        asOf: instant,
        expectedParentHash: hash,
        selectedUnitIds: z.array(id).min(1).max(SCOPED_EVIDENCE_LIMITS.units),
    })
    .strict();
export type ScopedEvidenceRequest = z.infer<typeof ScopedEvidenceRequestSchema>;
export const ScopedParentSchema = z
    .object({
        companyId: id,
        documentId: id,
        version: id,
        versionDate: instant,
        availableAt: instant,
        title: z.string().min(1).max(300),
        purpose,
        // Canonical order is explicit. Database-stored hashes are deliberately absent.
        chunks: z
            .array(
                z.object({ id, ordinal: z.number().int().nonnegative(), text: z.string() }).strict()
            )
            .min(1)
            .max(SCOPED_EVIDENCE_LIMITS.chunks),
        originalCompleteness: z.enum(["verified_complete", "unknown"]),
    })
    .strict();
export type ScopedParent = z.infer<typeof ScopedParentSchema>;
export const ScopedAuthoritySchema = z
    .object({
        actorId: id,
        companyId: id,
        documentId: id,
        version: id,
        authorized: z.literal(true),
        purpose,
        audience: z.enum(["company", "actor"]),
        companyReadable: z.boolean(),
        aclRevision: id,
        authorityRevision: id,
        // Null means the host has authorized no finite scope. ID-only policy cannot populate this.
        finiteScope: z
            .object({
                qualification: z.string().min(1).max(500),
                requiredUnits: z.array(range).min(1).max(SCOPED_EVIDENCE_LIMITS.units),
            })
            .strict()
            .nullable(),
    })
    .strict();
export type ScopedAuthority = z.infer<typeof ScopedAuthoritySchema>;
export type ScopedCoverageState =
    | "full_document_reviewed"
    | "relevant_spans_reviewed"
    | "insufficient_evidence";
export interface ScopedEvidencePorts {
    /** Server-owned policy and current ACL. Never implement from model output or source instructions. */
    serverAuthority(request: Readonly<ScopedEvidenceRequest>): Promise<unknown>;
    /** Must bound acquisition before constructing the snapshot (128000 UTF-8 bytes, 1024 chunks),
     * then load every canonical indexed chunk for this exact version without truncation.
     * Schema caps after loading do not establish bounded DB acquisition.
     */
    loadExactParent(request: Readonly<ScopedEvidenceRequest>): Promise<unknown>;
}
export const hashScopedText = (text: string) =>
    createHash("sha256").update(text, "utf8").digest("hex");
function fingerprint(value: unknown) {
    return hashScopedText(JSON.stringify(value));
}
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
function assert(condition: unknown, code: string): asserts condition {
    if (!condition) throw new Error(code);
}
export function canonicalParentText(raw: ScopedParent): string {
    const parent = ScopedParentSchema.parse(raw);
    const chunks = [...parent.chunks].sort((a, b) => a.ordinal - b.ordinal);
    assert(new Set(chunks.map(chunk => chunk.id)).size === chunks.length, "duplicate_chunk");
    assert(
        chunks.every((chunk, i) => chunk.ordinal === i),
        "incomplete_chunk_inventory"
    );
    const text = chunks.map(chunk => chunk.text).join("\n");
    assert(
        Buffer.byteLength(text, "utf8") <= SCOPED_EVIDENCE_LIMITS.parentBytes,
        "parent_byte_limit"
    );
    return text;
}
function splitsSurrogate(text: string, offset: number) {
    return (
        offset > 0 &&
        offset < text.length &&
        text.charCodeAt(offset - 1) >= 0xd800 &&
        text.charCodeAt(offset - 1) <= 0xdbff &&
        text.charCodeAt(offset) >= 0xdc00 &&
        text.charCodeAt(offset) <= 0xdfff
    );
}
function chunkAnchors(parent: ScopedParent, start: number, end: number) {
    let offset = 0;
    return [...parent.chunks]
        .sort((a, b) => a.ordinal - b.ordinal)
        .flatMap(chunk => {
            const chunkStart = offset;
            offset += chunk.text.length + 1;
            // The canonical separator belongs to the preceding chunk, except after the last chunk.
            const chunkEnd =
                chunkStart + chunk.text.length + (chunk.ordinal < parent.chunks.length - 1 ? 1 : 0);
            return start < chunkEnd && end > chunkStart
                ? [
                      {
                          chunkId: chunk.id,
                          ordinal: chunk.ordinal,
                          start: Math.max(start, chunkStart) - chunkStart,
                          end: Math.min(end, chunkEnd) - chunkStart,
                      },
                  ]
                : [];
        });
}
/** Pure compiler. Inputs must originate from trusted server adapters for authorization claims. */
export function compileScopedEvidence(
    rawRequest: ScopedEvidenceRequest,
    rawParent: ScopedParent,
    rawAuthority: ScopedAuthority
) {
    const request = ScopedEvidenceRequestSchema.parse(rawRequest);
    const parent = ScopedParentSchema.parse(rawParent);
    const authority = ScopedAuthoritySchema.parse(rawAuthority);
    for (const value of [parent, authority]) {
        assert(
            value.companyId === request.companyId &&
                value.documentId === request.documentId &&
                value.version === request.version,
            "exact_parent_identity_mismatch"
        );
    }
    assert(authority.actorId === request.actorId, "authority_actor_mismatch");
    assert(authority.purpose === parent.purpose, "authority_purpose_mismatch");
    assert(
        authority.audience === (authority.companyReadable ? "company" : "actor"),
        "authority_audience_mismatch"
    );
    assert(
        !["company-architecture", "workspace-required"].includes(parent.purpose) ||
            authority.companyReadable,
        "required_context_audience"
    );
    assert(
        Date.parse(parent.versionDate) <= Date.parse(request.asOf) &&
            Date.parse(parent.availableAt) <= Date.parse(request.asOf),
        "future_parent_version"
    );
    const parentText = canonicalParentText(parent);
    const parentHash = hashScopedText(parentText);
    assert(parentHash === request.expectedParentHash, "parent_hash_mismatch");
    assert(authority.finiteScope !== null, "finite_scope_not_authorized");
    const scope = authority.finiteScope;
    const inventory = [...scope.requiredUnits].sort((a, b) => a.start - b.start || a.end - b.end);
    assert(new Set(inventory.map(unit => unit.id)).size === inventory.length, "duplicate_unit");
    assert(
        new Set(request.selectedUnitIds).size === request.selectedUnitIds.length,
        "duplicate_selection"
    );
    for (let i = 0; i < inventory.length; i++) {
        const unit = inventory[i]!;
        assert(unit.start < unit.end && unit.end <= parentText.length, "unit_out_of_range");
        assert(unit.end - unit.start <= SCOPED_EVIDENCE_LIMITS.unitChars, "unit_character_limit");
        assert(
            !splitsSurrogate(parentText, unit.start) && !splitsSurrogate(parentText, unit.end),
            "unit_splits_surrogate"
        );
        assert(i === 0 || inventory[i - 1]!.end <= unit.start, "overlapping_units");
        assert(
            hashScopedText(parentText.slice(unit.start, unit.end)) === unit.excerptHash,
            "excerpt_hash_mismatch"
        );
    }
    const selected = new Set(request.selectedUnitIds);
    assert(
        request.selectedUnitIds.every(unitId => inventory.some(unit => unit.id === unitId)),
        "unknown_selected_unit"
    );
    const scopeHash = fingerprint({
        actorId: request.actorId,
        purpose: authority.purpose,
        audience: authority.audience,
        companyReadable: authority.companyReadable,
        authorityRevision: authority.authorityRevision,
        qualification: scope.qualification,
        inventory,
    });
    const units = inventory
        .filter(unit => selected.has(unit.id))
        .map(unit => ({
            ...unit,
            // Server minted, exact-version and scope-bound. The caller never supplies a citation ref.
            ref: `unit:${fingerprint([request.documentId, request.version, parentHash, scopeHash, unit.id])}`,
            text: parentText.slice(unit.start, unit.end),
            anchors: chunkAnchors(parent, unit.start, unit.end),
        }));
    const allRequired = units.length === inventory.length;
    const coversCanonicalParent =
        allRequired &&
        inventory[0]!.start === 0 &&
        inventory[inventory.length - 1]!.end === parentText.length &&
        inventory.every((unit, i) => i === 0 || inventory[i - 1]!.end === unit.start);
    const coverageState: ScopedCoverageState = !allRequired
        ? "insufficient_evidence"
        : coversCanonicalParent
          ? "full_document_reviewed"
          : "relevant_spans_reviewed";
    const coverage = {
        state: coverageState,
        qualification: scope.qualification,
        requiredUnits: inventory.length,
        includedUnits: units.length,
        reviewedRepresentation: "canonical_indexed_text" as const,
        originalCompleteness: parent.originalCompleteness,
    };
    const dependency = {
        version: SCOPED_EVIDENCE_VERSION,
        actorId: request.actorId,
        companyId: request.companyId,
        documentId: request.documentId,
        parentVersion: request.version,
        parentHash,
        parentChars: parentText.length,
        scopeHash,
        authorityRevision: authority.authorityRevision,
        purpose: authority.purpose,
        audience: authority.audience,
        companyReadable: authority.companyReadable,
        aclRevision: authority.aclRevision,
        versionDate: parent.versionDate,
        availableAt: parent.availableAt,
        offsetEncoding: "utf16_half_open" as const,
        requiredUnits: inventory,
        units: units.map(({ text: _text, ...unit }) => unit),
        coverage,
    };
    const modelFacingProjection = {
        version: SCOPED_EVIDENCE_VERSION,
        offsetEncoding: "utf16_half_open" as const,
        coverage,
        sources: units.map(unit => ({
            ref: unit.ref,
            version: parent.version,
            hash: unit.excerptHash,
            text: unit.text,
            title: parent.title,
            purpose: parent.purpose,
            audience: authority.audience,
            companyReadable: authority.companyReadable,
            documentId: parent.documentId,
            parentHash,
            scopeHash,
            versionDate: parent.versionDate,
            availableAt: parent.availableAt,
            start: unit.start,
            end: unit.end,
            anchors: unit.anchors,
        })),
    };
    return freeze({
        status: "prepared_scoped_evidence" as const,
        request,
        dependency,
        modelFacingProjection,
    });
}
export type PreparedScopedEvidence = ReturnType<typeof compileScopedEvidence>;

/** Injected adapter only. Current authorization is checked both before and after loading text. */
export async function prepareScopedEvidence(
    rawRequest: ScopedEvidenceRequest,
    ports: ScopedEvidencePorts
): Promise<PreparedScopedEvidence> {
    const request = freeze(ScopedEvidenceRequestSchema.parse(rawRequest));
    const authority = ScopedAuthoritySchema.parse(await ports.serverAuthority(request));
    assert(
        authority.companyId === request.companyId &&
            authority.documentId === request.documentId &&
            authority.version === request.version,
        "exact_parent_identity_mismatch"
    );
    assert(authority.actorId === request.actorId, "authority_actor_mismatch");
    assert(authority.finiteScope !== null, "finite_scope_not_authorized");
    const parent = ScopedParentSchema.parse(await ports.loadExactParent(request));
    const currentAuthority = ScopedAuthoritySchema.parse(await ports.serverAuthority(request));
    assert(
        fingerprint(currentAuthority) === fingerprint(authority),
        "authority_changed_during_load"
    );
    return compileScopedEvidence(request, parent, currentAuthority);
}
/** Rechecks full canonical text, dates, scope and current ACL, including mutations outside excerpts. */
export async function revalidateScopedEvidence(
    prepared: PreparedScopedEvidence,
    ports: ScopedEvidencePorts
): Promise<PreparedScopedEvidence> {
    const current = await prepareScopedEvidence(prepared.request, ports);
    assert(fingerprint(current) === fingerprint(prepared), "scoped_dependency_changed");
    return current;
}
/** Compatibility projection for the existing shared deterministic budget only.
 * Its V1 evaluator cannot qualify scoped coverage. Never dispatch this projection to the V1 Judge.
 */
export function scopedWeeklyReviewBudget(
    prepared: PreparedScopedEvidence,
    context: Pick<WeeklyReviewInput, "candidateId" | "week" | "asOf" | "role">
) {
    assert(context.asOf === prepared.request.asOf, "budget_cutoff_mismatch");
    const input: WeeklyReviewInput = {
        ...context,
        mandatoryCoverage: {
            required: prepared.dependency.coverage.requiredUnits,
            included: prepared.dependency.coverage.includedUnits,
        },
        sources: prepared.modelFacingProjection.sources,
        scopedEvidence: [prepared.dependency],
    };
    const budget = calculateWeeklyReviewBudget(input, "scoped-v2");
    const projectionBytes = Buffer.byteLength(
        JSON.stringify({ ...context, ...prepared.modelFacingProjection })
    );
    const reasons = [...budget.reasons];
    if (projectionBytes > budget.limits.generationInputBytes)
        reasons.push("scoped_projection_budget_exceeded");
    const provisionalReport = {
        headline: "Preflight",
        brief: "Preflight",
        summary: "Preflight",
        keyFigures: [],
        topics: [],
    };
    const v2Preview = projectScopedEvaluationV2(prepared, provisionalReport);
    const v2EvaluationOverheadBytes =
        Buffer.byteLength(JSON.stringify(v2Preview)) -
        Buffer.byteLength(JSON.stringify(v2Preview.actual));
    const v2EvaluationLimitBytes = 14000;
    const v2ReportReserveBytes = 2800;
    const v2EvaluationRemainingBytes =
        v2EvaluationLimitBytes - v2EvaluationOverheadBytes - 512 - 2 * v2ReportReserveBytes;
    if (v2EvaluationRemainingBytes < 0) reasons.push("scoped_v2_evaluation_reserve_unavailable");
    return {
        ...budget,
        projectionBytes,
        v2EvaluationOverheadBytes,
        v2EvaluationLimitBytes,
        v2ReportReserveBytes,
        v2EvaluationRemainingBytes,
        feasible: reasons.length === 0,
        reasons,
    };
}
/** Versioned handoff for a future V2 Judge. Every canonical report field remains in actual.
 * This payload has no production acceptance or V1 contextCompleteness claim.
 */
export function projectScopedEvaluationV2(prepared: PreparedScopedEvidence, report: unknown) {
    return freeze({
        version: "vantage-scoped-evaluation/v2" as const,
        asOf: prepared.request.asOf,
        evidence: prepared.modelFacingProjection,
        dependency: prepared.dependency,
        actual: structuredClone(report),
        promotionStatus: "requires_v2_judge_and_service_integration" as const,
    });
}
