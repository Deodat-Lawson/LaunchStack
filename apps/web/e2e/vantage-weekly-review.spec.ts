import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import postgres from "postgres";
import { z } from "zod";

const database = "postgres://postgres:vantage_port_disposable@127.0.0.1:55439/vantage_port";
const state = process.env.VANTAGE_ACCEPTANCE_STATE;
const week = "2026-11-23";
const reviewPath = "/api/vantage/reviews";
const toolPath = `/employer/tools/vantage?week=${week}`;
const headline = "Review current company evidence";
const fixtureState = z.object({
    email: z.string(),
    password: z.string(),
    id: z.string().uuid(),
    companyId: z.string(),
});
const idField = z.object({ id: z.string().uuid() });

function firstRow<T>(rows: readonly T[]): T {
    if (!rows[0]) throw new Error("Missing Vantage acceptance fixture row");
    return rows[0];
}

async function ok(response: APIResponse): Promise<unknown> {
    expect(response.ok(), `${response.status()} ${response.url()} ${await response.text()}`).toBe(
        true
    );
    return response.json();
}

function setBeta(request: APIRequestContext, value: boolean) {
    return request.put("/api/settings", {
        data: { key: "labs.betaApps", scope: "workspace", value },
    });
}

function signIn(request: APIRequestContext, email: string, password: string) {
    return request.post("/api/auth/sign-in/email", {
        headers: { Origin: new URL(process.env.E2E_BASE_URL!).origin },
        data: { email, password },
    });
}

function generate(request: APIRequestContext) {
    return request.post(reviewPath, {
        headers: { "Idempotency-Key": randomUUID() },
        data: { weekStart: week, expectedActiveId: null },
    });
}

async function assertBetaOff(request: APIRequestContext, id: string) {
    for (const path of ["", "/context", "/context/topics", `/${id}`, `/${id}/evidence`]) {
        const response = await request.get(reviewPath + path);
        expect(response.status()).toBe(403);
        expect(await response.json()).toMatchObject({ code: "beta_apps_off" });
    }
    expect((await generate(request)).status()).toBe(403);
    const history = await ok(await request.get("/api/workspace/history?kind=vantage"));
    expect(history).toMatchObject({ entries: [] });
}

