import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Response as PlaywrightResponse } from "@playwright/test";
import type postgres from "postgres";
import { z } from "zod";

/** Browser generation returns progress events and then the accepted report. */
async function generatedReview(response: PlaywrightResponse): Promise<unknown> {
    expect(response.headers()["content-type"]).toContain("application/x-ndjson");
    const events = z.array(z.object({ type: z.string(), result: z.unknown().optional() })).parse(
        (await response.text())
            .trim()
            .split("\n")
            .map(line => JSON.parse(line) as unknown)
    );
    expect(events.filter(event => event.type === "error")).toEqual([]);
    const completed = events.find(event => event.type === "result");
    expect(completed).toBeDefined();
    return completed?.result;
}

const database =
    "postgres://vantage_test:vantage_test_only@127.0.0.1:55569/vantage_production_acceptance";
const localRequire = createRequire(
    new URL("../../../packages/store/package.json", import.meta.url)
);
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const sourceSchema = z.object({
    ref: z.string(),
    version: z.string(),
    hash: z.string(),
    text: z.string(),
    purpose: z.string(),
});
const reviewSchema = z.object({
    id: z.string().uuid(),
    schema: z.literal("vantage-weekly-review/v2.1"),
    version: z.number(),
    report: z.object({
        headline: z.string(),
        topics: z
            .array(
                z.object({
                    id: z.string(),
                    facts: z.array(z.object({ refs: z.array(z.string()) })),
                })
            )
            .min(1),
    }),
    evidence: z.object({
        schemaVersion: z.literal("vantage-admission/v3"),
        qualityEvidence: z.literal("injected-deterministic"),
        generationModel: z.literal("synthetic-generation"),
        judgeModel: z.literal("synthetic-judge"),
        evaluation: z.object({ status: z.literal("assessed"), verdict: z.literal("pass") }),
        freezeHash: z.string().regex(/^[a-f0-9]{64}$/),
        inputSnapshot: z.object({
            sources: z.array(sourceSchema),
            scopedEvidence: z.array(
                z.object({
                    documentId: z.string(),
                    parentVersion: z.string(),
                    parentHash: z.string(),
                    coverage: z.object({ state: z.string(), originalCompleteness: z.string() }),
                })
            ),
        }),
        sourceRegistry: z.array(
            z.object({ ref: z.string(), version: z.string(), hash: z.string() })
        ),
        selectionDiagnostics: z.object({
            deniedCount: z.number(),
            omittedCount: z.number(),
            omissionReasonCounts: z.record(z.string(), z.number()),
        }),
    }),
});

