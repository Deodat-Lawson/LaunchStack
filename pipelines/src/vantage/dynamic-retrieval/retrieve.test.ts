import { describe, expect, it, vi } from "vitest";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import { createDynamicRetrievalProviderV0 } from "./retrieve";
import { founderChangeMetadataV0 } from "./founder-changes";
import { assembleContextManifestV0 } from "../context-v0/assembler";
import { createSourceRegistryV0 } from "../context-v0/registry";
import {
    validateDynamicRetrievalBundle,
    type DynamicRetrievalInputV0,
    type ContextSourceEntryV0,
    type RequiredContextBundleV0,
} from "../proposals/context-v0";
import type { RetrievalMetadataV0, RetrievalSearchPortV0 } from "./types";

function fixture() {
    const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
    input.budgets = {
        maxSources: 20,
        maxExcerptChars: 8000,
        maxTokens: 8000,
        maxQueries: 2,
        timeoutMs: 5000,
    };
    input.verifiedRoleContext.roleIds = ["founder", "engineering"];
    input.verifiedRoleContext.roles = [
        {
            roleId: "founder",
            description: "Founder",
            responsibilities: ["fundraising"],
            priorities: ["runway"],
        },
        {
            roleId: "engineering",
            description: "Engineering",
            responsibilities: ["reliability"],
            priorities: ["deployment"],
        },
    ];
    function source(
        id: string,
        excerpt: string,
        sourceDate = "2026-10-16T00:00:00Z"
    ): ContextSourceEntryV0 {
        return {
            source: { kind: "doc", id, version: "v1" },
            companyId: input.actor.companyId,
            aclDigest: "company-acl",
            access: "allowed",
            audience: { kind: "company", companyId: input.actor.companyId },
            checkedAt: input.reportWindow.asOf,
            sourceDate,
            excerpt,
        };
    }
    input.sourceCatalog = [
        source("old-open", "Deployment blocked by reliability issue", "2026-09-01T00:00:00Z"),
        source("old-closed", "Deployment fixed", "2026-09-01T00:00:00Z"),
        source("funding", "Fundraising runway update"),
        source("recent-other", "Cafeteria lunch menu"),
    ];
    const metadata: RetrievalMetadataV0[] = [
        {
            source: input.sourceCatalog[0]!.source,
            state: { asOf: input.reportWindow.asOf, value: "open" },
        },
        {
            source: input.sourceCatalog[1]!.source,
            state: { asOf: input.reportWindow.asOf, value: "resolved" },
        },
    ];
    return { input, metadata, source };
}

