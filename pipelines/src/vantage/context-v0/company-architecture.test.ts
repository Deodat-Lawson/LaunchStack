import { describe, expect, it } from "vitest";
import type {
    CompanyProfileSourceRow,
    MetadataFact,
} from "@launchstack/tools/company-context/schema";
import { createEmptyMetadata } from "../../company-metadata/types";
import { READER_VERSION } from "../../company-metadata/prompts";
import { createSourceRegistryV0 } from "./registry";
import {
    collectCompanyArchitectureDocumentIds,
    MAX_COMPANY_ARCHITECTURE_FACTS,
    projectCompanyArchitectureV0,
    type CompanyArchitectureReadSnapshotV0,
    type CompanyArchitectureProjectionOptionsV0,
} from "./company-architecture";

const READ_AT = "2026-10-20T10:00:00.000Z";
const BUILT_AT = "2026-10-20T12:00:00.000Z";
const options: CompanyArchitectureProjectionOptionsV0 = {
    budgets: {
        maxSources: 1,
        maxExcerptChars: 12000,
        maxTokens: 20000,
        timeoutMs: 2000,
        maxQueries: 0,
    },
};
function manual(value: string): MetadataFact {
    return {
        value,
        visibility: "private",
        usage: "no_outreach",
        confidence: 1,
        priority: "manual_override",
        status: "active",
        last_updated: READ_AT,
        sources: [{ doc_id: 0, doc_name: "Manual edit", extracted_at: READ_AT }],
    };
}
function sourced(value: string, ids = [1]): MetadataFact {
    return {
        ...manual(value),
        priority: "normal",
        confidence: 0.9,
        sources: ids.map(id => ({
            doc_id: id,
            doc_name: `Synthetic source ${id}`,
            version_id: id + 10,
            snippet_ref: `chunk:${id}`,
            quote: value,
            extracted_at: READ_AT,
        })),
    };
}
function snapshot(): CompanyArchitectureReadSnapshotV0 {
    const metadata = createEmptyMetadata("42", new Date(BUILT_AT));
    metadata.company = {
        name: manual("Synthetic Acme"),
        description: manual("Provides synthetic invoice export software."),
    };
    return {
        actor: {
            principalRef: "synthetic-actor",
            companyId: "42",
            aclDigest: "synthetic-acl",
            audience: { kind: "actor", principalRef: "synthetic-actor" },
        },
        reportWindow: {
            startInclusive: "2026-10-19T04:00:00.000Z",
            endExclusive: "2026-10-26T04:00:00.000Z",
            asOf: "2026-10-26T17:00:00.000Z",
        },
        checkedAt: "2026-10-26T17:01:00.000Z",
        profile: {
            id: "metadata-row-1",
            companyId: "42",
            schemaVersion: "1.1.0",
            metadata,
            createdAt: "2026-10-19T12:00:00.000Z",
            updatedAt: BUILT_AT,
            builtAt: BUILT_AT,
            buildStatus: "idle",
        },
        sourceRows: [],
        documents: [],
    };
}
function addDocument(input: CompanyArchitectureReadSnapshotV0, id: number) {
    input.documents = [
        ...input.documents,
        {
            id: String(id),
            companyId: "42",
            access: "allowed",
            currentVersionId: String(id + 10),
            versionCreatedAt: "2026-10-19T13:00:00.000Z",
            contentFingerprint: `synthetic-content-${id}`,
            updatedAt: READ_AT,
        },
    ];
    const row: CompanyProfileSourceRow = {
        id,
        companyId: 42n,
        documentId: BigInt(id),
        versionId: BigInt(id + 10),
        role: "about_us",
        roleBy: "model",
        reason: "Synthetic organization account",
        override: null,
        overrideBy: null,
        status: "done",
        error: null,
        facts: { company: { description: sourced("Synthetic account", [id]) } },
        factCount: 1,
        passages: { total: 1, kept: 1, dropped: {} },
        readerVersion: READER_VERSION,
        modelId: "synthetic-extractor",
        readAt: new Date(READ_AT),
        createdAt: new Date(READ_AT),
        updatedAt: new Date(READ_AT),
    };
    input.sourceRows = [...input.sourceRows, row];
}
const project = (
    input = snapshot(),
    overrides: Partial<CompanyArchitectureProjectionOptionsV0> = {}
) => projectCompanyArchitectureV0(input, { ...options, ...overrides });
const facts = (result: ReturnType<typeof project>) =>
    JSON.parse(result.record!.content!).facts as Array<{
        path: string;
        value: string;
        subject?: string;
        basis: string;
        sources: Array<{
            documentId: string;
            versionId: string | null;
            snippetRef: string | null;
            page: number | null;
        }>;
    }>;