test("injected topic-first review across both workspace Beta and creation settings", async ({
    page,
}) => {
    test.skip(!state, "Run with scripts/dev/vantage-production-acceptance.mjs");
    test.setTimeout(300_000);
    expect(process.env.DATABASE_URL).toBe(database);
    const request = page.request;
    const sql = postgres(database);
    try {
        if (process.env.VANTAGE_WEEKLY_REVIEW_ENABLED === "false") {
            const { email, password, id, companyId } = fixtureState.parse(
                JSON.parse(readFileSync(state!, "utf8"))
            );
            await ok(await signIn(request, email, password));
            await ok(await setBeta(request, false));
            await assertBetaOff(request, id);
            await ok(await setBeta(request, true));
            const list = await ok(await request.get(`${reviewPath}?weekStart=${week}`));
            expect(list).toMatchObject({ enabled: false, activeId: id });
            const before =
                await sql`SELECT count(*) FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=${companyId}`;
            const denied = await generate(request);
            expect(denied.status()).toBe(404);
            expect(await denied.json()).toMatchObject({ error: "weekly_review_disabled" });
            expect(
                await sql`SELECT count(*) FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=${companyId}`
            ).toEqual(before);
            await page.goto(toolPath);
            await expect(page.getByText(headline, { exact: true })).toBeVisible();
            const regenerate = page.getByRole("button", { name: "Regenerate", exact: true });
            await expect(regenerate.filter({ visible: true })).toBeDisabled();
            return;
        }

        const stamp = randomUUID();
        const companyName = `Vantage acceptance ${stamp}`;
        const email = `vantage-${stamp}@example.test`;
        const password = randomBytes(24).toString("base64url");
        await ok(
            await request.post("/api/auth/sign-up/email", {
                data: { name: "Vantage acceptance", email, password },
            })
        );
        await ok(await signIn(request, email, password));
        await ok(
            await request.post("/api/signup/employerCompany", {
                data: { name: "Vantage acceptance", email, companyName, numberOfEmployees: "1" },
            })
        );
        const { id: companyId } = firstRow(
            await sql<{ id: string }[]>`SELECT id FROM pdr_ai_v2_company WHERE name=${companyName}`
        );
        await assertBetaOff(request, randomUUID());
        await ok(await setBeta(request, true));

        const seed = async (title: string, content: string) => {
            const url = `https://example.invalid/${encodeURIComponent(title)}`;
            const { id } = firstRow(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_document(company_id,url,category,title) VALUES(${companyId},${url},'Architecture',${title}) RETURNING id`
            );
            const { id: version } = firstRow(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES(${id},1,${url},'text/plain','2026-11-21') RETURNING id`
            );
            await sql`UPDATE pdr_ai_v2_document SET current_version_id=${version} WHERE id=${id}`;
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content) VALUES(${id},${version},${content})`;
            return { id: String(id), version: String(version), content };
        };
        const fixed = await seed(
            "Company Architecture",
            "Company architecture records operating decisions for human review."
        );
        const watched = await seed(
            "Capacity Decision",
            "Capacity evidence supports investigation of incident response staffing."
        );
        await ok(
            await request.post(`${reviewPath}/context`, {
                data: {
                    expectedVersion: 0,
                    architectureDocumentId: fixed.id,
                    requiredDocumentIds: [],
                },
            })
        );
        await ok(
            await request.patch(`${reviewPath}/context/role`, {
                data: {
                    expectedVersion: 0,
                    primaryRole: "Engineering",
                    responsibilities: ["Incident response"],
                    priorities: ["Capacity"],
                    confirmed: true,
                },
            })
        );
        const topic = idField.parse(
            await ok(
                await request.post(`${reviewPath}/context/topics`, {
                    data: {
                        title: "Incident response capacity",
                        openQuestions: ["What capacity supports incident response?"],
                        decisionChangers: ["Staffing evidence"],
                        keywords: ["capacity"],
                        people: [],
                        metrics: [],
                        status: "active",
                        watches: [watched.id],
                    },
                })
            )
        );
        const topics = z
            .object({ topics: z.array(idField) })
            .parse(await ok(await request.get(`${reviewPath}/context/topics`)));
        expect(topics.topics).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: topic.id })])
        );
        await page.goto(toolPath);
        const generation = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === reviewPath &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Generate review", exact: true }).first().click();
        expect((await generation).status()).toBe(200);
        await expect(page.getByText(headline, { exact: true })).toBeVisible({ timeout: 120_000 });
        const { activeId: id } = z
            .object({ activeId: z.string().uuid() })
            .parse(await ok(await request.get(`${reviewPath}?weekStart=${week}`)));
        const ref = `doc:${fixed.id}@${fixed.version}`;
        const hash = createHash("sha256").update(fixed.content).digest("hex");
        const saved = z
            .object({
                schema: z.string(),
                report: z.object({ topics: z.array(z.object({ id: z.string() })).min(1) }),
                evidence: z.object({
                    retrievalMode: z.literal("topic-first"),
                    sourceRegistry: z.array(
                        z.object({ ref: z.string(), version: z.string(), hash: z.string() })
                    ),
                }),
            })
            .parse(await ok(await request.get(`${reviewPath}/${id}`)));
        expect(saved.schema).toBe("vantage-weekly-review/v2.1");
        expect(saved.evidence.sourceRegistry).toContainEqual({ ref, version: fixed.version, hash });
        const evidence = await ok(
            await request.get(`${reviewPath}/${id}/evidence?ref=${encodeURIComponent(ref)}`)
        );
        expect(evidence).toMatchObject({
            ref,
            version: fixed.version,
            text: fixed.content,
            hash,
            authorization: "current",
        });
        const stored = firstRow(
            await sql<
                { ciphertext: string; retrieval_mode: string }[]
            >`SELECT ciphertext,retrieval_mode FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${id}`
        );
        expect(stored.retrieval_mode).toBe("topic_first");
        expect(stored.ciphertext).not.toContain(fixed.content);
        const decision = "Investigate incident response staffing";
        await page
            .getByRole("textbox", { name: "Your decision", exact: true })
            .first()
            .fill(decision);
        await page.getByRole("button", { name: "Record decision", exact: true }).first().click();
        await expect(page.getByText(decision, { exact: true }).first()).toBeVisible();
        await page.reload();
        await expect(page.getByText(headline, { exact: true })).toBeVisible();
        const savedTopic = page.getByTestId(`review-topic-${saved.report.topics[0]!.id}`);
        await savedTopic.getByRole("button").first().click();
        await expect(page.getByText(decision, { exact: true }).first()).toBeVisible();
        const history = await ok(await request.get(`${reviewPath}?weekStart=${week}`));
        expect(history).toMatchObject({
            runs: expect.arrayContaining([expect.objectContaining({ id, status: "accepted" })]),
        });
        await ok(await setBeta(request, false));
        await assertBetaOff(request, id);
        await page.reload();
        await expect(page.getByText(headline, { exact: true })).toHaveCount(0);
        await ok(await setBeta(request, true));
        writeFileSync(state!, JSON.stringify({ email, password, id, companyId }), { mode: 0o600 });
    } finally {
        await sql.end();
    }
});
