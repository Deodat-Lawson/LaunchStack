import { describe, expect, it } from "vitest";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import { resolveRoleSelectionV0 } from "../role-context-v0/roles";
import type { DynamicRetrievalInputV0 } from "../proposals/context-v0";
import { createDynamicRetrievalProviderV0 } from "./retrieve";
import type { RetrievalMetadataV0 } from "./types";

function fixture(primaryRoleId = "engineering", confirmed = true) {
    const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
    input.verifiedRoleContext = resolveRoleSelectionV0({
        principalRef: input.actor.principalRef,
        values: ["CEO", "CTO"],
        primaryRoleId,
        confirmed,
    });
    input.budgets = {
        maxSources: 10,
        maxExcerptChars: 8000,
        maxTokens: 8000,
        maxQueries: 2,
        timeoutMs: 5000,
    };
    input.sourceCatalog = ["a-founder", "b-engineering", "noise"].map(id => ({
        source: { kind: "doc", id, version: "v1" },
        companyId: input.actor.companyId,
        aclDigest: "company-acl",
        access: "allowed",
        audience: { kind: "company", companyId: input.actor.companyId },
        checkedAt: input.reportWindow.asOf,
        sourceDate: "2026-10-16T00:00:00Z",
        excerpt: id === "noise" ? "Cafeteria menu" : "Authorized update",
    }));
    const metadata: RetrievalMetadataV0[] = input.sourceCatalog.map(entry => ({
        source: entry.source,
        roleIds:
            entry.source.id === "a-founder"
                ? ["founder"]
                : entry.source.id === "b-engineering"
                  ? ["engineering"]
                  : [],
    }));
    return { input, metadata };
}

describe("Joseph role selection and explainable retrieval scores", () => {
    it("changes ranking for a confirmed primary role without dropping secondary-role evidence", async () => {
        const a = fixture("founder"),
            b = fixture("engineering");
        const retrieve = (f: ReturnType<typeof fixture>) =>
            createDynamicRetrievalProviderV0({
                metadata: f.metadata,
                selectionPolicy: "focused",
                primaryRolePreference: true,
            }).retrieve(f.input);
        const A = await retrieve(a),
            B = await retrieve(b);
        expect(A.sourceRegistry.map(e => e.source.id)).toEqual(["a-founder", "b-engineering"]);
        expect(B.sourceRegistry.map(e => e.source.id)).toEqual(["b-engineering", "a-founder"]);
        expect(B.diagnostics.scores[0]).toMatchObject({
            relevance: 1,
            primaryRoleScore: 1,
            primaryRoleId: "engineering",
            trust: 0.5,
        });
        expect(B.diagnostics.excluded).toEqual([
            { source: b.input.sourceCatalog[2]!.source, reason: "irrelevant-recent" },
        ]);
    });

    it.each(["default", "unconfirmed", "fallback"])(
        "keeps primary preference neutral for %s context",
        async mode => {
            const f = fixture("engineering", mode !== "unconfirmed");
            if (mode === "fallback")
                f.input.verifiedRoleContext = resolveRoleSelectionV0({
                    principalRef: f.input.actor.principalRef,
                    values: ["CEO", "CTO", "unknown"],
                    primaryRoleId: "engineering",
                    confirmed: true,
                });
            const result = await createDynamicRetrievalProviderV0({
                metadata: f.metadata,
                primaryRolePreference: mode !== "default",
            }).retrieve(f.input);
            expect(result.sourceRegistry[0]!.source.id).toBe("a-founder");
            if (mode === "default")
                expect(result.diagnostics.scores[0]).not.toHaveProperty("primaryRoleScore");
            else
                expect(
                    result.diagnostics.scores.every(
                        s => s.primaryRoleScore === 0 && s.primaryRoleId === null
                    )
                ).toBe(true);
        }
    );

    it("keeps older explicit open work ahead of primary-role material under a source cap", async () => {
        const f = fixture();
        f.input.sourceCatalog[0]!.sourceDate = "2026-09-01T00:00:00Z";
        f.metadata[0]!.state = { asOf: f.input.reportWindow.asOf, value: "open" };
        f.input.budgets.maxSources = 1;
        const result = await createDynamicRetrievalProviderV0({
            metadata: f.metadata,
            primaryRolePreference: true,
        }).retrieve(f.input);
        expect(result.sourceRegistry.map(e => e.source.id)).toEqual(["a-founder"]);
        expect(result.unresolvedOlderItems).toHaveLength(1);
        expect(result.status).toBe("partial");
    });

    it("explains the keyword numerator, denominator, explicit tag override and ownership", async () => {
        const f = fixture();
        f.input.verifiedRoleContext.roles = [
            {
                roleId: "engineering",
                description: "Engineering",
                responsibilities: ["reliability reliability"],
                priorities: ["deployment and the"],
            },
            {
                roleId: "founder",
                description: "Founder",
                responsibilities: ["runway"],
                priorities: [],
            },
        ];
        f.input.sourceCatalog[0]!.excerpt = "Reliability deployment deployment";
        f.metadata[0]!.roleIds = [];
        f.metadata[2]!.ownerPrincipalRefs = [f.input.actor.principalRef];
        const result = await createDynamicRetrievalProviderV0({
            metadata: f.metadata,
            selectionPolicy: "focused",
        }).retrieve(f.input);
        const lexical = result.diagnostics.scores.find(s => s.source.id === "a-founder")!;
        expect(lexical.relevance).toBeCloseTo(2 / 3);
        expect(lexical.roleScores.find(s => s.roleId === "engineering")).toEqual({
            roleId: "engineering",
            matchedTerms: ["deployment", "reliability"],
            totalTerms: 3,
            explicitRoleMatch: false,
            score: 2 / 3,
        });
        expect(
            result.diagnostics.scores.find(s => s.source.id === "b-engineering")!.roleScores[0]
        ).toMatchObject({ explicitRoleMatch: true, matchedTerms: [], score: 1 });
        expect(result.diagnostics.scores.find(s => s.source.id === "noise")).toMatchObject({
            relevance: 0,
            ownerMatch: true,
        });
    });

    it("cannot use a preferred-role tag to admit foreign sources or revive revoked ones", async () => {
        const f = fixture();
        f.input.sourceCatalog[1]!.access = "revoked";
        f.input.sourceCatalog[1]!.excerpt = "";
        const result = await createDynamicRetrievalProviderV0({
            primaryRolePreference: true,
            search: {
                search: async request => ({
                    hits: [
                        ...request.allowedSources.map(source => ({
                            source,
                            roleIds: ["engineering"],
                        })),
                        {
                            source: { kind: "doc", id: "secret", version: "v1" },
                            roleIds: ["engineering"],
                        },
                    ],
                    truncated: false,
                }),
            },
        }).retrieve(f.input);
        expect(result.sourceRegistry.map(e => e.source.id)).not.toContain("secret");
        expect(result.sourceRegistry.map(e => e.source.id)).not.toContain("b-engineering");
        expect(JSON.stringify(result.diagnostics)).not.toContain("secret");
    });
});
