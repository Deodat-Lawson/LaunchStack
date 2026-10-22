import { describe, expect, it } from "vitest";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import type {
    BusinessRoleContextV0,
    ContextFailureV0,
    DynamicRetrievalInputV0,
    ContextResearchPlanV0,
    ContextResearchResultV0,
    DynamicRetrievalBundleV0,
    RequiredContextBundleV0,
} from "../proposals/context-v0";
import { assembleContextManifestV0 } from "./assembler";
import { createSourceRegistryV0 } from "./registry";
import type { AssembleContextManifestInputV0, TrustedContextSourceV0 } from "./contracts";

const clone = <T>(value: T): T => structuredClone(value);

function makeInput(
    overrides: Partial<AssembleContextManifestInputV0> = {}
): AssembleContextManifestInputV0 {
    const required = clone(normalFixture.requiredBundle) as unknown as RequiredContextBundleV0;
    const retrievalInput = clone(
        normalFixture.retrievalInput
    ) as unknown as DynamicRetrievalInputV0;
    const retrieval = clone(normalFixture.retrievalBundle) as DynamicRetrievalBundleV0;
    const reportWindow = clone(retrieval.reportWindow);
    const actor = clone(required.actor);
    const catalog = clone(retrievalInput.sourceCatalog) as TrustedContextSourceV0[];
    const registryResult = createSourceRegistryV0({ actor, reportWindow, trustedCatalog: catalog });
    if (!registryResult.ok)
        throw new Error(registryResult.issues.map(issue => issue.message).join("; "));
    return {
        runId: "run-1",
        actor,
        reportWindow,
        roleContext: clone(normalFixture.roleContext) as unknown as BusinessRoleContextV0,
        roleProfileVersions: { founder: "profile-founder-v1" },
        required,
        retrievalInput,
        retrieval,
        registry: registryResult.registry,
        budgets: clone(retrievalInput.budgets),
        ...overrides,
    };
}