describe("pure Company Architecture projection v0", () => {
    it("returns useful unreviewed context without claiming whole-profile human approval or a full bundle", () => {
        const result = project();
        expect(result.status).toBe("available");
        expect(result.requiredEntry?.source).toMatchObject({
            kind: "company",
            id: "company-metadata/42",
            companyId: "42",
            canonical: true,
            reviewState: "unreviewed",
        });
        expect(result.requiredEntry?.audience).toEqual({ kind: "company", companyId: "42" });
        expect(result).not.toHaveProperty("companyArchitecture");
        expect(facts(result).every(fact => fact.basis === "human-entered-unreviewed")).toBe(true);
        expect(result.unknowns.map(item => item.code)).toEqual(
            expect.arrayContaining([
                "responsibilities_unknown",
                "hierarchy_unknown",
                "decision_authority_unknown",
                "markets_unknown",
                "services_unknown",
            ])
        );
        const registry = createSourceRegistryV0({
            actor: snapshot().actor,
            reportWindow: snapshot().reportWindow,
            trustedCatalog: [result.record!],
        });
        expect(registry.ok).toBe(true);
    });

    it("accepts all-current authorized extracted facts while maxSources counts the one emitted entry", () => {
        const input = snapshot();
        input.profile!.metadata.company.description = sourced(
            "Builds synthetic invoice software.",
            [1, 2]
        );
        addDocument(input, 1);
        addDocument(input, 2);
        const before = structuredClone(input),
            result = project(input);
        expect(result.status).toBe("available");
        expect(
            facts(result)
                .find(fact => fact.path === "company.description")
                ?.sources.map(source => source.documentId)
        ).toEqual(["1", "2"]);
        expect(input).toEqual(before);
    });

    it("keeps reserved manual source zero from masquerading as a document/version citation", () => {
        const input = snapshot();
        const source = input.profile!.metadata.company.name!.sources[0]!;
        source.version_id = 987;
        source.snippet_ref = "chunk:987";
        source.page = 987;
        const result = project(input);
        const name = facts(result).find(fact => fact.path === "company.name")!;
        expect(result.status).toBe("available");
        expect(name.basis).toBe("human-entered-unreviewed");
        expect(name.sources[0]).toMatchObject({
            documentId: "0",
            versionId: null,
            snippetRef: null,
            page: null,
        });
        expect(result.requiredEntry!.source.reviewState).toBe("unreviewed");
    });

    it("blocks over 512 raw facts before ontology filtering without clipping or mutating the profile", () => {
        const input = snapshot();
        for (let index = 0; index < MAX_COMPANY_ARCHITECTURE_FACTS - 2; index++)
            input.profile!.metadata.company[`outside_ontology_${index}`] =
                manual("Synthetic ignored fact.");
        expect(project(input).status).toBe("available");
        input.profile!.metadata.company.one_more_ignored = manual("Synthetic ignored fact.");
        const before = structuredClone(input);
        const result = project(input);
        expect(result.status).toBe("blocked");
        expect(result.unknowns).toContainEqual({ code: "profile_fact_limit" });
        expect(result.record).toBeUndefined();
        expect(result.requiredEntry).toBeUndefined();
        expect(input).toEqual(before);
    });

    it("collects all raw dependencies before ontology/citation caps, including a thirteenth quote-less source", () => {
        const input = snapshot(),
            metadata = input.profile!.metadata;
        metadata.profile!.summary = sourced(
            "Fused organization interpretation",
            Array.from({ length: 13 }, (_, index) => index + 1)
        );
        delete metadata.profile!.summary.sources[12]!.quote;
        metadata.people = [
            { name: manual("Synthetic user"), email: sourced("private@example.invalid", [14]) },
        ];
        expect(collectCompanyArchitectureDocumentIds(metadata, 14)).toEqual(
            Array.from({ length: 14 }, (_, index) => String(index + 1))
        );
        expect(() => collectCompanyArchitectureDocumentIds(metadata, 13)).toThrow(
            "dependency limit"
        );
        expect(collectCompanyArchitectureDocumentIds(null, 0)).toEqual([]);
    });

    it.each([-1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, "1"])(
        "refuses unsafe raw document identity %p",
        id => {
            const input = snapshot();
            input.profile!.metadata.company.description!.sources[0]!.doc_id = id as number;
            expect(() =>
                collectCompanyArchitectureDocumentIds(input.profile!.metadata, 128)
            ).toThrow("invalid document identity");
            expect(project(input).status).toBe("blocked");
        }
    );

    it("withholds an entire fused fact if one of its sources is hidden without returning hidden prose or identities", () => {
        const input = snapshot();
        input.profile!.metadata.policies.delivery = sourced(
            "HIDDEN-UNION-VALUE from two sources",
            [1, 2]
        );
        addDocument(input, 1);
        addDocument(input, 2);
        input.documents[1]!.access = "revoked";
        const result = project(input);
        expect(result.status).toBe("partial");
        expect(result.requiredEntry).toBeUndefined();
        expect(result.record).toBeDefined();
        expect(result.record).not.toHaveProperty("required");
        expect(JSON.stringify(result)).not.toContain("HIDDEN-UNION-VALUE");
        expect(result.record!.content).not.toContain('"documentId":"2"');
        expect(result.omittedFactCount).toBe(1);
    });

    it("does not let manual_override bypass any positive document dependency", () => {
        const input = snapshot();
        input.profile!.metadata.policies.private = {
            ...sourced("MANUAL-WITH-HIDDEN-SOURCE", [1]),
            priority: "manual_override",
        };
        addDocument(input, 1);
        input.documents[0]!.access = "revoked";
        const result = project(input);
        expect(result.status).toBe("partial");
        expect(result.record!.excerpt).not.toContain("MANUAL-WITH-HIDDEN-SOURCE");
    });

    it("checks the thirteenth synthesized dependency beyond the excerpt cap", () => {
        const input = snapshot();
        input.profile!.metadata.profile!.summary = sourced(
            "HIDDEN-SUMMARY-VALUE",
            Array.from({ length: 13 }, (_, index) => index + 1)
        );
        for (let id = 1; id <= 13; id++) addDocument(input, id);
        delete input.profile!.metadata.profile!.summary.sources[12]!.quote;
        input.documents[12]!.access = "revoked";
        const result = project(input);
        expect(result.status).toBe("partial");
        expect(result.record!.excerpt).not.toContain("HIDDEN-SUMMARY-VALUE");
    });

    it.each(["people", "services", "projects"] as const)(
        "does not attach visible %s details to a hidden subject name",
        section => {
            const input = snapshot();
            addDocument(input, 1);
            addDocument(input, 2);
            input.documents[1]!.access = "revoked";
            const details =
                section === "people"
                    ? { role: sourced("VISIBLE-ROLE-PRIVATE-IDENTITY", [1]) }
                    : { description: sourced("VISIBLE-DETAIL-PRIVATE-IDENTITY", [1]) };
            input.profile!.metadata[section] = [
                { name: sourced("HIDDEN-IDENTITY", [2]), ...details },
            ];
            const result = project(input);
            expect(result.status).toBe("partial");
            expect(result.record!.excerpt).not.toMatch(
                /HIDDEN-IDENTITY|VISIBLE-ROLE|VISIBLE-DETAIL/
            );
        }
    );

    it("includes every subject-name dependency in the compound field provenance", () => {
        const input = snapshot();
        addDocument(input, 1);
        addDocument(input, 2);
        input.profile!.metadata.people = [
            { name: sourced("Synthetic Mira", [2]), role: sourced("Acceptance reviewer", [1]) },
        ];
        const result = project(input),
            role = facts(result).find(fact => fact.path === "people.0.role")!;
        expect(result.status).toBe("available");
        expect(role.subject).toBe("Synthetic Mira");
        expect(role.sources.map(source => source.documentId)).toEqual(["1", "2"]);
        expect(result.unknowns.map(item => item.code)).toContain("responsibilities_unknown");
    });

    it("does not infer responsibility, hierarchy or decision authority from CEO titles", () => {
        const input = snapshot();
        input.profile!.metadata.people = [
            { name: manual("Synthetic founder"), role: manual("CEO") },
        ];
        let result = project(input);
        expect(result.unknowns.map(item => item.code)).toEqual(
            expect.arrayContaining([
                "responsibilities_unknown",
                "hierarchy_unknown",
                "decision_authority_unknown",
            ])
        );
        input.profile!.metadata.people[0]!.responsibilities = manual(
            "Reviews synthetic acceptance results."
        );
        input.profile!.metadata.profile!.facts = {
            decision_authority: {
                ...manual("The synthetic review council approves pilot access."),
                label: "Decision authority",
            },
        };
        result = project(input);
        expect(result.unknowns.map(item => item.code)).not.toContain("responsibilities_unknown");
        expect(result.unknowns.map(item => item.code)).not.toContain("decision_authority_unknown");
        expect(result.unknowns.map(item => item.code)).toContain("hierarchy_unknown");
    });

    it("excludes contact fields and arbitrary derived views without a security-partial classification", () => {
        const input = snapshot();
        input.profile!.metadata.people = [
            {
                name: manual("Synthetic person"),
                email: manual("HIDDEN-CONTACT"),
                phone: manual("HIDDEN-PHONE"),
            },
        ];
        input.profile!.metadata.derived_views = { arbitrary: "UNTRUSTED-DERIVED-CONTENT" };
        const result = project(input);
        expect(result.status).toBe("available");
        expect(result.record!.excerpt).not.toMatch(/HIDDEN-CONTACT|HIDDEN-PHONE|UNTRUSTED-DERIVED/);
        expect(result.unknowns).toContainEqual({ code: "outside_declared_ontology", count: 2 });
    });

    it.each([
        "missing",
        "building",
        "failed",
        "unbuilt",
        "old-schema",
        "row-schema",
        "company",
        "metadata-company",
        "future-profile",
    ])("blocks %s canonical profile state", mutation => {
        const input = snapshot();
        if (mutation === "missing") input.profile = null;
        else if (mutation === "building" || mutation === "failed")
            input.profile!.buildStatus = mutation;
        else if (mutation === "unbuilt") input.profile!.builtAt = null;
        else if (mutation === "old-schema") {
            input.profile!.schemaVersion = "1.0.0";
            input.profile!.metadata.schema_version = "1.0.0";
        } else if (mutation === "row-schema") input.profile!.schemaVersion = "other";
        else if (mutation === "company") input.profile!.companyId = "43";
        else if (mutation === "metadata-company") input.profile!.metadata.company_id = "43";
        else input.profile!.metadata.updated_at = "2026-10-27T12:00:00.000Z";
        const result = project(input);
        expect(result.status).toBe("blocked");
        expect(result.record).toBeUndefined();
        expect(result.requiredEntry).toBeUndefined();
        if (mutation === "building")
            expect(result.unknowns).toContainEqual({ code: "profile_building" });
        if (mutation === "failed")
            expect(result.unknowns).toContainEqual({ code: "profile_failed" });
        if (mutation === "unbuilt")
            expect(result.unknowns).toContainEqual({ code: "profile_not_built" });
    });

    it.each([
        "missing-row",
        "failed-row",
        "pending-row",
        "known-error",
        "missing-read-time",
        "newer-read",
        "newer-update",
        "old-reader",
        "new-version",
        "legacy-version",
        "future-source",
        "expired",
    ])("withholds unsafe/stale candidate %s", mutation => {
        const input = snapshot();
        addDocument(input, 1);
        input.profile!.metadata.policies.acceptance = sourced("UNSAFE-ACCEPTANCE-CONTENT", [1]);
        const row = input.sourceRows[0]!,
            fact = input.profile!.metadata.policies.acceptance;
        if (mutation === "missing-row") input.sourceRows = [];
        else if (mutation === "failed-row") row.status = "failed";
        else if (mutation === "pending-row") row.status = "pending";
        else if (mutation === "known-error") row.error = "Synthetic read failure";
        else if (mutation === "missing-read-time") row.readAt = null;
        else if (mutation === "newer-read") row.readAt = new Date("2026-10-21T10:00:00Z");
        else if (mutation === "newer-update") row.updatedAt = new Date("2026-10-21T10:00:00Z");
        else if (mutation === "old-reader") row.readerVersion = "old-reader";
        else if (mutation === "new-version") input.documents[0]!.currentVersionId = "99";
        else if (mutation === "legacy-version") delete fact.sources[0]!.version_id;
        else if (mutation === "future-source")
            fact.sources[0]!.extracted_at = "2026-10-27T10:00:00Z";
        else fact.valid_to = "2026-10-25";
        const result = project(input);
        expect(result.status).toBe("partial");
        expect(result.requiredEntry).toBeUndefined();
        expect(result.record!.excerpt).not.toContain("UNSAFE-ACCEPTANCE-CONTENT");
    });

    it("never lets explicit required paths remove the identity/usefulness minimum", () => {
        const input = snapshot();
        delete input.profile!.metadata.company.description;
        expect(project(input, { requiredFactPaths: [] }).status).toBe("blocked");
        expect(project(input, { requiredFactPaths: ["company.name"] }).status).toBe("blocked");
        input.profile!.metadata.company.description = manual("Useful synthetic description.");
        delete input.profile!.metadata.company.name;
        expect(project(input, { requiredFactPaths: ["company.description"] }).status).toBe(
            "blocked"
        );
        expect(project(snapshot(), { requiredFactPaths: ["company.industry"] }).status).toBe(
            "blocked"
        );
    });

    it("keeps canonical and projection identity deterministic while binding actor authorization separately", () => {
        const input = snapshot();
        addDocument(input, 1);
        addDocument(input, 2);
        input.profile!.metadata.policies.acceptance = sourced(
            "Synthetic acceptance criteria.",
            [1, 2]
        );
        const a = project(input),
            reversed = structuredClone(input);
        reversed.documents = [...reversed.documents].reverse();
        reversed.sourceRows = [...reversed.sourceRows].reverse();
        reversed.profile!.metadata.policies.acceptance!.sources.reverse();
        expect(project(reversed).record!.source.version).toBe(a.record!.source.version);
        const clock = structuredClone(input);
        clock.checkedAt = "2026-10-26T18:00:00Z";
        expect(project(clock).record!.source.version).toBe(a.record!.source.version);
        const principal = structuredClone(input);
        principal.actor.principalRef = "another-actor";
        principal.actor.audience.principalRef = "another-actor";
        const b = project(principal);
        expect(b.canonicalFingerprint).toBe(a.canonicalFingerprint);
        expect(b.projectionFingerprint).toBe(a.projectionFingerprint);
        expect(b.accessFingerprint).not.toBe(a.accessFingerprint);
        expect(b.record!.source.version).not.toBe(a.record!.source.version);
        const acl = structuredClone(input);
        acl.actor.aclDigest = "new-permissions";
        expect(project(acl).record!.source.version).not.toBe(a.record!.source.version);
    });

    it.each(["quote", "content", "model", "profile-value"])(
        "invalidates exact identity on %s changes even if a path/value cache hash could stay stable",
        mutation => {
            const input = snapshot();
            addDocument(input, 1);
            input.profile!.metadata.policies.acceptance = sourced("Synthetic acceptance criteria.");
            const old = project(input);
            if (mutation === "quote")
                input.profile!.metadata.policies.acceptance.sources[0]!.quote =
                    "Changed supporting words.";
            else if (mutation === "content")
                input.documents[0]!.contentFingerprint = "changed-content-same-version";
            else if (mutation === "model") input.sourceRows[0]!.modelId = "different-extractor";
            else
                input.profile!.metadata.company.description!.value =
                    "A changed synthetic business description.";
            expect(project(input).record!.source.version).not.toBe(old.record!.source.version);
        }
    );

    it("drops whole optional fields when the excerpt budget is tight and refuses insufficient required context", () => {
        const input = snapshot();
        input.profile!.metadata.policies.lengthy = manual("synthetic-long-policy ".repeat(250));
        const result = project(input, { budgets: { ...options.budgets, maxExcerptChars: 2400 } });
        expect(result.status).toBe("partial");
        expect(result.requiredEntry).toBeUndefined();
        expect(result.record!.excerpt.length).toBeLessThanOrEqual(2400);
        expect(result.record!.excerpt).not.toContain("synthetic-long-policy");
        expect(
            project(input, { budgets: { ...options.budgets, maxExcerptChars: 50 } }).record
        ).toBeUndefined();
        expect(project(input, { budgets: { ...options.budgets, maxTokens: 1 } }).status).toBe(
            "blocked"
        );
    });

    it.each([
        "missing-actor",
        "wrong-audience",
        "invalid-window",
        "cross-company-doc",
        "conflicting-doc",
    ])("fails closed for %s", mutation => {
        const input = snapshot();
        if (mutation === "missing-actor") input.actor.principalRef = "";
        else if (mutation === "wrong-audience") input.actor.audience.principalRef = "other";
        else if (mutation === "invalid-window") input.reportWindow.asOf = "2026-02-30T12:00:00Z";
        else {
            addDocument(input, 1);
            if (mutation === "cross-company-doc") input.documents[0]!.companyId = "43";
            else
                input.documents = [
                    ...input.documents,
                    { ...input.documents[0]!, access: "revoked" },
                ];
        }
        expect(project(input).status).toBe("blocked");
    });
});
