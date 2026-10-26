/** @jest-environment node */
import { createHash } from "node:crypto";
import {
    buildOrbitCompanyFixture,
    ORBIT_COMPANY_SOURCE_DOCUMENT,
} from "~/server/vantage/experiments/orbit-company-fixture";
import {
    createEmptyMetadata,
    METADATA_SCHEMA_VERSION,
} from "../../../../pipelines/src/company-metadata/types";
import { flattenFacts } from "../../../../pipelines/src/company-metadata/assemble";
import { READER_VERSION } from "../../../../pipelines/src/company-metadata/prompts";
import {
    projectCompanyArchitectureV0,
    type CompanyArchitectureReadSnapshotV0,
} from "../../../../pipelines/src/vantage/context-v0/company-architecture";

const args = {
    companyId: "7",
    documentId: "71",
    versionId: "72",
    now: new Date("2026-10-26T18:30:00.000Z"),
    asOf: "2026-10-26T23:59:00.000Z",
};
const budgets = {
    maxSources: 20,
    maxExcerptChars: 12000,
    maxTokens: 16000,
    timeoutMs: 5000,
    maxQueries: 3,
};
function snapshot(mode: "exact" | "none" = "none"): CompanyArchitectureReadSnapshotV0 {
    const fixture = buildOrbitCompanyFixture({ ...args, quoteMode: mode });
    const metadata = Object.assign(
        createEmptyMetadata(args.companyId, args.now),
        fixture.sourceFacts
    );
    metadata.provenance = {
        total_documents_processed: 1,
        sources_counted: 1,
        extraction_model: "synthetic-fixture/no-model",
        extraction_version: METADATA_SCHEMA_VERSION,
    };
    return {
        actor: {
            principalRef: "synthetic-actor",
            companyId: args.companyId,
            audience: { kind: "actor", principalRef: "synthetic-actor" },
            aclDigest: "synthetic-actor-acl",
        },
        reportWindow: {
            startInclusive: "2026-10-12T04:00:00.000Z",
            endExclusive: "2026-10-19T04:00:00.000Z",
            asOf: args.asOf,
        },
        checkedAt: args.asOf,
        profile: {
            id: "1",
            companyId: args.companyId,
            metadata,
            schemaVersion: METADATA_SCHEMA_VERSION,
            createdAt: args.now.toISOString(),
            updatedAt: args.now.toISOString(),
            builtAt: args.now.toISOString(),
            buildStatus: "idle",
        },
        sourceRows: [
            {
                id: 1,
                companyId: 7n,
                documentId: 71n,
                versionId: 72n,
                role: "about_us",
                roleBy: "rules",
                reason: "Explicit fictional source fixture",
                override: null,
                overrideBy: null,
                status: "done",
                error: null,
                facts: fixture.sourceFacts,
                factCount: 13,
                passages: { total: 13, kept: 13, dropped: {} },
                readerVersion: READER_VERSION,
                modelId: "synthetic-fixture/no-model",
                readAt: args.now,
                createdAt: args.now,
                updatedAt: args.now,
            },
        ],
        documents: [
            {
                id: "71",
                companyId: "7",
                access: "allowed",
                currentVersionId: "72",
                versionCreatedAt: args.now.toISOString(),
                updatedAt: args.now.toISOString(),
                contentFingerprint: createHash("sha256")
                    .update(fixture.sourceDocument.text)
                    .digest("hex"),
            },
        ],
    };
}