describe("Vantage V0 context assembler", () => {
    it("assembles founder context with deterministic selected refs and bounded evidence", () => {
        const first = assembleContextManifestV0(makeInput());
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value.manifest.status).toBe("complete");
        expect(first.value.manifest.selectedRefs).toHaveLength(4);
        expect(first.value.evidenceSnapshot.entries).toHaveLength(4);
        expect(first.value.evidenceSnapshot.totalExcerptChars).toBeLessThanOrEqual(8000);
        expect(first.value.freeze.roleMapVersion).toBe("roles-2026-10-20.1");
    });

    it("is independent of input order and run identity for the content fingerprint", () => {
        const original = makeInput({ runId: "run-a" });
        const reversed = makeInput({
            runId: "run-b",
            required: {
                ...clone(original.required),
                workspaceMandatoryDocuments: [
                    ...original.required.workspaceMandatoryDocuments,
                ].reverse(),
                personalVantageStars: [...original.required.personalVantageStars].reverse(),
            },
            retrieval: {
                ...clone(original.retrieval!),
                roleMatches: [...original.retrieval!.roleMatches].reverse(),
                recentChanges: [...original.retrieval!.recentChanges].reverse(),
                unresolvedOlderItems: [...original.retrieval!.unresolvedOlderItems].reverse(),
            },
        });
        const a = assembleContextManifestV0(original);
        const b = assembleContextManifestV0(reversed);
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(a.value.manifest.contextFingerprint).toBe(b.value.manifest.contextFingerprint);
        expect(a.value.evidenceSnapshot.contentFingerprint).toBe(
            b.value.evidenceSnapshot.contentFingerprint
        );
    });

    it("blocks missing, revoked, unchecked, and conflicting required sources before evidence", () => {
        const missing = makeInput({
            required: {
                ...clone(normalFixture.requiredBundle as unknown as RequiredContextBundleV0),
                workspaceMandatoryDocuments: [],
            },
        });
        const missingResult = assembleContextManifestV0(missing);
        expect(missingResult.ok).toBe(false);
        if (!missingResult.ok) expect(missingResult.status).toBe("blocked");

        const unchecked = makeInput({
            required: {
                ...clone(normalFixture.requiredBundle as unknown as RequiredContextBundleV0),
                coverage: {
                    ...clone(
                        (normalFixture.requiredBundle as unknown as RequiredContextBundleV0)
                            .coverage
                    ),
                    checked: [],
                },
            },
        });
        expect(assembleContextManifestV0(unchecked).ok).toBe(false);

        const contradictoryCoverage = makeInput({
            required: {
                ...clone(normalFixture.requiredBundle as unknown as RequiredContextBundleV0),
                coverage: {
                    ...clone(
                        (normalFixture.requiredBundle as unknown as RequiredContextBundleV0)
                            .coverage
                    ),
                    missing: [
                        clone(
                            (normalFixture.requiredBundle as unknown as RequiredContextBundleV0)
                                .coverage.checked[0]!
                        ),
                    ],
                },
            },
        });
        expect(assembleContextManifestV0(contradictoryCoverage).ok).toBe(false);

        const aclMismatch = makeInput();
        const mismatchedRegistry = createSourceRegistryV0({
            actor: { ...aclMismatch.actor, aclDigest: "different-actor-acl" },
            reportWindow: aclMismatch.reportWindow,
            trustedCatalog: aclMismatch.registry.entries,
        });
        expect(mismatchedRegistry.ok).toBe(true);
        if (mismatchedRegistry.ok)
            expect(
                assembleContextManifestV0({ ...aclMismatch, registry: mismatchedRegistry.registry })
                    .ok
            ).toBe(false);

        const revokedInput = makeInput();
        const revokedRequired = clone(revokedInput.required);
        revokedRequired.workspaceMandatoryDocuments =
            revokedRequired.workspaceMandatoryDocuments.map(entry => ({
                ...entry,
                access: "revoked" as const,
                excerpt: "",
            }));
        const revokedCatalog = revokedInput.registry.entries.map(entry =>
            entry.source.id === "doc-weekly-plan"
                ? (({ contentHash: _contentHash, ...withoutHash }) => ({
                      ...withoutHash,
                      access: "revoked" as const,
                      excerpt: "",
                  }))(entry)
                : entry
        );
        const revokedRegistry = createSourceRegistryV0({
            actor: revokedInput.actor,
            reportWindow: revokedInput.reportWindow,
            trustedCatalog: revokedCatalog,
        });
        expect(revokedRegistry.ok).toBe(true);
        if (revokedRegistry.ok)
            expect(
                assembleContextManifestV0({
                    ...revokedInput,
                    required: { ...revokedRequired, status: "blocked" },
                    registry: revokedRegistry.registry,
                }).ok
            ).toBe(false);

        const conflictRetrieval = clone(normalFixture.retrievalBundle) as DynamicRetrievalBundleV0;
        conflictRetrieval.recentChanges = [
            {
                ...conflictRetrieval.recentChanges[0]!,
                source: { ...conflictRetrieval.recentChanges[0]!.source, version: "doc-v-new" },
            },
        ];
        const conflict = assembleContextManifestV0(makeInput({ retrieval: conflictRetrieval }));
        expect(conflict.ok).toBe(false);
        if (!conflict.ok)
            expect(conflict.issues.some(issue => issue.code === "source_version_conflict")).toBe(
                true
            );
    });

    it("normalizes exact duplicate retrieval lanes while preserving lane provenance", () => {
        const input = makeInput();
        const retrieval = clone(input.retrieval!);
        retrieval.recentChanges = [retrieval.roleMatches[0]!, ...retrieval.recentChanges];
        const result = assembleContextManifestV0({ ...input, retrieval });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const evidenceKeys = result.value.evidenceSnapshot.entries.map(
            entry => `${entry.source.kind}:${entry.source.id}@${entry.source.version}`
        );
        expect(new Set(evidenceKeys).size).toBe(evidenceKeys.length);
        expect(
            result.value.manifest.retrievalState.laneProvenance.find(
                item => item.source.id === "evidence-risk-1"
            )?.lanes
        ).toContain("recentChanges");
    });

    it("does not authorize a public citation that is absent from the trusted registry", () => {
        const input = makeInput({
            researchPlan: clone(normalFixture.researchPlan) as unknown as ContextResearchPlanV0,
            researchResult: clone(
                normalFixture.researchResult
            ) as unknown as ContextResearchResultV0,
            trustedPublicProjections: [
                {
                    approvalToken: "psqv0_public-market-risk-1",
                    projectionId: "projection-market-risk-1",
                    query: "public market risk indicators for early-stage software",
                },
            ],
        });
        const result = assembleContextManifestV0(input);
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.issues.some(issue => issue.code === "citation_source_unregistered")).toBe(
                true
            );
    });

    it("fails closed on malformed required, retrieval, and research handoffs", () => {
        const base = makeInput();
        const malformedRequired = {
            ...base,
            required: {
                ...clone(base.required),
                coverage: { ...clone(base.required.coverage), checked: null },
            },
        } as unknown as AssembleContextManifestInputV0;
        const malformedRetrieval = {
            ...base,
            retrieval: {
                ...clone(base.retrieval!),
                roleMatches: [{ source: null }],
            },
        } as unknown as AssembleContextManifestInputV0;
        const malformedResearch = {
            ...base,
            researchPlan: {
                ...clone(normalFixture.researchPlan),
                mode: "STOP",
                gapPurpose: "No research",
                publicSafeQueryProjection: [],
            },
            researchResult: {
                ...clone(normalFixture.researchResult),
                mode: "STOP",
                gapPurpose: "No research",
                publicSafeQueryProjection: [],
                citations: null,
                status: "stopped",
            },
        } as unknown as AssembleContextManifestInputV0;

        for (const malformed of [malformedRequired, malformedRetrieval, malformedResearch]) {
            let result: ReturnType<typeof assembleContextManifestV0> | undefined;
            expect(() => {
                result = assembleContextManifestV0(malformed);
            }).not.toThrow();
            expect(result?.ok).toBe(false);
            if (result && !result.ok) {
                expect(result.status).toBe("blocked");
                expect(result.manifest).toBeUndefined();
                expect(result.issues.some(issue => issue.code === "malformed_handoff")).toBe(true);
            }
        }
    });

    it("canonicalizes retrieval and research failures for fingerprint stability", () => {
        const base = makeInput();
        const source = base.required.companyArchitecture.source;
        const first: ContextFailureV0 = {
            code: "timeout",
            message: "recent changes timed out",
            source,
        };
        const second: ContextFailureV0 = {
            code: "source_unavailable",
            message: "older items unavailable",
            source: base.required.workspaceMandatoryDocuments[0]!.source,
        };
        const retrievalA = {
            ...clone(base.retrieval!),
            status: "partial" as const,
            failures: [first, second, first],
        };
        const retrievalB = {
            ...clone(base.retrieval!),
            status: "partial" as const,
            failures: [second, first],
        };
        const a = assembleContextManifestV0({ ...base, retrieval: retrievalA });
        const b = assembleContextManifestV0({ ...base, retrieval: retrievalB });
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(a.value.manifest.contextFingerprint).toBe(b.value.manifest.contextFingerprint);
        expect(a.value.manifest.retrievalState.failures).toHaveLength(2);

        const researchPlan = {
            ...clone(normalFixture.researchPlan),
            mode: "STOP" as const,
            gapPurpose: "No research",
            publicSafeQueryProjection: [],
        } as unknown as ContextResearchPlanV0;
        const researchResultBase = {
            ...clone(normalFixture.researchResult),
            mode: "STOP" as const,
            gapPurpose: "No research",
            publicSafeQueryProjection: [],
            citations: [],
            status: "stopped" as const,
        } as unknown as ContextResearchResultV0;
        const researchA = {
            ...researchResultBase,
            failures: [first, second, first],
        };
        const researchB = {
            ...researchResultBase,
            failures: [second, first],
        };
        const ra = assembleContextManifestV0({
            ...base,
            researchPlan,
            researchResult: researchA,
        });
        const rb = assembleContextManifestV0({
            ...base,
            researchPlan,
            researchResult: researchB,
        });
        expect(ra.ok && rb.ok).toBe(true);
        if (!ra.ok || !rb.ok) return;
        expect(ra.value.manifest.contextFingerprint).toBe(rb.value.manifest.contextFingerprint);
        expect(ra.value.manifest.research.failures).toHaveLength(2);
    });
});