describe("Sophia deterministic retrieval", () => {
    it("compares metadata by meaning rather than property or tag order", async () => {
        const { input } = fixture();
        const result = await createDynamicRetrievalProviderV0({
            search: {
                search: async request => ({
                    hits: request.allowedSources.map(source =>
                        request.lane === "role"
                            ? { source, topics: ["deployment", "reliability"], trust: 0.5 }
                            : { trust: 0.5, topics: ["reliability", "deployment"], source }
                    ),
                    truncated: false,
                }),
            },
        }).retrieve(input);
        expect(result.status).toBe("complete");
        expect(result.sourceRegistry).toHaveLength(4);
    });

    it("omits conflicting metadata returned by the two searches", async () => {
        const { input } = fixture();
        const result = await createDynamicRetrievalProviderV0({
            search: {
                search: async request => ({
                    hits: request.allowedSources.map(source => ({
                        source,
                        state: {
                            asOf: input.reportWindow.asOf,
                            value: request.lane === "role" ? "open" : "resolved",
                        },
                    })),
                    truncated: false,
                }),
            },
        }).retrieve(input);
        expect(result.status).toBe("partial");
        expect(result.sourceRegistry).toEqual([]);
    });

    it("rejects excerpts whose offsets do not identify the cited version", async () => {
        const { input } = fixture();
        const entry = input.sourceCatalog[0]!;
        entry.excerptOffsets = {
            start: 0,
            end: entry.excerpt.length,
            sourceVersion: "different-version",
        };
        await expect(createDynamicRetrievalProviderV0().retrieve(input)).rejects.toThrow(
            "invalid or unauthorized"
        );
    });
    it("selects both roles, carries old open work and assigns each source to one category", async () => {
        const { input, metadata } = fixture();
        const result = await createDynamicRetrievalProviderV0({ metadata }).retrieve(input);
        expect(result.unresolvedOlderItems.map(item => item.source.id)).toEqual(["old-open"]);
        expect(result.roleMatches.map(item => item.source.id)).toEqual(["old-closed"]);
        expect(result.recentChanges.find(item => item.source.id === "funding")?.roleIds).toEqual([
            "founder",
        ]);
        expect(
            result.recentChanges.find(item => item.source.id === "recent-other")?.roleIds
        ).toEqual([]);
        expect(result.deduped.map(ref => ref.id)).toContain("funding");
        expect(result.sourceRegistry).toHaveLength(4);
        expect(validateDynamicRetrievalBundle(result, input).issues).toEqual([]);
    });

    it("does not let a recent irrelevant document displace an older blocker", async () => {
        const { input, metadata } = fixture();
        input.budgets.maxSources = 1;
        const result = await createDynamicRetrievalProviderV0({ metadata }).retrieve(input);
        expect(result.sourceRegistry.map(item => item.source.id)).toEqual(["old-open"]);
        expect(result.status).toBe("partial");
        expect(result.omissions.filter(item => item.reason === "budget")).toHaveLength(3);
    });

    it("is independent of catalog, role and metadata order and does not mutate input", async () => {
        const { input, metadata } = fixture();
        const before = structuredClone(input);
        const first = await createDynamicRetrievalProviderV0({ metadata }).retrieve(input);
        expect(input).toEqual(before);
        input.sourceCatalog.reverse();
        input.verifiedRoleContext.roles.reverse();
        metadata.reverse();
        expect(await createDynamicRetrievalProviderV0({ metadata }).retrieve(input)).toEqual(first);
    });

    it.each(["company", "actor", "future"])(
        "fails closed for %s catalog input without echoing excerpts",
        async kind => {
            const { input } = fixture();
            const entry = input.sourceCatalog[0]!;
            entry.excerpt = "SECRET-CONTENT";
            if (kind === "company") entry.companyId = "company-other";
            if (kind === "actor") entry.audience = { kind: "actor", principalRef: "other-user" };
            if (kind === "future") entry.sourceDate = "2027-01-01T00:00:00Z";
            await expect(createDynamicRetrievalProviderV0().retrieve(input)).rejects.toThrow(
                "invalid or unauthorized"
            );
        }
    );

    it("keeps revoked sources out of selected content", async () => {
        const { input } = fixture();
        input.sourceCatalog[0]!.access = "revoked";
        input.sourceCatalog[0]!.excerpt = "";
        const result = await createDynamicRetrievalProviderV0().retrieve(input);
        expect(result.sourceRegistry.some(entry => entry.source.id === "old-open")).toBe(false);
        expect(result.omissions).toContainEqual({
            source: input.sourceCatalog[0]!.source,
            reason: "revoked",
        });
    });

    it("uses half-open event timestamps and does not infer historical open state", async () => {
        const { input, source } = fixture();
        input.sourceCatalog = [
            source("start", "neutral", input.reportWindow.startInclusive),
            source("end", "neutral", input.reportWindow.endExclusive),
        ];
        const result = await createDynamicRetrievalProviderV0().retrieve(input);
        expect(result.recentChanges.map(item => item.source.id)).toEqual(["start"]);
        expect(result.unresolvedOlderItems).toEqual([]);
    });

    it("rejects state snapshots from a different reporting cutoff", async () => {
        const { input, metadata } = fixture();
        metadata[0]!.state!.asOf = "2026-10-20T00:00:00Z";
        const result = await createDynamicRetrievalProviderV0({ metadata }).retrieve(input);
        expect(result.sourceRegistry.some(entry => entry.source.id === "old-open")).toBe(false);
        expect(result.status).toBe("partial");
    });

    it("collapses proven connector copies but preserves independent conflicting measurements", async () => {
        const { input, source } = fixture();
        input.sourceCatalog = [
            source("copy-a", "Fundraising runway 6 months"),
            source("copy-b", "Fundraising runway 6 months"),
            source("conflict", "Fundraising runway 3 months"),
        ];
        const origin = { connector: "gmail", id: "thread-1", revision: "rev-1" };
        const metadata = input.sourceCatalog
            .slice(0, 2)
            .map(entry => ({ source: entry.source, origin }));
        const result = await createDynamicRetrievalProviderV0({ metadata }).retrieve(input);
        expect(result.sourceRegistry.map(entry => entry.source.id).sort()).toEqual([
            "conflict",
            "copy-a",
        ]);
        expect(result.omissions).toContainEqual({
            source: input.sourceCatalog[1]!.source,
            reason: "duplicate",
        });
        expect(result.deduped.map(ref => ref.id)).toContain("copy-a");
    });

    it("enforces aggregate character and conservative token limits without altering excerpts", async () => {
        const { input } = fixture();
        input.budgets.maxExcerptChars = 35;
        input.budgets.maxTokens = 30;
        const result = await createDynamicRetrievalProviderV0().retrieve(input);
        expect(result.diagnostics.excerptChars).toBeLessThanOrEqual(35);
        expect(result.diagnostics.tokenUpperBound).toBeLessThanOrEqual(30);
        for (const entry of result.sourceRegistry)
            expect(entry.excerpt).toBe(
                input.sourceCatalog.find(e => e.source.id === entry.source.id)!.excerpt
            );
        expect(result.status).toBe("partial");
    });

    it.each([0, 1, 2])("enforces a query budget of %i", async maxQueries => {
        const { input } = fixture();
        input.budgets.maxQueries = maxQueries;
        const search = vi.fn<RetrievalSearchPortV0["search"]>(async request => ({
            hits: request.allowedSources.map(source => ({ source })),
            truncated: false,
        }));
        const result = await createDynamicRetrievalProviderV0({ search: { search } }).retrieve(
            input
        );
        expect(search).toHaveBeenCalledTimes(maxQueries);
        expect(result.diagnostics.queries).toBe(maxQueries);
        if (!maxQueries) expect(result.status).toBe("partial");
    });

    it("returns an explicit complete empty corpus", async () => {
        const { input } = fixture();
        input.sourceCatalog = [];
        const result = await createDynamicRetrievalProviderV0().retrieve(input);
        expect(result.status).toBe("complete");
        expect(result.sourceRegistry).toEqual([]);
    });

    it("aborts a hung search and reports timeout without private error text", async () => {
        const { input } = fixture();
        input.budgets.timeoutMs = 20;
        let signal: AbortSignal | undefined;
        const result = await createDynamicRetrievalProviderV0({
            search: {
                search: request => {
                    signal = request.signal;
                    return new Promise(() => {});
                },
            },
        }).retrieve(input);
        expect(signal?.aborted).toBe(true);
        expect(result.status).toBe("timeout");
        expect(result.failures[0]?.code).toBe("timeout");
    });

    it("retains a successful lane when another fails and does not log provider errors", async () => {
        const { input } = fixture();
        const result = await createDynamicRetrievalProviderV0({
            search: {
                search: async request => {
                    if (request.lane === "role") throw new Error("SECRET provider details");
                    return {
                        hits: request.allowedSources.map(source => ({ source })),
                        truncated: false,
                    };
                },
            },
        }).retrieve(input);
        expect(result.recentChanges).toHaveLength(2);
        expect(result.status).toBe("partial");
        expect(JSON.stringify(result)).not.toContain("SECRET");
    });

    it("does not trust an out-of-catalog hit or leak its identifier", async () => {
        const { input } = fixture();
        const result = await createDynamicRetrievalProviderV0({
            search: {
                search: async () => ({
                    hits: [{ source: { kind: "doc", id: "secret-foreign-id", version: "v1" } }],
                    truncated: false,
                }),
            },
        }).retrieve(input);
        expect(result.status).toBe("partial");
        expect(result.sourceRegistry).toEqual([]);
        expect(JSON.stringify(result)).not.toContain("secret-foreign-id");
    });

    it("bounds catalog acquisition and rejects fractional budgets", async () => {
        const { input } = fixture();
        await expect(
            createDynamicRetrievalProviderV0({ maxCandidates: 1 }).retrieve(input)
        ).rejects.toThrow("candidate limit");
        input.budgets.maxQueries = 1.5;
        await expect(createDynamicRetrievalProviderV0().retrieve(input)).rejects.toThrow(
            "safe integers"
        );
    });

    it("feeds the real manifest assembler while keeping required old stars", async () => {
        const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
        input.budgets.maxTokens = 8000;
        const retrieval = await createDynamicRetrievalProviderV0().retrieve(input);
        const registry = createSourceRegistryV0({
            actor: input.actor,
            reportWindow: input.reportWindow,
            trustedCatalog: input.sourceCatalog,
        });
        expect(registry.ok).toBe(true);
        if (!registry.ok) return;
        const assembled = assembleContextManifestV0({
            runId: "sophia-test",
            actor: input.actor,
            reportWindow: input.reportWindow,
            roleContext: input.verifiedRoleContext,
            roleProfileVersions: { founder: "profile-v1" },
            required: structuredClone(normal.requiredBundle) as unknown as RequiredContextBundleV0,
            retrievalInput: input,
            retrieval,
            registry: registry.registry,
            budgets: input.budgets,
        });
        expect(assembled.ok).toBe(true);
        if (!assembled.ok) return;
        expect(
            assembled.value.manifest.selectedRefs.some(ref => ref.id === "doc-starred-roadmap")
        ).toBe(true);
        expect(assembled.value.evidenceSnapshot.entries.length).toBeGreaterThan(0);
    });

    it("reuses Founder Weekly Review version windows with exact authorized bindings", async () => {
        const { input, source } = fixture();
        input.sourceCatalog = [
            source("version-old", "Deployment baseline", "2026-10-01T00:00:00Z"),
            source("version-new", "Deployment update"),
            source("version-end", "Deployment future", input.reportWindow.endExclusive),
        ];
        const rows = input.sourceCatalog.map((entry, index) => ({
            source: entry.source,
            version: {
                documentId: 10n,
                documentTitle: "Deployment",
                documentCategory: "Engineering",
                versionId: index + 1,
                versionNumber: index + 1,
                createdAt: new Date(entry.sourceDate),
                changelog: null,
            },
        }));
        const metadata = founderChangeMetadataV0(input, rows);
        expect(metadata.map(item => item.source.id)).toEqual(["version-new"]);
        expect(metadata[0]?.topics).toContain("document change");
        const result = await createDynamicRetrievalProviderV0({ metadata }).retrieve(input);
        expect(result.recentChanges.map(item => item.source.id)).toEqual(["version-new"]);
        input.sourceCatalog[1]!.audience = { kind: "actor", principalRef: "other" };
        expect(founderChangeMetadataV0(input, rows)).toEqual([]);
    });
});
