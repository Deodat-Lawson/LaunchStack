import { describe, expect, it } from "vitest";
import normalFixture from "../../../../fixtures/vantage-context-v0/normal.json";
import negativeCases from "../../../../fixtures/vantage-context-v0/negative-cases.json";
import {
    contextSourceKeyV0,
    createContextManifestConsumerStub,
    dedupeContextSourceRefs,
    validateBusinessRoleContext,
    validateContextManifest,
    validateContextResearchPlan,
    validateContextResearchResult,
    validateDynamicRetrievalBundle,
    validateDynamicRetrievalInput,
    validateRequiredContextBundle,
    type ContextResearchPlanV0,
    type ContextSourceRefV0,
    type DynamicRetrievalInputV0,
    type RequiredContextBundleV0,
} from "./context-v0";

const clone = <T>(value: T): T => structuredClone(value);
const trustedProjection = {
    approvalToken: "psqv0_public-market-risk-1",
    projectionId: "projection-market-risk-1",
    query: "public market risk indicators for early-stage software",
};

function setPath(value: Record<string, unknown>, path: string, replacement: unknown) {
    const parts = path.split(".");
    const last = parts.pop()!;
    let current: unknown = value;
    for (const part of parts) {
        const match = /^(.*)\[(\d+)\]$/.exec(part);
        if (match) current = (current as Record<string, unknown>)[match[1]!] as unknown[];
        else current = (current as Record<string, unknown>)[part];
        if (match) current = (current as unknown[])[Number(match[2])];
    }
    const match = /^(.*)\[(\d+)\]$/.exec(last);
    if (match)
        ((current as Record<string, unknown>)[match[1]!] as unknown[])[Number(match[2])] =
            replacement;
    else (current as Record<string, unknown>)[last] = replacement;
}