describe("pure rich Synthetic Orbit canonical fixture", () => {
    it("represents requested semantics through 13 existing allowed canonical fact paths without a new org graph", () => {
        const input = snapshot();
        const result = projectCompanyArchitectureV0(input, { budgets });
        expect(flattenFacts(input.profile!.metadata)).toHaveLength(13);
        expect(result.status).toBe("available");
        expect(result.includedFactPaths).toEqual(
            expect.arrayContaining([
                "company.name",
                "company.description",
                "company.industry",
                "markets.primary.0",
                "services.0.name",
                "services.0.description",
                "projects.0.name",
                "projects.0.status",
                "profile.facts.responsibilities",
                "profile.facts.priorities",
                "profile.facts.decision_authority",
                "profile.facts.dependencies",
                "policies.privacy_review",
            ])
        );
        expect(result.omittedFactCount).toBe(0);
        expect(input.profile!.metadata.company.description?.value).toContain("Mission:");
        expect(input.profile!.metadata.company.description?.value).toContain("Subscription SaaS");
        expect(input.profile!.metadata.people).toHaveLength(0);
        expect(input.profile!.metadata.projects[0]!.status?.value).toBe(
            "Active assurance workstream; delivery outcome/date unknown."
        );
        const authority = input.profile!.metadata.profile!.facts!.decision_authority!.value;
        expect(authority).toContain("Go, No-Go or Needs More Evidence");
        expect(authority).toContain(
            "Engineering and Operations supply evidence but cannot authorise pilot access"
        );
        expect(authority).toContain("No person or actual decision is recorded");
        const unknowns = result.unknowns.map(value => value.code);
        expect(unknowns).toEqual(
            expect.arrayContaining(["personnel_unknown", "hierarchy_unknown"])
        );
        for (const supplied of [
            "responsibilities_unknown",
            "priorities_unknown",
            "decision_authority_unknown",
            "markets_unknown",
            "services_unknown",
            "projects_unknown",
            "constraints_unknown",
        ])
            expect(unknowns).not.toContain(supplied);
    });
    it("keeps native provenance exact and optional quotes verbatim in the synthetic document", () => {
        const fixture = buildOrbitCompanyFixture({ ...args, quoteMode: "exact" });
        const metadata = snapshot("exact").profile!.metadata;
        for (const { fact } of flattenFacts(metadata)) {
            expect(fact.sources).toEqual([
                {
                    doc_id: 71,
                    version_id: 72,
                    doc_name: fixture.sourceDocument.title,
                    extracted_at: args.now.toISOString(),
                    quote: fact.value,
                },
            ]);
            expect(ORBIT_COMPANY_SOURCE_DOCUMENT.text).toContain(String(fact.value));
        }
        expect(buildOrbitCompanyFixture(args).provenanceMode).toBe(
            "exact-native-version-without-quote"
        );
        expect(
            flattenFacts(snapshot().profile!.metadata).every(({ fact }) =>
                fact.sources.every(source => source.quote === undefined)
            )
        ).toBe(true);
    });
    it("labels the companion human-review record as fictional and never upgrades canonical review state", () => {
        const fixture = buildOrbitCompanyFixture(args),
            record = fixture.fictionalReviewDocument.record;
        expect(fixture.fictionalReviewDocument.text).toContain(
            "FICTIONAL HUMAN-REVIEW FIXTURE — NOT REAL APPROVAL"
        );
        expect(record.boundSources).toEqual([{ documentId: "71", versionId: "72" }]);
        expect(record.fixtureOnly).toBe(true);
        expect(record.authority).toContain("No real human review");
        expect(record.canonicalReviewState).toBe("unreviewed");
        expect(
            projectCompanyArchitectureV0(snapshot(), { budgets }).requiredEntry?.source.reviewState
        ).toBe("unreviewed");
    });
    it.each(["revoked", "wrong-version", "foreign-company"])(
        "fails closed for %s source state without leaking fixture claims",
        failure => {
            const input = snapshot();
            if (failure === "revoked")
                input.documents = [{ ...input.documents[0]!, access: "revoked" }];
            else if (failure === "wrong-version")
                input.documents = [{ ...input.documents[0]!, currentVersionId: "73" }];
            else input.documents = [{ ...input.documents[0]!, companyId: "8" }];
            const result = projectCompanyArchitectureV0(input, { budgets });
            expect(result.requiredEntry).toBeUndefined();
            expect(result.record).toBeUndefined();
            expect(JSON.stringify(result)).not.toContain("Subscription SaaS");
        }
    );
    it("is deterministic and reports actual compact/exact projection byte sizes under unchanged source budgets", () => {
        const compact = projectCompanyArchitectureV0(snapshot(), { budgets }),
            exact = projectCompanyArchitectureV0(snapshot("exact"), { budgets });
        expect(projectCompanyArchitectureV0(snapshot(), { budgets })).toEqual(compact);
        const compactBytes = Buffer.byteLength(compact.record!.excerpt),
            exactBytes = Buffer.byteLength(exact.record!.excerpt);
        expect(compactBytes).toBeLessThan(6500);
        expect(exactBytes).toBeGreaterThan(compactBytes);
        expect(exact.status).toBe("available");
        console.log(
            JSON.stringify({
                syntheticOrbitFactCount: 13,
                compactProjectionBytes: compactBytes,
                exactQuoteProjectionBytes: exactBytes,
                unchangedCompanyExcerptLimit: 12000,
            })
        );
    });
    it("rejects unsafe identities and future fixture timestamps instead of rounding or backdating", () => {
        expect(() => buildOrbitCompanyFixture({ ...args, versionId: "9007199254740993" })).toThrow(
            "exact native identity"
        );
        expect(() => buildOrbitCompanyFixture({ ...args, documentId: "0" })).toThrow(
            "exact native identity"
        );
        expect(() =>
            buildOrbitCompanyFixture({ ...args, now: new Date("2026-10-27T00:00:00.000Z") })
        ).toThrow("reporting cutoff");
    });
});
