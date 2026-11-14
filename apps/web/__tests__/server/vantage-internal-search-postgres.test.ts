import postgres from "postgres";
import { searchInternalEvidence } from "~/server/vantage/weekly-review-internal-search";
import type { WeeklyReviewAuthorityActor } from "~/server/vantage/weekly-review-authority";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

function checkedUrl(): string {
    const value = process.env.VANTAGE_SCOPED_TEST_DATABASE_URL;
    if (!value) throw new Error("VANTAGE_SCOPED_TEST_DATABASE_URL is required");
    const url = new URL(value);
    if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.port !== "55570" ||
        url.pathname !== "/vantage_scoped_evidence_20261113"
    )
        throw new Error("Refusing non-owned synthetic database");
    return value;
}

const cutoff = "2026-11-14T00:00:00Z";

async function fixture(
    work: (helpers: {
        query: WeeklyReviewQuery;
        actor: WeeklyReviewAuthorityActor;
        addDocument: (
            text: string | string[],
            options?: { title?: string; date?: string; companyId?: string }
        ) => Promise<{ id: string; version: string }>;
        execute: WeeklyReviewQuery;
    }) => Promise<void>
) {
    const client = postgres(checkedUrl(), { max: 1, idle_timeout: 1 });
    const rollback = new Error("rollback synthetic search fixtures");
    try {
        await client.begin(async transaction => {
            const [company] =
                await transaction`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('internal search synthetic', '1') RETURNING id`;
            const actor: WeeklyReviewAuthorityActor = {
                companyId: String(company!.id),
                userId: "internal-search-test",
                role: "admin",
                canRead: true,
                canMutate: true,
                documentScope: { kind: "everything" },
            };
            const execute: WeeklyReviewQuery = async (text, parameters = []) => [
                ...(await transaction.unsafe(text, parameters as never[])),
            ];
            const addDocument = async (
                text: string | string[],
                options: { title?: string; date?: string; companyId?: string } = {}
            ) => {
                const [doc] =
                    await transaction`INSERT INTO pdr_ai_v2_document(url,category,title,company_id,created_at,updated_at) VALUES ('synthetic','Shared',${options.title ?? "Synthetic note"},${options.companyId ?? actor.companyId},'2026-11-01','2026-11-25') RETURNING id`;
                const [version] =
                    await transaction`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${doc!.id},1,'synthetic','text/plain',${options.date ?? "2026-11-01T00:00:00Z"}) RETURNING id`;
                for (const [index, content] of (Array.isArray(text) ? text : [text]).entries()) {
                    await transaction`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${doc!.id},${version!.id},${content},1,${index + 1})`;
                }
                return { id: String(doc!.id), version: String(version!.id) };
            };
            await work({ query: execute, actor, addDocument, execute });
            throw rollback;
        });
    } catch (error) {
        if (error !== rollback) throw error;
    } finally {
        await client.end();
    }
}

