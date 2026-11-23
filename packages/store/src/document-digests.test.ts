import { describe, it, expect } from "vitest";
import {
    canonicalVersionText,
    canonicalTextHash,
    groundDigest,
    getDigestsForVersions,
    deterministicDigestProvider,
} from "./document-digests";

describe("canonical document text and digests", () => {
    it("matches ordered reader LF joins including Unicode, NULL lines and numeric IDs", () => {
        const chunks = [
            { id: "10", page_number: 1, line_start: null, content: "\u8ba1\u5212 \ud83d\ude80" },
            { id: "3", page_number: 1, line_start: 2, content: "e\u0301" },
            { id: "2", page_number: 1, line_start: 2, content: "first\r\nline" },
        ];
        const expected = "first\r\nline\ne\u0301\n\u8ba1\u5212 \ud83d\ude80";
        expect(canonicalVersionText(chunks)).toBe(expected);
        expect(canonicalTextHash(canonicalVersionText(chunks))).toBe(canonicalTextHash(expected));
    });
    it("drops invented quotes and locates exact UTF-16 half-open spans", () => {
        expect(
            groundDigest(
                {
                    headline: "h".repeat(250),
                    items: [
                        { kind: "fact", text: "fact", quote: "\ud83d\ude80 yes" },
                        { kind: "fact", text: "wrong", quote: "YES" },
                    ],
                },
                "a\ud83d\ude80 yes"
            )
        ).toEqual({
            headline: "h".repeat(200),
            items: [
                {
                    kind: "fact",
                    text: "fact",
                    quote: "\ud83d\ude80 yes",
                    location: { start: 1, end: 7 },
                },
            ],
        });
    });
    it("never reads cache or calls provider for denied, missing or restricted versions", async () => {
        for (const scenario of ["missing", "denied", "restricted"]) {
            const queries: string[] = [];
            let calls = 0;
            const result = await getDigestsForVersions({
                companyId: "1",
                versionIds: ["1"],
                documentScope: () => scenario !== "denied",
                query: async sql => {
                    queries.push(sql);
                    return scenario === "missing" ? [] : [{ id: "1", category: "a", title: "t" }];
                },
                provider: async () => {
                    calls++;
                    return { headline: "", items: [] };
                },
            });
            expect(result.size).toBe(0);
            expect(calls).toBe(0);
            expect(
                queries.some(sql => sql.includes("FROM pdr_ai_v2_document_version_digests"))
            ).toBe(false);
        }
    });
    it("rechecks current actor scope before serving a cached digest", async () => {
        let checks = 0;
        const result = await getDigestsForVersions({
            companyId: "1",
            versionIds: ["1"],
            documentScope: () => true,
            authorizeDocument: async () => ++checks === 1,
            query: async sql => {
                if (sql.includes("document_settings")) return [];
                if (sql.includes("AS content_hash")) return [{ content_hash: "hash" }];
                if (sql.includes("FROM pdr_ai_v2_document_version_digests"))
                    return [{ id: "2", headline: "secret", items: [] }];
                return [{ id: "1", category: "a", title: "t" }];
            },
        });
        expect(result.size).toBe(0);
        expect(checks).toBe(2);
    });
    it("keeps a late substantive line when repeated numbered templates dominate", async () => {
        const anchor = "The Pilot began with 3 customer accounts and no planned expansion.";
        const lines = Array.from(
            { length: 80 },
            (_, index) =>
                "Record " + index + ": routine housekeeping in the weekly workspace ledger."
        );
        lines.splice(44, 0, anchor);
        const text = lines.join("\n");
        const digest = groundDigest(
            await deterministicDigestProvider({ title: "Fixture", text }),
            text
        );
        expect(digest.items.map(item => item.quote)).toEqual([anchor]);
        expect(digest.items[0]?.location.start).toBe(text.indexOf(anchor));
    });
    it("fixture provider depends only on supplied document text", async () => {
        const text = "Customer decision includes 29 active paid accounts this week.";
        const digest = await deterministicDigestProvider({ title: "Fixture", text });
        expect(digest.items[0]?.quote).toBe(text);
        expect(groundDigest(digest, text).items).toHaveLength(1);
    });
    it("ephemeral benchmark digests remain grounded without touching the shared cache", async () => {
        const text = "The release decision requires 42 completed checks and a security review.";
        const queries: string[] = [];
        const result = await getDigestsForVersions({
            companyId: "1",
            versionIds: ["8"],
            documentScope: () => true,
            cachePolicy: "ephemeral",
            query: async sql => {
                queries.push(sql);
                if (sql.includes("document_version_digests")) throw Error("shared_cache_touched");
                if (sql.includes("JOIN pdr_ai_v2_document d"))
                    return [{ id: "7", category: "Shared", title: "Release" }];
                if (sql.includes("document_settings")) return [];
                if (sql.includes("AS content_hash"))
                    return [{ content_hash: canonicalTextHash(text) }];
                if (sql.includes("AS chunk_count"))
                    return [{ chunk_count: 1, text_bytes: Buffer.byteLength(text) }];
                return [{ id: "1", page_number: 1, line_start: null, content: text }];
            },
            provider: async () => ({
                headline: "Injected",
                items: [
                    { kind: "fact", text, quote: text },
                    { kind: "fact", text: "invented", quote: "absent quote" },
                ],
            }),
        });
        expect(result.get("8")?.id).toMatch(/^ephemeral:8:/);
        expect(result.get("8")?.items).toHaveLength(1);
        expect(queries.some(sql => sql.includes("document_version_digests"))).toBe(false);
    });
    it("aborting an ignoring digest provider fences a late cache publication", async () => {
        const text = "The release decision requires 42 completed checks and a security review.";
        const controller = new AbortController();
        const writes: string[] = [];
        await expect(
            getDigestsForVersions({
                companyId: "1",
                versionIds: ["8"],
                documentScope: () => true,
                signal: controller.signal,
                query: async sql => {
                    if (sql.startsWith("INSERT")) writes.push(sql);
                    if (sql.includes("JOIN pdr_ai_v2_document d"))
                        return [{ id: "7", category: "Shared", title: "Release" }];
                    if (
                        sql.includes("document_settings") ||
                        sql.includes("document_version_digests")
                    )
                        return [];
                    if (sql.includes("AS content_hash"))
                        return [{ content_hash: canonicalTextHash(text) }];
                    if (sql.includes("AS chunk_count"))
                        return [{ chunk_count: 1, text_bytes: Buffer.byteLength(text) }];
                    return [{ id: "1", page_number: 1, line_start: null, content: text }];
                },
                provider: async () => {
                    controller.abort();
                    return { headline: "Late", items: [{ kind: "fact", text, quote: text }] };
                },
            })
        ).rejects.toThrow();
        expect(writes).toHaveLength(0);
    });
});
