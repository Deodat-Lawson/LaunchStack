import { describe, it, expect } from "vitest";
import { canonicalVersionText, canonicalTextHash, groundDigest, getDigestsForVersions, deterministicDigestProvider } from "./document-digests";

describe("canonical document text and digests", () => {
    it("matches ordered reader LF joins including Unicode, NULL lines and numeric IDs", () => {
        const chunks = [
            { id: "10", page_number: 1, line_start: null, content: "?? ??" },
            { id: "3", page_number: 1, line_start: 2, content: "e?" },
            { id: "2", page_number: 1, line_start: 2, content: "first\r\nline" },
        ];
        const expected = "first\r\nline\ne?\n?? ??";
        expect(canonicalVersionText(chunks)).toBe(expected);
        expect(canonicalTextHash(canonicalVersionText(chunks))).toBe(canonicalTextHash(expected));
    });
    it("drops invented quotes and locates exact UTF-16 half-open spans", () => {
        expect(groundDigest({ headline: "h".repeat(250), items: [
            { kind: "fact", text: "fact", quote: "?? yes" },
            { kind: "fact", text: "wrong", quote: "YES" },
        ] }, "a?? yes")).toEqual({ headline: "h".repeat(200), items: [
            { kind: "fact", text: "fact", quote: "?? yes", location: { start: 1, end: 7 } },
        ] });
    });
    it("never reads cache or calls provider for denied, missing or restricted versions", async () => {
        for (const scenario of ["missing", "denied", "restricted"]) {
            const queries: string[] = [];
            let calls = 0;
            const result = await getDigestsForVersions({ companyId: "1", versionIds: ["1"],
                documentScope: () => scenario !== "denied",
                query: async sql => { queries.push(sql); return scenario === "missing" ? [] : [{ id: "1", category: "a", title: "t" }]; },
                provider: async () => { calls++; return { headline: "", items: [] }; },
            });
            expect(result.size).toBe(0);
            expect(calls).toBe(0);
            expect(queries.some(sql => sql.includes("FROM pdr_ai_v2_document_version_digests"))).toBe(false);
        }
    });
    it("rechecks current actor scope before serving a cached digest", async () => {
        let checks = 0;
        const result = await getDigestsForVersions({ companyId: "1", versionIds: ["1"],
            documentScope: () => true,
            authorizeDocument: async () => ++checks === 1,
            query: async sql => {
                if (sql.includes("document_settings")) return [];
                if (sql.includes("AS content_hash")) return [{ content_hash: "hash" }];
                if (sql.includes("FROM pdr_ai_v2_document_version_digests")) return [{ id: "2", headline: "secret", items: [] }];
                return [{ id: "1", category: "a", title: "t" }];
            },
        });
        expect(result.size).toBe(0);
        expect(checks).toBe(2);
    });
    it("fixture provider depends only on supplied document text", async () => {
        const text = "Customer decision includes 29 active paid accounts this week.";
        const digest = await deterministicDigestProvider({ title: "Fixture", text });
        expect(digest.items[0]?.quote).toBe(text);
        expect(groundDigest(digest, text).items).toHaveLength(1);
    });
});