describe("proposed Vantage context v0", () => {
    it("accepts normal typed handoffs without importing or changing v1", () => {
        expect(validateBusinessRoleContext(normalFixture.roleContext).ok).toBe(true);
        expect(validateRequiredContextBundle(normalFixture.requiredBundle).ok).toBe(true);
        expect(
            validateDynamicRetrievalInput(
                normalFixture.retrievalInput as unknown as DynamicRetrievalInputV0
            ).ok
        ).toBe(true);
        expect(
            validateDynamicRetrievalBundle(
                normalFixture.retrievalBundle,
                normalFixture.retrievalInput as unknown as DynamicRetrievalInputV0
            ).ok
        ).toBe(true);
        expect(
            validateContextResearchPlan(
                normalFixture.researchPlan as unknown as ContextResearchPlanV0,
                { trustedPublicProjections: [trustedProjection] }
            ).ok
        ).toBe(true);
        expect(
            validateContextResearchResult(
                normalFixture.researchResult,
                normalFixture.researchPlan as unknown as ContextResearchPlanV0,
                { trustedPublicProjections: [trustedProjection] }
            ).ok
        ).toBe(true);
        expect(
            validateContextManifest(normalFixture.manifest, { knownCompanyIds: ["company-tilde"] })
                .ok
        ).toBe(true);
    });

    it("keeps source refs object-shaped and dedupes by kind, id and exact version", () => {
        const refs: ContextSourceRefV0[] = [
            { kind: "doc", id: "d1", version: "v1" },
            { kind: "doc", id: "d1", version: "v1" },
            { kind: "doc", id: "d1", version: "v2" },
        ];
        expect(dedupeContextSourceRefs(refs)).toHaveLength(2);
        expect(contextSourceKeyV0(refs[0]!)).toBe("doc:d1@v1");
        expect(
            validateContextManifest({
                ...normalFixture.manifest,
                sourceRegistry: ["ev:evidence-risk-1"],
            }).ok
        ).toBe(false);
    });

    it("keeps delimiter-bearing source keys collision-free while preserving simple keys", () => {
        const idContainsDelimiter: ContextSourceRefV0 = {
            kind: "doc",
            id: "a@b",
            version: "c",
        };
        const versionContainsDelimiter: ContextSourceRefV0 = {
            kind: "doc",
            id: "a",
            version: "b@c",
        };
        expect(contextSourceKeyV0(idContainsDelimiter)).not.toBe(
            contextSourceKeyV0(versionContainsDelimiter)
        );
        expect(contextSourceKeyV0({ kind: "doc", id: "a:b", version: "c" })).not.toBe(
            contextSourceKeyV0({ kind: "doc", id: "a", version: "b:c" })
        );
        expect(contextSourceKeyV0({ kind: "doc", id: "d1", version: "v1" })).toBe("doc:d1@v1");
    });

    it("rejects malformed calendar dates and permissive non-ISO date strings", () => {
        const required = clone(normalFixture.requiredBundle) as unknown as RequiredContextBundleV0;
        required.asOf = "2026-02-30T12:00:00Z";
        expect(validateRequiredContextBundle(required).issues[0]?.code).toBe("invalid_date");

        const retrievalInput = clone(
            normalFixture.retrievalInput
        ) as unknown as DynamicRetrievalInputV0;
        retrievalInput.reportWindow.asOf = "1";
        expect(validateDynamicRetrievalInput(retrievalInput).issues[0]?.code).toBe("invalid_date");

        const sourceDate = clone(
            normalFixture.requiredBundle
        ) as unknown as RequiredContextBundleV0;
        sourceDate.companyArchitecture.sourceDate = "2026-02-30";
        expect(validateRequiredContextBundle(sourceDate).issues[0]?.code).toBe("invalid_date");
    });

    it("rejects each required negative fixture at its ownership seam", () => {
        for (const testCase of negativeCases) {
            const fixture = clone(normalFixture) as unknown as Record<string, unknown>;
            let value = testCase.value as unknown;
            if (testCase.name === "nonfinite-budget") value = Number.POSITIVE_INFINITY;
            setPath(fixture, testCase.mutate, value);
            const checked =
                testCase.name === "cross-company"
                    ? validateRequiredContextBundle(fixture.requiredBundle, {
                          expectedCompanyId: "company-tilde",
                          expectedPrincipalRef: "user-joseph",
                          expectedAclDigest: "acl-tilde-user-joseph-1",
                      })
                    : testCase.name === "role-escalation"
                      ? validateDynamicRetrievalBundle(
                            fixture.retrievalBundle,
                            fixture.retrievalInput as never
                        )
                      : testCase.name === "missing-star"
                        ? validateRequiredContextBundle(fixture.requiredBundle)
                        : testCase.name === "principal-mismatch"
                          ? validateRequiredContextBundle(fixture.requiredBundle, {
                                expectedCompanyId: "company-tilde",
                                expectedPrincipalRef: "user-joseph",
                            })
                          : testCase.name === "acl-mismatch"
                            ? validateRequiredContextBundle(fixture.requiredBundle, {
                                  expectedCompanyId: "company-tilde",
                                  expectedPrincipalRef: "user-joseph",
                                  expectedAclDigest: "acl-tilde-user-joseph-1",
                              })
                            : testCase.name === "unknown-company"
                              ? validateContextManifest(fixture.manifest, {
                                    knownCompanyIds: ["company-tilde"],
                                })
                              : testCase.name === "new-version"
                                ? validateContextManifest(fixture.manifest)
                                : testCase.name === "old-open"
                                  ? validateDynamicRetrievalBundle(fixture.retrievalBundle)
                                  : testCase.name === "dedup" || testCase.name === "outside-as-of"
                                    ? validateDynamicRetrievalBundle(fixture.retrievalBundle)
                                    : testCase.name === "public-query"
                                      ? validateContextResearchPlan(fixture.researchPlan)
                                      : testCase.name === "private-public-audience"
                                        ? validateDynamicRetrievalInput(fixture.retrievalInput)
                                        : testCase.name === "revoked-retrieval"
                                          ? validateDynamicRetrievalBundle(fixture.retrievalBundle)
                                          : testCase.name === "citation-unregistered"
                                            ? validateContextManifest(fixture.manifest)
                                            : testCase.name === "retrieval-source-budget" ||
                                                testCase.name === "retrieval-excerpt-budget" ||
                                                testCase.name === "retrieval-acl-mismatch"
                                              ? validateDynamicRetrievalBundle(
                                                    fixture.retrievalBundle,
                                                    fixture.retrievalInput as never
                                                )
                                              : testCase.name === "research-query-budget"
                                                ? validateContextResearchPlan(fixture.researchPlan)
                                                : validateDynamicRetrievalInput(
                                                      fixture.retrievalInput
                                                  );
            expect(checked.ok, testCase.name).toBe(false);
            expect(
                checked.issues.some(issue => issue.code === testCase.expectedCode),
                testCase.name
            ).toBe(true);
        }
    });

    it("marks required omissions and revoked refs as unable to complete", () => {
        const fixture = clone(normalFixture.requiredBundle) as unknown as RequiredContextBundleV0;
        fixture.coverage.missing.push(clone(fixture.coverage.checked[0]!));
        fixture.status = "blocked";
        expect(validateRequiredContextBundle(fixture).ok).toBe(true);
        expect(
            validateRequiredContextBundle({ ...fixture, status: "complete" }).issues[0]?.code
        ).toBe("required_context_incomplete");
    });

    it("accepts a user with zero personal stars while checking every selected source", () => {
        const fixture = clone(normalFixture.requiredBundle) as unknown as RequiredContextBundleV0;
        fixture.personalVantageStars = [];
        fixture.coverage.checked = fixture.coverage.checked.filter(
            ref => ref.kind !== "doc" || ref.id !== "doc-starred-roadmap"
        );
        fixture.coverage.used = fixture.coverage.used.filter(
            ref => ref.kind !== "doc" || ref.id !== "doc-starred-roadmap"
        );
        expect(validateRequiredContextBundle(fixture).ok).toBe(true);
    });

    it("does not let the stub consumer become a retriever or generator", () => {
        const consumer = createContextManifestConsumerStub({
            knownCompanyIds: ["company-tilde"],
            expectedCompanyId: "company-tilde",
            expectedPrincipalRef: "user-joseph",
            expectedAclDigest: "acl-tilde-user-joseph-1",
        });
        const accepted = consumer.consume(normalFixture.manifest);
        expect(accepted.accepted).toBe(true);
        expect(accepted.registeredSourceRefs).toHaveLength(5);
        expect(
            consumer.consume({
                ...normalFixture.manifest,
                status: "complete",
                coverage: {
                    ...normalFixture.manifest.coverage,
                    revoked: [normalFixture.manifest.coverage.checked[0]],
                },
            }).accepted
        ).toBe(false);
        expect(
            createContextManifestConsumerStub({ knownCompanyIds: ["company-tilde"] }).consume(
                normalFixture.manifest
            ).accepted
        ).toBe(false);
    });
});