describe("internal evidence search on guarded PostgreSQL", () => {
    it("uses the eligible historical version, isolates tenants and hides denied identities", async () => {
        await fixture(async ({ query, actor, addDocument, execute }) => {
            const old = await addDocument("Historical revenue definition applies.");
            const [futureVersion] = await execute(
                "INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES ($1::bigint,2,'synthetic','text/plain','2026-11-20') RETURNING id",
                [old.id]
            );
            await execute(
                "INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES($1::bigint,$2::bigint,'futureonlymarker',1,1)",
                [old.id, futureVersion!.id]
            );
            const denied = await addDocument("Private revenue definition", {
                title: "Private title forbidden",
            });
            await addDocument("revenue", { date: "2026-11-20T00:00:00Z" });
            const [otherCompany] = await execute(
                "INSERT INTO pdr_ai_v2_company(name,\"numberOfEmployees\") VALUES ('other internal search synthetic','1') RETURNING id"
            );
            await addDocument("revenue", {
                companyId: String(otherCompany!.id),
                title: "Foreign title forbidden",
            });
            const restricted = {
                ...actor,
                documentScope: {
                    kind: "except" as const,
                    deniedCategories: [],
                    deniedDocumentIds: [Number(denied.id)],
                    allowedDocumentIds: [],
                },
            };
            const result = await searchInternalEvidence(query, restricted, cutoff, {
                queries: ["revenue"],
                excludeIds: [],
            });
            expect(result).toMatchObject({
                deniedCount: 1,
                candidates: [{ id: old.id, version: old.version, matchedQueryIndexes: [0] }],
            });
            expect(result.candidates).toHaveLength(1);
            expect(JSON.stringify(result)).not.toContain("title forbidden");
            expect(result.candidates[0]).not.toHaveProperty("text");
            expect(
                (
                    await searchInternalEvidence(query, restricted, cutoff, {
                        queries: ["futureonlymarker"],
                        excludeIds: [],
                    })
                ).candidates
            ).toEqual([]);
            expect(
                (
                    await searchInternalEvidence(query, restricted, cutoff, {
                        queries: ["revenue"],
                        excludeIds: [old.id],
                    })
                ).candidates
            ).toEqual([]);
        });
    }, 20000);

    it("ignores oversized chunks and content after the 129th chunk", async () => {
        await fixture(async ({ query, actor, addDocument }) => {
            await addDocument([...Array.from({ length: 129 }, () => "routine"), "beyondneedle"]);
            await addDocument("longneedle" + "x".repeat(24000));
            const exact = await addDocument(
                "exactneedle" + "x".repeat(24000 - "exactneedle".length)
            );
            expect(
                (
                    await searchInternalEvidence(query, actor, cutoff, {
                        queries: ["beyondneedle", "longneedle"],
                        excludeIds: [],
                    })
                ).candidates
            ).toEqual([]);
            expect(
                (
                    await searchInternalEvidence(query, actor, cutoff, {
                        queries: ["exactneedle"],
                        excludeIds: [],
                    })
                ).candidates.map(candidate => candidate.id)
            ).toEqual([exact.id]);
        });
    }, 20000);

    it("materializes a 64-document recency pool before matching and has an executable query plan", async () => {
        await fixture(async ({ query, actor, addDocument, execute }) => {
            const oldest = await addDocument("olderneedle");
            const newer = [];
            for (let index = 0; index < 64; index += 1) {
                newer.push(
                    await addDocument("routine", {
                        date: new Date(
                            Date.parse("2026-11-02T00:00:00Z") + index * 60000
                        ).toISOString(),
                    })
                );
            }
            let plan: unknown;
            const explainQuery: WeeklyReviewQuery = async (text, parameters) => {
                plan = await execute("EXPLAIN (ANALYZE, FORMAT JSON) " + text, parameters);
                return query(text, parameters);
            };
            expect(
                (
                    await searchInternalEvidence(explainQuery, actor, cutoff, {
                        queries: ["olderneedle"],
                        excludeIds: [],
                    })
                ).candidates
            ).toEqual([]);
            expect(JSON.stringify(plan)).toContain("CTE Scan");
            expect(JSON.stringify(plan)).toContain("bounded_chunks");
            const rescued = await searchInternalEvidence(query, actor, cutoff, {
                queries: ["olderneedle"],
                excludeIds: newer.map(doc => doc.id),
            });
            expect(rescued.candidates.map(candidate => candidate.id)).toEqual([oldest.id]);
        });
    }, 20000);

    it("treats injection-looking query text as literals and exposes two match indexes", async () => {
        await fixture(async ({ query, actor, addDocument }) => {
            const first = await addDocument("refundmarker");
            const second = await addDocument("signaturemarker");
            const result = await searchInternalEvidence(query, actor, cutoff, {
                queries: ["refundmarker'; DROP TABLE imaginary; --", "signaturemarker"],
                excludeIds: [],
            });
            expect(
                result.candidates.find(candidate => candidate.id === first.id)?.matchedQueryIndexes
            ).toEqual([0]);
            expect(
                result.candidates.find(candidate => candidate.id === second.id)?.matchedQueryIndexes
            ).toEqual([1]);
            expect(result.queryCount).toBe(2);
            expect((await query("SELECT 1 AS alive"))[0]?.alive).toBe(1);
        });
    }, 20000);
});
