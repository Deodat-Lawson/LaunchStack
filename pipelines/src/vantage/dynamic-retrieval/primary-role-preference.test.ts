import { describe, expect, it } from "vitest";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import sources from "../../../../fixtures/vantage-role-pair-milestone/sources.json";
import { resolveRoleSelectionV0 } from "../role-context-v0/roles";
import type { DynamicRetrievalInputV0, ContextSourceEntryV0 } from "../proposals/context-v0";
import { createDynamicRetrievalProviderV0 } from "./retrieve";
const ids = ["partnerships-lead", "security-engineer"];
function fixture(primary: string, confirmed = true) {
    const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
    input.verifiedRoleContext = resolveRoleSelectionV0({
        principalRef: input.actor.principalRef,
        values: ids,
        primaryRoleId: primary,
        confirmed,
    });
    input.budgets = {
        maxSources: 20,
        maxExcerptChars: 12000,
        maxTokens: 12000,
        maxQueries: 2,
        timeoutMs: 5000,
    };
    const entry = (id: string, excerpt: string): ContextSourceEntryV0 => ({
        source: { kind: "doc", id, version: "v1" },
        companyId: input.actor.companyId,
        aclDigest: "same-acl",
        audience: { kind: "company", companyId: input.actor.companyId },
        access: "allowed",
        sourceDate: "2026-10-16T12:00:00Z",
        checkedAt: input.reportWindow.asOf,
        excerpt,
    });
    input.sourceCatalog = [
        entry("D01", sources.documents.find(d => d.logicalKey === "D01")!.text),
        entry("D08", sources.documents.find(d => d.logicalKey === "D08")!.text),
        entry("noise", "Updated volunteer shirt sizes."),
    ];
    const metadata = input.sourceCatalog.map(value => ({
        source: value.source,
        roleIds: value.source.id === "D01" ? [ids[0]!] : value.source.id === "D08" ? [ids[1]!] : [],
    }));
    return { input, metadata };
}
describe("opt-in actual retrieval primary-role preference", () => {
    it("changes actual rank for only a trusted primary flip while retaining the same authorized source set", async () => {
        const a = fixture(ids[0]!),
            b = fixture(ids[1]!);
        const A = await createDynamicRetrievalProviderV0({
            metadata: a.metadata,
            primaryRolePreference: true,
        }).retrieve(a.input);
        const B = await createDynamicRetrievalProviderV0({
            metadata: b.metadata,
            primaryRolePreference: true,
        }).retrieve(b.input);
        expect([...a.input.verifiedRoleContext.roleIds].sort()).toEqual(
            [...b.input.verifiedRoleContext.roleIds].sort()
        );
        expect(a.input.sourceCatalog).toEqual(b.input.sourceCatalog);
        expect(A.sourceRegistry[0]!.source.id).toBe("D01");
        expect(B.sourceRegistry[0]!.source.id).toBe("D08");
        expect(A.sourceRegistry.map(e => e.source.id).sort()).toEqual(
            B.sourceRegistry.map(e => e.source.id).sort()
        );
        expect(B.diagnostics.scores[0]).toMatchObject({
            primaryRoleId: "security-engineer",
            primaryRoleMatched: true,
            primaryRoleScore: 1,
        });
    });
    it("preserves default ranking and applies no boost to unconfirmed or fallback identity", async () => {
        const a = fixture(ids[0]!),
            b = fixture(ids[1]!);
        const A = await createDynamicRetrievalProviderV0({ metadata: a.metadata }).retrieve(
            a.input
        );
        const B = await createDynamicRetrievalProviderV0({ metadata: b.metadata }).retrieve(
            b.input
        );
        expect(A.sourceRegistry).toEqual(B.sourceRegistry);
        expect(A.diagnostics.scores[0]).not.toHaveProperty("primaryRoleScore");
        const unconfirmed = fixture(ids[1]!, false);
        const U = await createDynamicRetrievalProviderV0({
            metadata: unconfirmed.metadata,
            primaryRolePreference: true,
        }).retrieve(unconfirmed.input);
        expect(
            U.diagnostics.scores.every(
                score => score.primaryRoleScore === 0 && score.primaryRoleId === null
            )
        ).toBe(true);
        const fallback = fixture(ids[1]!);
        fallback.input.verifiedRoleContext = resolveRoleSelectionV0({
            principalRef: fallback.input.actor.principalRef,
            values: ["unmapped role"],
            confirmed: false,
        });
        const F = await createDynamicRetrievalProviderV0({
            metadata: fallback.metadata,
            primaryRolePreference: true,
        }).retrieve(fallback.input);
        expect(
            F.diagnostics.scores.every(
                score => score.primaryRoleScore === 0 && score.primaryRoleId === null
            )
        ).toBe(true);
    });
    it("cannot expand ACL or admit an unauthorized search hit with a preferred-role label", async () => {
        const f = fixture(ids[1]!);
        const foreign = {
            source: { kind: "doc" as const, id: "other-company-secret", version: "v1" },
            roleIds: [ids[1]!],
        };
        const result = await createDynamicRetrievalProviderV0({
            primaryRolePreference: true,
            search: {
                search: async request => ({
                    hits: [...request.allowedSources.map(source => ({ source })), foreign],
                    truncated: false,
                }),
            },
        }).retrieve(f.input);
        expect(result.sourceRegistry.some(entry => entry.source.id === foreign.source.id)).toBe(
            false
        );
        expect(
            result.omissions.some(
                item => item.reason === "out-of-scope" || item.reason === "invalid"
            )
        ).toBe(true);
    });
});
