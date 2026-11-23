import { describe, expect, it, vi } from "vitest";
import {
    canonicalParentText,
    compileScopedEvidence,
    hashScopedText,
    prepareScopedEvidence,
    projectScopedEvaluationV2,
    revalidateScopedEvidence,
    scopedWeeklyReviewBudget,
    type ScopedAuthority,
    type ScopedEvidenceRequest,
    type ScopedParent,
} from "./scoped-evidence";
import { calculateWeeklyReviewBudget } from "./weekly-review-v21";

function fixture(long = false) {
    const parent: ScopedParent = {
        companyId: "company",
        documentId: "doc",
        version: "7",
        versionDate: "2026-11-01T00:00:00Z",
        availableAt: "2026-11-02T00:00:00Z",
        title: "Synthetic source",
        purpose: "workspace-required",
        originalCompleteness: "unknown",
        chunks: Array.from({ length: long ? 129 : 1 }, (_, ordinal) => ({
            id: `chunk-${ordinal}`,
            ordinal,
            text: long ? "a".repeat(255) : "All indexed facts. Requested is not approved. 😀",
        })),
    };
    const text = canonicalParentText(parent);
    const end = long ? 2000 : text.length;
    const authority: ScopedAuthority = {
        actorId: "actor",
        companyId: "company",
        documentId: "doc",
        version: "7",
        authorized: true,
        purpose: "workspace-required",
        audience: "company",
        companyReadable: true,
        aclRevision: "acl-1",
        authorityRevision: "policy-1",
        finiteScope: {
            qualification: "Review the host-designated operational facts only.",
            requiredUnits: [
                {
                    id: "operations",
                    start: 0,
                    end,
                    excerptHash: hashScopedText(text.slice(0, end)),
                },
            ],
        },
    };
    const request: ScopedEvidenceRequest = {
        actorId: "actor",
        companyId: "company",
        documentId: "doc",
        version: "7",
        asOf: "2026-11-13T00:00:00Z",
        expectedParentHash: hashScopedText(text),
        selectedUnitIds: ["operations"],
    };
    return { parent, authority, request, text };
}
const context = {
    candidateId: "synthetic",
    week: "2026-11-09",
    asOf: "2026-11-13T00:00:00Z",
    role: "owner",
};

