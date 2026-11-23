import { describe, it, expect } from "vitest";
import postgres from "postgres";
import {
    canonicalTextHash,
    canonicalVersionHash,
    canonicalVersionText,
    type CanonicalChunk,
} from "./document-digests";

// eslint-disable-next-line no-restricted-globals -- Test composition root for a disposable PostgreSQL fixture.
const fixtureUrl = process.env.VANTAGE_TOPIC_FIRST_PARITY_DATABASE_URL;
// Explicit fixture-only opt in. Never use the app's DATABASE_URL.
describe.skipIf(!fixtureUrl)("PostgreSQL canonical text parity", () => {
    it("agrees with SQL, whole-document and scoped-parent reads, and pins the founder ordering difference", async () => {
        const url = new URL(fixtureUrl!);
        const dedicatedAcceptance =
            url.hostname === "127.0.0.1" &&
            url.port === "55439" &&
            url.pathname === "/vantage_port";
        if (
            !dedicatedAcceptance &&
            (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
                !/topic.*fixture|fixture.*topic/.test(url.pathname))
        )
            throw Error("parity_database_must_be_local_topic_fixture");
        const sql = postgres(fixtureUrl!, { max: 1 });
        try {
            await sql.begin(async tx => {
                await tx.unsafe(
                    "CREATE TEMP TABLE pdr_ai_v2_document_context_chunks (id bigint,page_number int,line_start int,content text,version_id bigint,path text,ordering int) ON COMMIT DROP"
                );
                const chunks: CanonicalChunk[] = [
                    {
                        id: "10",
                        page_number: 1,
                        line_start: null,
                        content: "\u8ba1\u5212 \ud83d\ude80",
                    },
                    { id: "3", page_number: 1, line_start: 2, content: "e\u0301" },
                    { id: "2", page_number: 1, line_start: 2, content: "first\r\nline" },
                ];
                for (const chunk of chunks)
                    await tx.unsafe(
                        "INSERT INTO pdr_ai_v2_document_context_chunks VALUES ($1,$2,$3,$4,1,$5,0)",
                        [
                            String(chunk.id),
                            chunk.page_number,
                            chunk.line_start,
                            chunk.content,
                            chunk.id === "10" ? "a" : "z",
                        ]
                    );
                const expectedText = canonicalVersionText(chunks);
                const expectedHash = canonicalTextHash(expectedText);
                const hash = await canonicalVersionHash(
                    async (query, params = []) => tx.unsafe(query, params as never[]),
                    "1"
                );
                const whole = await tx.unsafe(
                    "SELECT content FROM pdr_ai_v2_document_context_chunks WHERE version_id=1 ORDER BY page_number,line_start,id"
                );
                const scopedParent = whole.map(row => String(row.content)).join("\n");
                expect(hash).toBe(expectedHash);
                expect(canonicalTextHash(scopedParent)).toBe(expectedHash);
                // Founder diff readers sort structure path first. Their sequence intentionally differs.
                const founder = await tx.unsafe(
                    "SELECT content FROM pdr_ai_v2_document_context_chunks WHERE version_id=1 ORDER BY path,page_number,line_start,ordering,id"
                );
                expect(founder.map(row => String(row.content)).join("\n")).not.toBe(expectedText);
            });
        } finally {
            await sql.end();
        }
    });
});
