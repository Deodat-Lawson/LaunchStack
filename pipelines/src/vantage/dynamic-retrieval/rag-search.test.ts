import { describe, expect, it, vi } from "vitest";
import type { RagPort, RagSearchResult } from "@launchstack/retrieval";
import normal from "../../../../fixtures/vantage-context-v0/normal.json";
import type { DynamicRetrievalInputV0 } from "../proposals/context-v0";
import { createDynamicRetrievalProviderV0 } from "./retrieve";
import {
    createAuthorizedRagSearchV0,
    type AuthorizedRagSearchOptionsV0,
    type RagDocumentBindingV0,
} from "./rag-search";
import type { RetrievalSearchRequestV0 } from "./types";

function fixture() {
    const input = structuredClone(normal.retrievalInput) as DynamicRetrievalInputV0;
    input.actor.companyId = "7";
    input.budgets = {
        maxQueries: 2,
        maxSources: 10,
        maxExcerptChars: 4000,
        maxTokens: 4000,
        timeoutMs: 2000,
    };
    const bindings: RagDocumentBindingV0[] = [1, 2, 3].map(id => ({
        documentId: id,
        versionId: id + 10,
        metadata: {
            source: { kind: "doc", id: `workspace-document/${id}`, version: String(id + 10) },
            title: "Weekly company risks",
            changedAt: id === 1 ? "2026-09-01T00:00:00Z" : "2026-10-16T00:00:00Z",
        },
    }));
    bindings[0]!.metadata.state = { asOf: input.reportWindow.asOf, value: "open" };
    input.sourceCatalog = bindings.map(binding => ({
        source: binding.metadata.source,
        companyId: "7",
        access: "allowed",
        aclDigest: "doc-acl",
        audience: { kind: "company", companyId: "7" },
        sourceDate: binding.metadata.changedAt!,
        checkedAt: input.reportWindow.asOf,
        excerpt: "Company weekly risks",
    }));
    const request: RetrievalSearchRequestV0 = {
        actor: input.actor,
        reportWindow: input.reportWindow,
        lane: "role",
        limit: 10,
        roles: [{ roleId: "founder", terms: ["company", "risks"] }],
        allowedSources: bindings.map(binding => binding.metadata.source),
        signal: new AbortController().signal,
    };
    const hit = (documentId = 2, versionId = documentId + 10): RagSearchResult => ({
        pageContent: "UNTRUSTED PROVIDER TEXT",
        metadata: { documentId, versionId, documentTitle: "UNTRUSTED TITLE" },
    });
    const rag = {
        companyEnsembleSearch: vi.fn<RagPort["companyEnsembleSearch"]>().mockResolvedValue([hit()]),
    };
    const authorizeDocuments = vi.fn<AuthorizedRagSearchOptionsV0["authorizeDocuments"]>(
        async ({ actor, documentIds }) => ({ actor, documentIds })
    );
    const options: AuthorizedRagSearchOptionsV0 = {
        actor: input.actor,
        bindings,
        rag,
        authorizeDocuments,
    };
    return { input, bindings, request, hit, rag, authorizeDocuments, options };
}