describe("scoped evidence v2 isolated contract", () => {
    it("binds the actor and audience in frozen provenance", () => {
        const { parent, authority, request } = fixture();
        const prepared = compileScopedEvidence(request, parent, authority);
        expect(prepared.dependency).toMatchObject({
            actorId: "actor",
            audience: "company",
            companyReadable: true,
            purpose: "workspace-required",
        });
        authority.actorId = "another-actor";
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow(
            "authority_actor_mismatch"
        );
    });
    it("rejects private required company evidence and a personal-star purpose promotion", () => {
        const { parent, authority, request } = fixture();
        authority.audience = "actor";
        authority.companyReadable = false;
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow(
            "required_context_audience"
        );
        authority.purpose = "personal-star";
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow(
            "authority_purpose_mismatch"
        );
        parent.purpose = "personal-star";
        expect(compileScopedEvidence(request, parent, authority).dependency).toMatchObject({
            purpose: "personal-star",
            audience: "actor",
            companyReadable: false,
        });
    });
    it.each(["revoked", "actor", "acl", "policy", "inventory", "audience"])(
        "rejects authority %s during parent load",
        async kind => {
            const { parent, authority, request } = fixture();
            let current: unknown = authority;
            const serverAuthority = vi.fn(async () => current);
            await expect(
                prepareScopedEvidence(request, {
                    serverAuthority,
                    loadExactParent: async () => {
                        const changed = structuredClone(authority);
                        if (kind === "revoked") current = { ...changed, authorized: false };
                        if (kind === "actor") {
                            changed.actorId = "another";
                            current = changed;
                        }
                        if (kind === "acl") {
                            changed.aclRevision = "new";
                            current = changed;
                        }
                        if (kind === "policy") {
                            changed.authorityRevision = "new";
                            current = changed;
                        }
                        if (kind === "inventory") {
                            changed.finiteScope!.requiredUnits[0]!.end -= 1;
                            current = changed;
                        }
                        if (kind === "audience") {
                            changed.audience = "actor";
                            changed.companyReadable = false;
                            current = changed;
                        }
                        return parent;
                    },
                })
            ).rejects.toThrow();
            expect(serverAuthority).toHaveBeenCalledTimes(2);
        }
    );
    it("double-checks authorization again during revalidation", async () => {
        const { parent, authority, request } = fixture();
        const serverAuthority = vi.fn(async () => authority);
        const prepared = await prepareScopedEvidence(request, {
            serverAuthority,
            loadExactParent: async () => parent,
        });
        expect(serverAuthority).toHaveBeenCalledTimes(2);
        await expect(
            revalidateScopedEvidence(prepared, {
                serverAuthority,
                loadExactParent: async () => {
                    authority.aclRevision = "revoked-during-revalidation";
                    return parent;
                },
            })
        ).rejects.toThrow("authority_changed_during_load");
        expect(serverAuthority).toHaveBeenCalledTimes(4);
    });
    it("accounts for repeated V2 metadata and reserves with a long qualification and many anchors", () => {
        const { parent, authority, request } = fixture();
        parent.chunks = Array.from({ length: 80 }, (_, ordinal) => ({
            id: `anchor-${ordinal}`,
            ordinal,
            text: "a".repeat(20),
        }));
        const text = canonicalParentText(parent);
        request.expectedParentHash = hashScopedText(text);
        authority.finiteScope!.qualification = "q".repeat(500);
        authority.finiteScope!.requiredUnits[0] = {
            id: "operations",
            start: 0,
            end: text.length,
            excerptHash: request.expectedParentHash,
        };
        const prepared = compileScopedEvidence(request, parent, authority);
        const budget = scopedWeeklyReviewBudget(prepared, context);
        expect(budget.projectionBytes).toBeLessThanOrEqual(12000);
        expect(budget.v2EvaluationOverheadBytes).toBe(
            Buffer.byteLength(JSON.stringify(projectScopedEvaluationV2(prepared, {}))) -
                Buffer.byteLength(JSON.stringify({}))
        );
        expect(budget.v2EvaluationRemainingBytes).toBe(
            14000 - budget.v2EvaluationOverheadBytes - 512 - 2 * 2800
        );
        expect(budget.reasons).toContain("scoped_v2_evaluation_reserve_unavailable");
        expect(budget.feasible).toBe(false);
    });
    it("prepares 32KB / 129 chunks as ~2KB qualified units under the shared internal-v1 budget", async () => {
        const { parent, authority, request, text } = fixture(true);
        const prepared = await prepareScopedEvidence(request, {
            serverAuthority: async () => authority,
            loadExactParent: async () => parent,
        });
        expect(Buffer.byteLength(text)).toBeGreaterThan(32000);
        expect(parent.chunks).toHaveLength(129);
        expect(prepared.status).toBe("prepared_scoped_evidence");
        expect(prepared.dependency.coverage.state).toBe("relevant_spans_reviewed");
        expect(prepared.modelFacingProjection.sources[0]!.text).toHaveLength(2000);
        expect(prepared.modelFacingProjection.sources[0]!.anchors.length).toBeGreaterThan(1);
        expect(scopedWeeklyReviewBudget(prepared, context).feasible).toBe(true);
        const whole = calculateWeeklyReviewBudget(
            {
                ...context,
                mandatoryCoverage: { required: 1, included: 1 },
                sources: [
                    {
                        ref: "doc:doc@7",
                        version: "7",
                        hash: request.expectedParentHash,
                        text,
                        title: parent.title,
                        purpose: parent.purpose,
                    },
                ],
            },
            "internal-v1"
        );
        expect(whole.feasible).toBe(false);
        expect(whole.reasons).toContain("input_budget_exceeded");
    });
    it("qualifies complete indexed text independently of original PDF/OCR completeness", () => {
        const { parent, authority, request } = fixture();
        const prepared = compileScopedEvidence(request, parent, authority);
        expect(prepared.dependency.coverage).toMatchObject({
            state: "full_document_reviewed",
            reviewedRepresentation: "canonical_indexed_text",
            originalCompleteness: "unknown",
        });
        expect(prepared.modelFacingProjection.sources[0]).toMatchObject({
            availableAt: parent.availableAt,
            versionDate: parent.versionDate,
        });
        expect(Object.isFrozen(prepared.dependency.units[0]!.anchors)).toBe(true);
    });
    it("never turns a document-ID-only requirement into finite scope", async () => {
        const { parent, authority, request } = fixture();
        authority.finiteScope = null;
        await expect(
            prepareScopedEvidence(request, {
                serverAuthority: async () => authority,
                loadExactParent: async () => parent,
            })
        ).rejects.toThrow("finite_scope_not_authorized");
    });
    it("retains insufficient coverage when a finite required unit is omitted", () => {
        const { parent, authority, request, text } = fixture();
        authority.finiteScope!.requiredUnits = [
            { id: "operations", start: 0, end: 10, excerptHash: hashScopedText(text.slice(0, 10)) },
            {
                id: "qualifications",
                start: 10,
                end: text.length,
                excerptHash: hashScopedText(text.slice(10)),
            },
        ];
        const prepared = compileScopedEvidence(request, parent, authority);
        expect(prepared.dependency.coverage.state).toBe("insufficient_evidence");
        expect(scopedWeeklyReviewBudget(prepared, context).feasible).toBe(false);
    });
    it("keeps every user-facing report field and actual dates in a separate v2 payload", () => {
        const { parent, authority, request } = fixture(true);
        const prepared = compileScopedEvidence(request, parent, authority);
        const report = {
            headline: "H",
            brief: "B",
            summary: "S",
            keyFigures: [{ value: "1" }],
            topics: [
                { whyNow: "Now", unknowns: ["Unknown"], recommendation: { call: "Proposal" } },
            ],
        };
        const projected = projectScopedEvaluationV2(prepared, report);
        expect(projected.actual).toEqual(report);
        expect(projected.evidence.coverage.state).toBe("relevant_spans_reviewed");
        expect(projected.evidence.sources[0]!.availableAt).toBe(parent.availableAt);
        expect(projected).not.toHaveProperty("contextCompleteness");
        expect(projected.promotionStatus).toBe("requires_v2_judge_and_service_integration");
    });
    it.each(["parent", "excerpt"])("rejects a forged %s hash", kind => {
        const { parent, authority, request } = fixture();
        if (kind === "parent") request.expectedParentHash = "0".repeat(64);
        else authority.finiteScope!.requiredUnits[0]!.excerptHash = "0".repeat(64);
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow(
            `${kind}_hash_mismatch`
        );
    });
    it.each([
        "empty",
        "duplicate",
        "range",
        "overlap",
        "surrogate",
        "unknown",
        "duplicate-selection",
    ])("rejects invalid %s units", kind => {
        const { parent, authority, request, text } = fixture();
        const units = authority.finiteScope!.requiredUnits;
        if (kind === "empty") units.length = 0;
        if (kind === "duplicate") units.push({ ...units[0]! });
        if (kind === "range") units[0]!.end = text.length + 1;
        if (kind === "overlap") units.push({ ...units[0]!, id: "second" });
        if (kind === "surrogate") {
            units[0]!.end = text.length - 1;
            units[0]!.excerptHash = hashScopedText(text.slice(0, -1));
        }
        if (kind === "unknown") request.selectedUnitIds = ["invented"];
        if (kind === "duplicate-selection") request.selectedUnitIds.push("operations");
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow();
    });
    it.each(["bytes", "chunks", "units", "unit-length"])("enforces the %s bound", kind => {
        const { parent, authority, request } = fixture();
        if (kind === "bytes") parent.chunks[0]!.text = "é".repeat(64001);
        if (kind === "chunks")
            parent.chunks = Array.from({ length: 1025 }, (_, ordinal) => ({
                id: `${ordinal}`,
                ordinal,
                text: "a",
            }));
        if (kind === "units")
            authority.finiteScope!.requiredUnits = Array.from({ length: 17 }, (_, i) => ({
                id: `${i}`,
                start: i,
                end: i + 1,
                excerptHash: hashScopedText("a"),
            }));
        if (kind === "unit-length") {
            parent.chunks[0]!.text = "a".repeat(6001);
            request.expectedParentHash = hashScopedText(parent.chunks[0]!.text);
            authority.finiteScope!.requiredUnits[0] = {
                id: "operations",
                start: 0,
                end: 6001,
                excerptHash: request.expectedParentHash,
            };
        }
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow();
    });
    it("canonicalizes chunk order and rejects missing or duplicate chunks", () => {
        const { parent } = fixture(true);
        const canonical = canonicalParentText(parent);
        parent.chunks.reverse();
        expect(canonicalParentText(parent)).toBe(canonical);
        parent.chunks[0]!.ordinal = 500;
        expect(() => canonicalParentText(parent)).toThrow("incomplete_chunk_inventory");
        parent.chunks[0]!.id = parent.chunks[1]!.id;
        expect(() => canonicalParentText(parent)).toThrow("duplicate_chunk");
    });
    it.each(["versionDate", "availableAt"] as const)("rejects a future %s", key => {
        const { parent, authority, request } = fixture();
        parent[key] = "2026-12-01T00:00:00Z";
        expect(() => compileScopedEvidence(request, parent, authority)).toThrow(
            "future_parent_version"
        );
    });
    it("rejects mismatched authority before loading parent text", async () => {
        const { authority, request } = fixture();
        const loadExactParent = vi.fn();
        await expect(
            prepareScopedEvidence(request, {
                serverAuthority: async () => ({ ...authority, companyId: "foreign" }),
                loadExactParent,
            })
        ).rejects.toThrow("exact_parent_identity_mismatch");
        expect(loadExactParent).not.toHaveBeenCalled();
    });
    it("rejects denied ACL before loading parent text", async () => {
        const { authority, request } = fixture();
        const loadExactParent = vi.fn();
        await expect(
            prepareScopedEvidence(request, {
                serverAuthority: async () => ({ ...authority, authorized: false }),
                loadExactParent,
            })
        ).rejects.toThrow();
        expect(loadExactParent).not.toHaveBeenCalled();
    });
    it.each(["outside-excerpt", "acl", "authority", "scope", "source-acl", "parent-version"])(
        "revalidates %s changes",
        async kind => {
            const { parent, authority, request } = fixture(true);
            const ports = {
                serverAuthority: async () => authority,
                loadExactParent: async () => parent,
            };
            const prepared = await prepareScopedEvidence(request, ports);
            if (kind === "outside-excerpt") parent.chunks[128]!.text += "changed";
            if (kind === "acl") authority.aclRevision = "acl-2";
            if (kind === "authority") authority.authorityRevision = "policy-2";
            if (kind === "scope") authority.finiteScope!.qualification = "Changed scope";
            if (kind === "source-acl") authority.companyId = "another-company";
            if (kind === "parent-version") parent.version = "8";
            await expect(revalidateScopedEvidence(prepared, ports)).rejects.toThrow();
        }
    );
    it("revalidates an unchanged dependency and rejects an altered frozen-envelope copy", async () => {
        const { parent, authority, request } = fixture();
        const ports = {
            serverAuthority: async () => authority,
            loadExactParent: async () => parent,
        };
        const prepared = await prepareScopedEvidence(request, ports);
        expect(await revalidateScopedEvidence(prepared, ports)).toEqual(prepared);
        const forged = structuredClone(prepared);
        forged.modelFacingProjection.sources[0]!.text = "Forged";
        await expect(revalidateScopedEvidence(forged, ports)).rejects.toThrow(
            "scoped_dependency_changed"
        );
    });
});
