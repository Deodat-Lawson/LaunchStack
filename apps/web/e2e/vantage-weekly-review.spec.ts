import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import type postgres from "postgres";
import { z } from "zod";

// Real auth/HTTP/browser/PG boundaries; model transport is explicitly injected.
// This fixture cannot target any database other than the dedicated local one.
const database =
    "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_production_acceptance";
const localRequire = createRequire(
    new URL("../../../packages/store/package.json", import.meta.url)
);

function requireFixtureRow<Row>(rows: readonly Row[]): Row {
    const row = rows[0];
    if (!row) throw new Error("Expected synthetic acceptance fixture row");
    return row;
}

test("authenticated V2.1 review, decision replay, reload and company isolation", async ({
    page,
    browser,
}) => {
    test.setTimeout(240_000);
    expect(process.env.DATABASE_URL).toBe(database);
    const createPostgres = localRequire("postgres") as typeof postgres;
    const sql = createPostgres(database);
    const stamp = randomUUID();
    const companyName = `Vantage acceptance ${stamp}`;
    const password = `E2e-${randomBytes(24).toString("base64url")}!`;
    const email = `vantage-${stamp}@example.test`;
    try {
        const signup = await page.request.post("/api/auth/sign-up/email", {
            data: { name: "Vantage acceptance", email, password },
        });
        expect(signup.ok(), await signup.text()).toBe(true);
        const company = await page.request.post("/api/signup/employerCompany", {
            data: { name: "Vantage acceptance", email, companyName, numberOfEmployees: "1" },
        });
        expect(company.ok(), await company.text()).toBe(true);
        const workspace = requireFixtureRow(
            await sql<{ id: string }[]>`SELECT id FROM pdr_ai_v2_company WHERE name=${companyName}`
        );
        const doc = requireFixtureRow(
            await sql<
                { id: string }[]
            >`INSERT INTO pdr_ai_v2_document(company_id,url,category,title) VALUES(${workspace.id},'https://example.invalid/architecture','Architecture','Company Architecture') RETURNING id`
        );
        const version = requireFixtureRow(
            await sql<
                { id: string }[]
            >`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type) VALUES(${doc.id},1,'https://example.invalid/architecture','text/plain') RETURNING id`
        );
        await sql`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${doc.id}`;
        await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content) VALUES(${doc.id},${version.id},'Company architecture: a synthetic company records decisions for human review. A recorded action does not verify execution.')`;
        const policy = await page.request.post("/api/vantage/reviews/context", {
            data: {
                expectedVersion: 0,
                architectureDocumentId: String(doc.id),
                requiredDocumentIds: [],
            },
        });
        expect(policy.ok(), await policy.text()).toBe(true);
        const key = randomUUID();
        const generated = await page.request.post("/api/vantage/reviews", {
            headers: { "Idempotency-Key": key },
            data: { weekStart: "2026-11-09", expectedActiveId: null },
        });
        expect(generated.ok(), await generated.text()).toBe(true);
        const result = z.object({ id: z.string().uuid() }).parse(await generated.json());
        const id = result.id;
        expect(typeof id).toBe("string");
        const read = await page.request.get(`/api/vantage/reviews/${id}`);
        expect(read.ok(), await read.text()).toBe(true);
        const review = z
            .object({
                id: z.string().uuid(),
                schema: z.literal("vantage-weekly-review/v2.1"),
                version: z.number(),
                report: z.object({
                    headline: z.string(),
                    topics: z.array(z.object({ id: z.string() })).min(1),
                }),
                evidence: z.object({
                    inputSnapshot: z.object({
                        sources: z
                            .array(
                                z.object({
                                    ref: z.string(),
                                    version: z.string(),
                                    hash: z.string(),
                                    text: z.string(),
                                    purpose: z.string(),
                                })
                            )
                            .min(1),
                    }),
                    sourceRegistry: z
                        .array(
                            z.object({
                                ref: z.string(),
                                version: z.string(),
                                hash: z.string(),
                                purpose: z.string(),
                            })
                        )
                        .min(1),
                    freezeHash: z.string().regex(/^[a-f0-9]{64}$/),
                }),
            })
            .parse(await read.json());
        expect(review.schema).toBe("vantage-weekly-review/v2.1");
        const frozenSource = requireFixtureRow(review.evidence.inputSnapshot.sources);
        expect(frozenSource.ref).toBe(`doc:${doc.id}@${version.id}`);
        expect(frozenSource.version).toBe(String(version.id));
        expect(frozenSource.purpose).toBe("company-architecture");
        expect(frozenSource.hash).toBe(
            createHash("sha256").update(frozenSource.text, "utf8").digest("hex")
        );
        expect(
            review.evidence.sourceRegistry.find(source => source.ref === frozenSource.ref)
        ).toMatchObject({
            ref: frozenSource.ref,
            version: frozenSource.version,
            hash: frozenSource.hash,
            purpose: frozenSource.purpose,
        });
        const topic = review.report.topics[0]!;
        const decision = {
            expectedVersion: review.version,
            topicId: topic.id,
            decision: "investigate",
            outcome: "Recorded for human investigation; no execution claimed.",
        };
        const decisionKey = randomUUID();
        const decide = () =>
            page.request.post(`/api/vantage/reviews/${id}/decisions`, {
                headers: { "Idempotency-Key": decisionKey },
                data: decision,
            });
        const first = await decide();
        expect(first.ok(), await first.text()).toBe(true);
        const replay = await decide();
        expect(replay.ok(), await replay.text()).toBe(true);
        const count = requireFixtureRow(
            await sql<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE run_id=${id}`
        );
        expect(count.n).toBe(1);
        const stale = await page.request.post(`/api/vantage/reviews/${id}/decisions`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: decision,
        });
        expect(stale.status()).toBe(409);
        const conflict = await page.request.post(`/api/vantage/reviews/${id}/decisions`, {
            headers: { "Idempotency-Key": decisionKey },
            data: { ...decision, decision: "reject" },
        });
        expect(conflict.status()).toBe(409);
        const concurrent = await Promise.all(
            [0, 1].map(() =>
                page.request.post("/api/vantage/reviews", {
                    headers: { "Idempotency-Key": randomUUID() },
                    data: { weekStart: "2026-11-09", expectedActiveId: id },
                })
            )
        );
        expect(concurrent.map(response => response.status()).sort()).toEqual([201, 409]);
        const winner = z
            .object({ id: z.string().uuid() })
            .parse(await concurrent.find(response => response.status() === 201)!.json());
        const restoreKey = randomUUID();
        const restore = () =>
            page.request.post(`/api/vantage/reviews/${id}/restore`, {
                headers: { "Idempotency-Key": restoreKey },
                data: { expectedActiveId: winner.id },
            });
        expect((await restore()).status()).toBe(200);
        expect((await restore()).status()).toBe(200);
        const active = requireFixtureRow(
            await sql<
                { run_id: string }[]
            >`SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=${workspace.id}`
        );
        expect(active.run_id).toBe(id);
        const crashId = randomUUID();
        await sql`INSERT INTO pdr_ai_v2_vantage_weekly_review_runs(id,company_id,owner_id,week_start,idempotency_key,input_hash,status,dependencies,generation_dispatched,created_at) SELECT ${crashId},company_id,owner_id,week_start,${randomUUID()},input_hash,'reserved',dependencies,true,now()-interval '10 minutes' FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${id}`;
        const recovery = await page.request.post(`/api/vantage/reviews/${crashId}/recover`);
        expect(recovery.status()).toBe(200);
        const recovered = requireFixtureRow(
            await sql<
                { status: string; failure_code: string }[]
            >`SELECT status,failure_code FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${crashId}`
        );
        expect(recovered.status).toBe("failed");
        expect(recovered.failure_code).toBe("dispatch_uncertain_expired");
        expect((await page.request.get(`/api/vantage/reviews/${id}`)).status()).toBe(200);
        const replacement = requireFixtureRow(
            await sql<
                { id: string }[]
            >`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type) VALUES(${doc.id},2,'https://example.invalid/architecture-v2','text/plain') RETURNING id`
        );
        await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content) VALUES(${doc.id},${replacement.id},'New company architecture version. Historical review still cites version one.')`;
        await sql`UPDATE pdr_ai_v2_document SET current_version_id=${replacement.id} WHERE id=${doc.id}`;
        expect((await page.request.get(`/api/vantage/reviews/${id}`)).status()).toBe(200);
        const preference = await page.request.patch("/api/vantage/reviews/context", {
            data: { expectedVersion: 0, starDocumentIds: [] },
        });
        expect(preference.ok()).toBe(true);
        expect((await page.request.get(`/api/vantage/reviews/${id}`)).status()).toBe(200);
        const encrypted = requireFixtureRow(
            await sql<
                { ciphertext: string }[]
            >`SELECT ciphertext FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${id}`
        );
        expect(encrypted.ciphertext).not.toContain("Company architecture");
        await page.goto("/employer/tools/vantage/agenda");
        await expect(page.getByText(review.report.headline, { exact: true })).toBeVisible({
            timeout: 120_000,
        });
        await page.reload();
        await expect(page.getByText(review.report.headline, { exact: true })).toBeVisible();
        await page
            .locator('textarea[id^="decision-"]')
            .first()
            .fill("Browser recorded decision; execution remains unverified.");
        const uiDecisionSaved = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/vantage/reviews/${id}/decisions` &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Record decision", exact: true }).first().click();
        expect((await uiDecisionSaved).status()).toBe(200);
        await expect(
            page
                .getByText("Browser recorded decision; execution remains unverified.", {
                    exact: false,
                })
                .first()
        ).toBeVisible();
        const uiDecisionCount = requireFixtureRow(
            await sql<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE run_id=${id}`
        );
        // The UI must select the restored active run, not merely a newer report
        // with the same headline. Its actual browser mutation proves identity.
        expect(uiDecisionCount.n).toBe(2);
        const authId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json())
            .user.id;
        await sql`INSERT INTO pdr_ai_v2_document_settings(document_id,company_id,restricted,updated_by) VALUES(${doc.id},${workspace.id},true,${authId}) ON CONFLICT(document_id) DO UPDATE SET restricted=true`;
        const revoked = await page.request.get(`/api/vantage/reviews/${id}`);
        expect(revoked.status()).toBe(403);
        const privateRequired = await page.request.post("/api/vantage/reviews", {
            headers: { "Idempotency-Key": randomUUID() },
            data: { weekStart: "2026-11-09", expectedActiveId: id },
        });
        expect([403, 409]).toContain(privateRequired.status());
        await sql`UPDATE pdr_ai_v2_document_settings SET restricted=false WHERE document_id=${doc.id}`;
        expect((await page.request.get(`/api/vantage/reviews/${id}`)).status()).toBe(200);
        const protectedDelete = await page.request.delete(
            `/api/workspace/history/weekly-review/${randomUUID()}`
        );
        expect(protectedDelete.status()).toBe(409);
        const outsider = await browser.newContext();
        try {
            const outsiderEmail = `outside-${stamp}@example.test`;
            expect(
                (
                    await outsider.request.post("/api/auth/sign-up/email", {
                        data: { name: "Other company", email: outsiderEmail, password },
                    })
                ).ok()
            ).toBe(true);
            expect(
                (
                    await outsider.request.post("/api/signup/employerCompany", {
                        data: {
                            name: "Other company",
                            email: outsiderEmail,
                            companyName: `Other ${stamp}`,
                            numberOfEmployees: "1",
                        },
                    })
                ).ok()
            ).toBe(true);
            const denied = await outsider.request.get(`/api/vantage/reviews/${id}`);
            expect([403, 404]).toContain(denied.status());
        } finally {
            await outsider.close();
        }
    } finally {
        await sql.end();
    }
});