// Auth, HTTP, browser, canonical indexed evidence, PostgreSQL and encryption are real.
// Generation/Judge use the application's injected deterministic engineering provider.
test("authenticated scoped review, exact inspection, stale dispatch protection and pin recovery", async ({
    page,
    baseURL,
}) => {
    test.setTimeout(360_000);
    expect(process.env.DATABASE_URL).toBe(database);
    expect(baseURL).toBe("http://127.0.0.1:3199");
    const createPostgres = localRequire("postgres") as typeof postgres;
    const sql = createPostgres(database, { max: 2 });
    const stamp = randomUUID();
    const email = `remediation-${stamp}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const companyName = `Synthetic scoped remediation ${stamp}`;
    const artifacts = resolve(
        process.cwd(),
        "../../test-output/vantage-remediation-20261114",
        stamp
    );
    await mkdir(artifacts, { recursive: true });
    await writeFile(
        resolve(artifacts, "private-trial-login.json"),
        JSON.stringify(
            {
                origin: baseURL,
                email,
                password,
                companyName,
                evidence: "synthetic deterministic engineering fixture",
            },
            null,
            2
        )
    );
    const row = <T>(rows: readonly T[]): T => {
        if (!rows[0]) throw new Error("Synthetic fixture row is missing");
        return rows[0];
    };
    try {
        const signup = await page.request.post("/api/auth/sign-up/email", {
            data: { name: "Synthetic reviewer", email, password },
        });
        expect(signup.ok()).toBe(true);
        const authId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json())
            .user.id;
        const company = await page.request.post("/api/signup/employerCompany", {
            data: { name: "Synthetic reviewer", email, companyName, numberOfEmployees: "1" },
        });
        expect(company.ok(), await company.text()).toBe(true);
        const workspace = row(
            await sql<
                { id: string }[]
            >`SELECT id::text FROM pdr_ai_v2_company WHERE name=${companyName}`
        );
        const addDocument = async (title: string, text: string) => {
            const document = row(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_document(company_id,url,category,title,created_at,updated_at) VALUES (${workspace.id},'https://example.invalid/synthetic','Shared',${title},'2026-11-08','2026-11-08') RETURNING id::text`
            );
            const version = row(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${document.id},1,'https://example.invalid/synthetic','text/plain','2026-11-08') RETURNING id::text`
            );
            await sql`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${document.id}`;
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${document.id},${version.id},${text},1,1)`;
            return { id: document.id, version: version.id, text };
        };
        const excerpt =
            "Synthetic architecture approval requires a human decision. Recorded actions do not verify execution.";
        const architecture = await addDocument(
            "Synthetic scoped architecture",
            excerpt + "\n" + "Outside approved architecture span. ".repeat(950)
        );
        const required = await addDocument(
            "Synthetic required source",
            "Synthetic required context. Investigate source evidence before deciding."
        );
        const star = await addDocument(
            "Synthetic personal pinned source",
            "Synthetic personal evidence awaiting human review."
        );
        const oversized = await addDocument(
            "Synthetic oversized optional",
            "Oversized optional evidence. ".repeat(1100)
        );
        const denied = await addDocument(
            "Synthetic restricted optional",
            "Restricted synthetic evidence must stay outside retrieval diagnostics."
        );
        await sql`INSERT INTO pdr_ai_v2_document_settings(document_id,company_id,restricted,updated_by) VALUES (${denied.id},${workspace.id},true,${authId})`;
        for (let index = 0; index < 20; index++) {
            await addDocument(
                `Synthetic optional ${index}`,
                `Optional synthetic source ${index}. ` +
                    "Human verification remains required. ".repeat(16)
            );
        }
        const scope = (document: typeof star, text: string) => ({
            version: document.version,
            expectedParentHash: digest(document.text),
            qualification:
                "Explicitly approved synthetic finite span for engineering verification.",
            requiredUnits: [
                { id: "approved-span", start: 0, end: text.length, excerptHash: digest(text) },
            ],
        });
        const configured = await page.request.post("/api/vantage/reviews/context", {
            data: {
                expectedVersion: 0,
                architectureDocumentId: architecture.id,
                requiredDocumentIds: [required.id],
                requiredSourceScopes: { [architecture.id]: scope(architecture, excerpt) },
            },
        });
        expect(configured.ok(), await configured.text()).toBe(true);
        const starred = await page.request.patch("/api/vantage/reviews/context", {
            data: {
                expectedVersion: 0,
                starDocumentIds: [star.id],
                starSourceScopes: { [star.id]: scope(star, star.text) },
            },
        });
        expect(starred.ok(), await starred.text()).toBe(true);
        const previewResponse = await page.request.get(
            `/api/vantage/reviews/context/source?documentId=${architecture.id}&purpose=company-architecture&version=${architecture.version}`
        );
        expect(previewResponse.status()).toBe(200);
        const preview = z
            .object({
                pin: z.object({ status: z.literal("valid") }),
                preview: z.object({
                    text: z.string(),
                    parentHash: z.string(),
                    offsetEncoding: z.literal("utf16_half_open"),
                }),
            })
            .parse(await previewResponse.json());
        expect(preview.preview.text).toBe(architecture.text);
        expect(preview.preview.parentHash).toBe(digest(architecture.text));

        const generated = await page.request.post("/api/vantage/reviews", {
            headers: { "Idempotency-Key": randomUUID() },
            data: { weekStart: "2026-11-09", expectedActiveId: null },
        });
        expect(generated.status(), await generated.text()).toBe(201);
        const review = reviewSchema.parse(await generated.json());
        const sources = review.evidence.inputSnapshot.sources;
        expect(
            sources.some(
                source => source.text === excerpt && source.purpose === "company-architecture"
            )
        ).toBe(true);
        expect(
            sources.some(
                source => source.text === required.text && source.purpose === "workspace-required"
            )
        ).toBe(true);
        expect(
            sources.some(source => source.text === star.text && source.purpose === "personal-star")
        ).toBe(true);
        expect(sources.some(source => source.text === architecture.text)).toBe(false);
        expect(review.evidence.selectionDiagnostics.deniedCount).toBeGreaterThan(0);
        expect(
            review.evidence.selectionDiagnostics.omissionReasonCounts.source_context_unavailable
        ).toBeGreaterThan(0);
        expect(
            (review.evidence.selectionDiagnostics.omissionReasonCounts.ranked_lower ?? 0) +
                (review.evidence.selectionDiagnostics.omissionReasonCounts.budget_exceeded ?? 0)
        ).toBeGreaterThan(0);
        expect(
            sources.some(source => source.ref === `doc:${oversized.id}@${oversized.version}`)
        ).toBe(false);
        expect(review.evidence.selectionDiagnostics.omittedCount).toBeGreaterThan(0);
        expect(JSON.stringify(review.evidence.selectionDiagnostics)).not.toContain(
            `"id":"${denied.id}"`
        );
        for (const source of sources) {
            expect(source.hash).toBe(digest(source.text));
            expect(
                review.evidence.sourceRegistry.find(item => item.ref === source.ref)
            ).toMatchObject({ version: source.version, hash: source.hash });
        }
        for (const topic of review.report.topics)
            for (const fact of topic.facts)
                for (const ref of fact.refs)
                    expect(sources.some(source => source.ref === ref)).toBe(true);
        expect(review.evidence.inputSnapshot.scopedEvidence).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    documentId: architecture.id,
                    parentVersion: architecture.version,
                    parentHash: digest(architecture.text),
                    coverage: expect.objectContaining({
                        state: "relevant_spans_reviewed",
                        originalCompleteness: "unknown",
                    }),
                }),
            ])
        );
        const persisted = row(
            await sql<
                {
                    status: string;
                    ciphertext: string;
                    generation_dispatched: boolean;
                    judge_dispatched: boolean;
                }[]
            >`SELECT status,ciphertext,generation_dispatched,judge_dispatched FROM pdr_ai_v2_vantage_weekly_review_runs WHERE id=${review.id}`
        );
        expect(persisted).toMatchObject({
            status: "accepted",
            generation_dispatched: true,
            judge_dispatched: true,
        });
        expect(persisted.ciphertext).not.toContain(excerpt);
        const architectureSource = sources.find(source => source.text === excerpt)!;
        const inspect = await page.request.get(
            `/api/vantage/reviews/${review.id}/evidence?ref=${encodeURIComponent(architectureSource.ref)}`
        );
        expect(inspect.status()).toBe(200);
        const exact = z
            .object({
                text: z.string(),
                hash: z.string(),
                authorization: z.literal("current"),
                scope: z.object({ start: z.number(), end: z.number(), parentHash: z.string() }),
            })
            .parse(await inspect.json());
        expect(exact.text).toBe(excerpt);
        expect(exact.hash).toBe(digest(excerpt));
        expect(exact.scope).toMatchObject({
            start: 0,
            end: excerpt.length,
            parentHash: digest(architecture.text),
        });

        const staleKey = randomUUID();
        const stale = await page.request.post("/api/vantage/reviews", {
            headers: { "Idempotency-Key": staleKey },
            data: { weekStart: "2026-11-09", expectedActiveId: null },
        });
        expect(stale.status()).toBe(409);
        const staleRun = row(
            await sql<
                { generation_dispatched: boolean; judge_dispatched: boolean }[]
            >`SELECT generation_dispatched,judge_dispatched FROM pdr_ai_v2_vantage_weekly_review_runs WHERE company_id=${workspace.id} AND idempotency_key=${staleKey}`
        );
        expect(staleRun).toMatchObject({ generation_dispatched: false, judge_dispatched: false });
        const active = async () =>
            row(
                await sql<
                    { run_id: string }[]
                >`SELECT run_id FROM pdr_ai_v2_vantage_weekly_review_active WHERE company_id=${workspace.id} AND week_start='2026-11-09'`
            ).run_id;
        expect(await active()).toBe(review.id);
        const replacement = await page.request.post("/api/vantage/reviews", {
            headers: { "Idempotency-Key": randomUUID() },
            data: { weekStart: "2026-11-09", expectedActiveId: review.id },
        });
        expect(replacement.status(), await replacement.text()).toBe(201);
        const current = reviewSchema.parse(await replacement.json());
        expect(current.id).not.toBe(review.id);
        expect(await active()).toBe(current.id);
        expect((await page.request.get(`/api/vantage/reviews/${review.id}`)).status()).toBe(200);

        const decision = {
            expectedVersion: current.version,
            topicId: current.report.topics[0]!.id,
            decision: "investigate",
            outcome: "Synthetic human investigation recorded. Execution remains unverified.",
        };
        const decisionKey = randomUUID();
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await page.request.post(
                `/api/vantage/reviews/${current.id}/decisions`,
                { headers: { "Idempotency-Key": decisionKey }, data: decision }
            );
            expect(response.status()).toBe(200);
        }
        expect(
            row(
                await sql<
                    { n: number }[]
                >`SELECT count(*)::int AS n FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE run_id=${current.id}`
            ).n
        ).toBe(1);
        await page.goto("/employer/tools/vantage?week=2026-11-09");
        await expect(page.getByText(current.report.headline, { exact: true })).toBeVisible({
            timeout: 120_000,
        });
        await page.getByRole("button", { name: "Sources used", exact: true }).click();
        await page
            .getByRole("button", {
                name: new RegExp(
                    `^Source \\d+: Synthetic scoped architecture, version ${architecture.version}$`
                ),
            })
            .first()
            .click();
        const evidenceRegion = page.getByRole("dialog", {
            name: "Synthetic scoped architecture",
            exact: true,
        });
        await expect(evidenceRegion).toContainText(excerpt);
        await evidenceRegion.screenshot({ path: resolve(artifacts, "scoped-evidence.png") });
        await evidenceRegion.getByRole("button", { name: "Close", exact: true }).click();
        const topicToggle = page
            .getByTestId(`review-topic-${current.report.topics[0]!.id}`)
            .getByRole("button")
            .first();
        await topicToggle.click();
        await page.getByRole("button", { name: "Change decision", exact: true }).first().click();
        await expect(
            page.getByRole("textbox", { name: "Your decision", exact: true }).first()
        ).toHaveValue(decision.decision);
        const browserDecision =
            "Synthetic browser decision recorded. Execution remains unverified.";
        await page
            .getByRole("textbox", { name: "Your decision", exact: true })
            .first()
            .fill(browserDecision);
        const browserSaved = page.waitForResponse(
            response =>
                new URL(response.url()).pathname ===
                    `/api/vantage/reviews/${current.id}/decisions` &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Record decision", exact: true }).first().click();
        expect((await browserSaved).status()).toBe(200);
        await page.reload();
        await expect(page.getByText(current.report.headline, { exact: true })).toBeVisible();
        await expect(page.getByText(browserDecision, { exact: false }).first()).toBeVisible();
        expect(
            row(
                await sql<
                    { n: number }[]
                >`SELECT count(*)::int AS n FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE run_id=${current.id}`
            ).n
        ).toBe(2);

        // The same authenticated identity retains documents.read after role downgrade.
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET role='member' WHERE company_id=${workspace.id}`;
        const memberContext = await page.request.get("/api/vantage/reviews/context");
        expect(memberContext.status()).toBe(200);
        expect(
            z
                .object({ canConfigure: z.literal(false), policy: z.null() })
                .parse(await memberContext.json()).policy
        ).toBeNull();
        expect((await page.request.get(`/api/vantage/reviews/${current.id}`)).status()).toBe(200);
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET role='owner' WHERE company_id=${workspace.id}`;
        await sql`INSERT INTO pdr_ai_v2_document_settings(document_id,company_id,restricted,updated_by) VALUES (${star.id},${workspace.id},true,${authId})`;
        const filtered = z
            .object({
                preferences: z.object({
                    star_document_ids: z.array(z.string()),
                    star_source_scopes: z.record(z.string(), z.unknown()),
                }),
            })
            .parse(await (await page.request.get("/api/vantage/reviews/context")).json());
        expect(filtered.preferences.star_document_ids).not.toContain(star.id);
        expect(filtered.preferences.star_source_scopes[star.id]).toBeUndefined();
        expect(
            (
                await page.request.get(
                    `/api/vantage/reviews/${current.id}/evidence?ref=${encodeURIComponent(architectureSource.ref)}`
                )
            ).status()
        ).toBe(403);
        await sql`UPDATE pdr_ai_v2_document_settings SET restricted=false WHERE document_id=${star.id}`;

        // Keep the original pin while creating a valid new head, then delete the pin through HTTP.
        const newStar = row(
            await sql<
                { id: string }[]
            >`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,created_at) VALUES (${star.id},2,'https://example.invalid/synthetic-v2','text/plain','2026-11-08') RETURNING id::text`
        );
        const replacementText = "Synthetic replacement personal evidence. Human approval required.";
        await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${star.id},${newStar.id},${replacementText},1,1)`;
        await sql`UPDATE pdr_ai_v2_document SET current_version_id=${newStar.id} WHERE id=${star.id}`;
        const deleted = await page.request.delete(
            `/api/documents/${star.id}/versions/${star.version}`
        );
        expect(deleted.ok(), await deleted.text()).toBe(true);
        const missing = await page.request.get(
            `/api/vantage/reviews/context/source?documentId=${star.id}&purpose=personal-star`
        );
        expect(missing.status()).toBe(200);
        expect(
            z
                .object({
                    pin: z.object({ status: z.literal("missing_version") }),
                    preview: z.null(),
                })
                .parse(await missing.json()).preview
        ).toBeNull();
        await page.goto("/employer/tools/vantage/context?week=2026-11-09");
        const advanced = page.getByRole("button", {
            name: "Advanced: limit a document to specific passages",
            exact: true,
        });
        await advanced.click();
        const previewRegion = page.locator('[data-slot="collapsible"]').filter({ has: advanced });
        await page.getByLabel("Source to inspect", { exact: true }).click();
        await page
            .getByRole("option", {
                name: "Synthetic personal pinned source (Personal star)",
                exact: true,
            })
            .click();
        await expect(previewRegion).toContainText("Pinned version is missing.");
        await previewRegion.screenshot({ path: resolve(artifacts, "missing-pin.png") });
        await page.getByLabel("Source version", { exact: true }).click();
        await page.getByRole("option", { name: new RegExp(`^${newStar.id} [(]`) }).click();
        await expect(page.getByLabel("Canonical indexed text", { exact: true })).toHaveValue(
            replacementText
        );
        await page
            .getByLabel("Scope qualification", { exact: true })
            .fill("Explicit replacement approval from synthetic engineering trial.");
        await page.getByLabel("Unit ID 1", { exact: true }).fill("replacement-approved");
        await page.getByLabel("Start offset 1", { exact: true }).fill("0");
        await page.getByLabel("End offset 1", { exact: true }).fill(String(replacementText.length));
        const approved = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/reviews/context" &&
                response.request().method() === "PATCH"
        );
        await page.getByRole("button", { name: "Approve finite scope", exact: true }).click();
        expect((await approved).status()).toBe(200);
        const recovered = await page.request.get(
            `/api/vantage/reviews/context/source?documentId=${star.id}&purpose=personal-star`
        );
        expect(
            z
                .object({
                    pin: z.object({
                        status: z.literal("valid"),
                        scope: z.object({ version: z.string() }),
                    }),
                })
                .parse(await recovered.json()).pin.scope.version
        ).toBe(newStar.id);
        expect(await active()).toBe(current.id);
        await expect(advanced).toHaveAttribute("aria-expanded", "false");
        await advanced.click();
        await page.getByLabel("Source to inspect", { exact: true }).click();
        await page
            .getByRole("option", {
                name: "Synthetic personal pinned source (Personal star)",
                exact: true,
            })
            .click();
        await expect(page.getByLabel("Canonical indexed text", { exact: true })).toHaveValue(
            replacementText
        );
        await previewRegion.screenshot({ path: resolve(artifacts, "reapproved-pin.png") });
        await page.goto("/employer/tools/vantage?week=2026-11-09");
        const regenerated = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/reviews" &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Regenerate", exact: true }).click();
        const regeneratedResponse = await regenerated;
        expect(regeneratedResponse.status()).toBe(200);
        const recoveredReview = reviewSchema.parse(await generatedReview(regeneratedResponse));
        expect(await active()).toBe(recoveredReview.id);
        expect(
            recoveredReview.evidence.inputSnapshot.sources.some(
                source =>
                    source.purpose === "personal-star" &&
                    source.version === newStar.id &&
                    source.text === replacementText
            )
        ).toBe(true);
        await page.reload();
        await expect(
            page.getByText(recoveredReview.report.headline, { exact: true })
        ).toBeVisible();
        const fixtureCounts = row(
            await sql<{ documents: number; versions: number }[]>`
            SELECT count(DISTINCT d.id)::int AS documents,count(v.id)::int AS versions
            FROM pdr_ai_v2_document d LEFT JOIN pdr_ai_v2_document_versions v ON v.document_id=d.id
            WHERE d.company_id=${workspace.id}`
        );
        expect(fixtureCounts).toEqual({ documents: 25, versions: 25 });
        await writeFile(
            resolve(artifacts, "verification.json"),
            JSON.stringify(
                {
                    evidence: "injected-deterministic engineering integration",
                    companyId: workspace.id,
                    fixtureCounts,
                    reports: [review.id, current.id, recoveredReview.id],
                    architecture,
                    required,
                    star: { ...star, replacementVersion: newStar.id },
                    oversized: { id: oversized.id },
                    denied: { id: denied.id },
                    freezeHash: current.evidence.freezeHash,
                    staleRunDispatches: staleRun,
                    acceptedRunDispatches: {
                        generation: persisted.generation_dispatched,
                        judge: persisted.judge_dispatched,
                    },
                    checks: [
                        "authenticated signup",
                        "canonical retrieval",
                        "scoped frozen generation",
                        "validation judge",
                        "encrypted persistence",
                        "exact citation inspection",
                        "stale zero dispatch",
                        "active pointer replacement",
                        "decision idempotency",
                        "browser reload",
                        "metadata authorization",
                        "deleted pin reapproval",
                        "browser regeneration after reapproval",
                    ],
                },
                null,
                2
            )
        );
    } finally {
        await sql.end();
    }
});