describe("authorized Vantage RAG bridge", () => {
    it("combines multiple roles into one bounded query without duplicating terms", async () => {
        const f = fixture();
        f.request.roles.push({ roleId: "engineering", terms: ["risks", "deployment"] });
        await createAuthorizedRagSearchV0(f.options).search(f.request);
        expect(f.rag.companyEnsembleSearch).toHaveBeenCalledTimes(1);
        expect(f.rag.companyEnsembleSearch.mock.calls[0]![0]).toBe("company deployment risks");
    });
    it("reports unsupported native source kinds and unbound documents instead of claiming completeness", async () => {
        const f = fixture();
        f.request.allowedSources = [
            { kind: "ev", id: "evidence-1", version: "1" },
            { kind: "doc", id: "unbound", version: "1" },
        ];
        expect(await createAuthorizedRagSearchV0(f.options).search(f.request)).toEqual({
            hits: [],
            truncated: false,
            incomplete: true,
        });
        expect(f.rag.companyEnsembleSearch).not.toHaveBeenCalled();
    });
    it("uses an explicit document-only scope and returns trusted exact-version metadata", async () => {
        const f = fixture();
        const result = await createAuthorizedRagSearchV0(f.options).search(f.request);
        expect(f.rag.companyEnsembleSearch).toHaveBeenCalledWith("company risks", {
            companyId: 7,
            topK: 10,
            scope: {
                kind: "only",
                allowedCategories: [],
                deniedDocumentIds: [],
                allowedDocumentIds: [1, 2, 3],
            },
            filters: { documentIds: [1, 2, 3] },
        });
        expect(result.hits).toEqual(f.bindings.slice(0, 2).map(binding => binding.metadata));
        expect(JSON.stringify(result)).not.toContain("UNTRUSTED");
        expect(f.authorizeDocuments).toHaveBeenCalledTimes(2);
    });

    it("preserves old explicitly open work when top-k misses it, without inventing open state", async () => {
        const f = fixture();
        f.rag.companyEnsembleSearch.mockResolvedValue([]);
        f.bindings[1]!.metadata.title =
            "Historical pending question, no evidence of current progress";
        const result = await createDynamicRetrievalProviderV0({
            search: createAuthorizedRagSearchV0(f.options),
        }).retrieve(f.input);
        expect(result.unresolvedOlderItems.map(entry => entry.source.id)).toEqual([
            "workspace-document/1",
        ]);
        expect(result.recentChanges).toHaveLength(2);
    });

    it("uses the version event feed for the recent lane even with no RAG hits", async () => {
        const f = fixture();
        f.request.lane = "recent";
        const result = await createAuthorizedRagSearchV0(f.options).search(f.request);
        expect(result.hits.map(hit => hit.source.id)).toEqual([
            "workspace-document/2",
            "workspace-document/3",
        ]);
        expect(f.rag.companyEnsembleSearch).not.toHaveBeenCalled();
    });

    it("uses a half-open recent window and reports a missing version timestamp", async () => {
        const f = fixture();
        f.request.lane = "recent";
        f.bindings[0]!.metadata.changedAt = f.input.reportWindow.startInclusive;
        f.bindings[1]!.metadata.changedAt = f.input.reportWindow.endExclusive;
        delete f.bindings[2]!.metadata.changedAt;
        const result = await createAuthorizedRagSearchV0(f.options).search(f.request);
        expect(result.hits.map(hit => hit.source.id)).toEqual(["workspace-document/1"]);
        expect(result.incomplete).toBe(true);
    });

    it("does not widen an empty or required-source-filtered catalog into company search", async () => {
        const f = fixture();
        f.request.allowedSources = [];
        expect((await createAuthorizedRagSearchV0(f.options).search(f.request)).hits).toEqual([]);
        expect(f.rag.companyEnsembleSearch).not.toHaveBeenCalled();
        expect(f.authorizeDocuments).not.toHaveBeenCalled();
    });

    it.each(["stale", "missing-version", "foreign", "conflicting-id"])(
        "discards %s hits and reports partial coverage",
        async kind => {
            const f = fixture();
            const hit = f.hit();
            if (kind === "stale") hit.metadata.versionId = 99;
            if (kind === "missing-version") delete hit.metadata.versionId;
            if (kind === "foreign") hit.metadata.documentId = 999;
            if (kind === "conflicting-id") hit.documentId = 999;
            f.rag.companyEnsembleSearch.mockResolvedValue([hit]);
            const result = await createDynamicRetrievalProviderV0({
                search: createAuthorizedRagSearchV0(f.options),
            }).retrieve(f.input);
            expect(result.status).toBe("partial");
            expect(result.failures.some(failure => failure.code === "invalid_source")).toBe(true);
            expect(JSON.stringify(result)).not.toContain("UNTRUSTED");
        }
    );

    it("removes access revoked while search was in flight", async () => {
        const f = fixture();
        f.authorizeDocuments
            .mockResolvedValueOnce({ actor: f.input.actor, documentIds: [1, 2] })
            .mockResolvedValueOnce({ actor: f.input.actor, documentIds: [1] });
        const result = await createAuthorizedRagSearchV0(f.options).search(f.request);
        expect(result.hits.map(hit => hit.source.id)).toEqual(["workspace-document/1"]);
        expect(result.incomplete).toBe(true);
        expect(f.rag.companyEnsembleSearch.mock.calls[0]![1].scope).toMatchObject({
            allowedDocumentIds: [1, 2],
        });
    });

    it.each(["companyId", "principalRef", "aclDigest"] as const)(
        "rejects a changed %s before querying",
        async field => {
            const f = fixture();
            const bridge = createAuthorizedRagSearchV0(f.options);
            f.request.actor = { ...f.request.actor, [field]: "different" };
            await expect(bridge.search(f.request)).rejects.toThrow("authorization");
            expect(f.rag.companyEnsembleSearch).not.toHaveBeenCalled();
        }
    );

    it("rejects changed authorization identity and scope expansion from the host", async () => {
        const f = fixture();
        f.authorizeDocuments.mockResolvedValue({ actor: f.input.actor, documentIds: [999] });
        await expect(createAuthorizedRagSearchV0(f.options).search(f.request)).rejects.toThrow(
            "authorization"
        );
        expect(f.rag.companyEnsembleSearch).not.toHaveBeenCalled();
    });

    it("deduplicates repeated chunks and declares a saturated top-k incomplete", async () => {
        const f = fixture();
        f.options.maxResults = 2;
        f.rag.companyEnsembleSearch.mockResolvedValue([f.hit(), f.hit()]);
        const result = await createAuthorizedRagSearchV0(f.options).search(f.request);
        expect(result.hits).toHaveLength(2); // One old-open source plus one RAG source.
        expect(result.truncated).toBe(true);
    });

    it("rejects oversized backend output without promoting it", async () => {
        const f = fixture();
        f.options.maxResults = 1;
        f.rag.companyEnsembleSearch.mockResolvedValue([f.hit(), f.hit()]);
        await expect(createAuthorizedRagSearchV0(f.options).search(f.request)).rejects.toThrow(
            "authorization"
        );
    });

    it("times out a hung backend and does not run later authorization", async () => {
        const f = fixture();
        f.options.timeoutMs = 10;
        f.rag.companyEnsembleSearch.mockImplementation(() => new Promise(() => {}));
        await expect(createAuthorizedRagSearchV0(f.options).search(f.request)).rejects.toThrow(
            "deadline"
        );
        expect(f.authorizeDocuments).toHaveBeenCalledTimes(1);
    });

    it("does no work for an already cancelled request", async () => {
        const f = fixture();
        f.request.signal = AbortSignal.abort();
        await expect(createAuthorizedRagSearchV0(f.options).search(f.request)).rejects.toThrow(
            "deadline"
        );
        expect(f.rag.companyEnsembleSearch).not.toHaveBeenCalled();
        expect(f.authorizeDocuments).not.toHaveBeenCalled();
    });

    it("rejects ambiguous native bindings", () => {
        const f = fixture();
        f.bindings.push(structuredClone(f.bindings[0]!));
        expect(() => createAuthorizedRagSearchV0(f.options)).toThrow("bindings");
    });
});
