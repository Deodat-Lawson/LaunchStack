import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Response as PlaywrightResponse } from "@playwright/test";
import type postgres from "postgres";
import { z } from "zod";

// This test is limited to the dedicated synthetic database and local application.
// Authentication, the UI, PostgreSQL, and encryption are real; the configured
// generation and judge ports are deterministic fixtures, not quality evidence.

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
const row = <T>(rows: readonly T[]): T => {
    if (!rows[0]) throw new Error("Synthetic fixture row is missing");
    return rows[0];
};
const sourceSchema = z.object({
    id: z.string(),
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
        inputHash: z.string().regex(/^[a-f0-9]{64}$/),
        inputSnapshot: z.object({
            role: z.string(),
            sources: z.array(sourceSchema),
            scopedEvidence: z.array(
                z.object({
                    documentId: z.string(),
                    parentVersion: z.string(),
                    parentHash: z.string(),
                    coverage: z.object({ state: z.string(), originalCompleteness: z.string() }),
                })
            ),
            retrievalContext: z.object({
                schemaVersion: z.literal("vantage-dynamic-retrieval/v3"),
                mode: z.literal("combined"),
                traceHash: z.string().regex(/^[a-f0-9]{64}$/),
                businessRole: z.object({
                    primaryRole: z.string(),
                    responsibilities: z.array(z.string()),
                    priorities: z.array(z.string()),
                    revision: z.number(),
                }),
                internalDecision: z.object({ outcome: z.string(), questions: z.array(z.string()) }),
            }),
        }),
        sourceRegistry: z.array(
            z.object({
                ref: z.string(),
                version: z.string(),
                hash: z.string(),
                purpose: z.string(),
            })
        ),
        selectionDiagnostics: z.object({
            dynamicRetrieval: z.object({
                schemaVersion: z.literal("vantage-dynamic-retrieval-trace/v3"),
                mode: z.literal("combined"),
                roleStatus: z.literal("confirmed"),
                roleRevision: z.number(),
                rankingCandidateCount: z.number(),
                bounds: z.object({ initialCandidates: z.number(), maxFollowUpRounds: z.number() }),
                decision: z.object({ outcome: z.string(), queries: z.array(z.string()) }),
                finalDecision: z.object({ outcome: z.string(), unresolved: z.array(z.unknown()) }),
                followUp: z.object({
                    rounds: z.number(),
                    queryCount: z.number(),
                    acquiredCount: z.number(),
                }),
            }),
        }),
    }),
});

test.use({ serviceWorkers: "block" });

test("authenticated combined retrieval preserves scope, role, decision and history", async ({
    page,
    baseURL,
}) => {
    test.setTimeout(360_000);
    expect(process.env.DATABASE_URL).toBe(database);
    expect(baseURL).toBe("http://127.0.0.1:3199");
    const stamp = randomUUID();
    const artifacts = resolve(
        process.cwd(),
        "../../test-output/vantage-dynamic-v3-20261114",
        stamp
    );
    await mkdir(artifacts, { recursive: true });
    let blockedRequests = 0;
    let allowedRequests = 0;
    const checks: string[] = [];
    const saveAdmissionTrace = async (raw: unknown) => {
        const admitted = raw as {
            id: string;
            evidence: {
                inputSnapshot: { retrievalContext: unknown };
                selectionDiagnostics: { dynamicRetrieval: unknown };
                evaluation: { status: string; verdict: string };
                qualityEvidence: string;
            };
        };
        await writeFile(
            resolve(artifacts, "latest-admitted-trace.json"),
            JSON.stringify(
                {
                    reportId: admitted.id,
                    retrievalContext: admitted.evidence.inputSnapshot.retrievalContext,
                    dynamicTrace: admitted.evidence.selectionDiagnostics.dynamicRetrieval,
                    evaluation: {
                        status: admitted.evidence.evaluation.status,
                        verdict: admitted.evidence.evaluation.verdict,
                    },
                    qualityEvidence: admitted.evidence.qualityEvidence,
                },
                null,
                2
            )
        );
    };
    await page.context().route("**/*", async route => {
        const url = new URL(route.request().url());
        if (
            (url.protocol === "http:" || url.protocol === "https:") &&
            (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
            url.port === "3199"
        ) {
            allowedRequests++;
            await route.continue();
        } else {
            blockedRequests++;
            await route.abort();
        }
    });
    await page.context().routeWebSocket(/.*/, async socket => {
        const url = new URL(socket.url());
        if (
            (url.protocol === "ws:" || url.protocol === "wss:") &&
            (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
            url.port === "3199"
        ) {
            allowedRequests++;
            socket.connectToServer();
        } else {
            blockedRequests++;
            await socket.close();
        }
    });
    const createPostgres = localRequire("postgres") as typeof postgres;
    const sql = createPostgres(database, { max: 2 });
    const email = `dynamic-v3-${stamp}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const companyName = `Synthetic dynamic v3 ${stamp}`;
    try {
        // page.request calls below use only explicit local relative paths. They share
        // the isolated browser context's synthetic session and never contact providers.
        const signup = await page.request.post("/api/auth/sign-up/email", {
            data: { name: "Synthetic reviewer", email, password },
        });
        expect(signup.status()).toBe(200);
        const authId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json())
            .user.id;
        const company = await page.request.post("/api/signup/employerCompany", {
            data: { name: "Synthetic reviewer", email, companyName, numberOfEmployees: "1" },
        });
        expect(company.ok()).toBe(true);
        const workspace = row(
            await sql<
                { id: string }[]
            >`SELECT id::text FROM pdr_ai_v2_company WHERE name=${companyName}`
        );
        const addDocument = async (title: string, text: string, date = "2026-11-08") => {
            // Keep the manual trial usable through the normal source viewer too:
            // these are pre-indexed synthetic text files, with real tenant-owned bytes.
            const bytes = Buffer.from(text, "utf8");
            const file = row(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_file_uploads(user_id,company_id,filename,mime_type,file_data,file_size,storage_provider) VALUES (${authId},${workspace.id},${"synthetic-" + randomUUID() + ".txt"},'text/plain',${bytes.toString("base64")},${bytes.length},'database') RETURNING id::text`
            );
            const url = `/api/files/${file.id}`;
            const document = row(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_document(company_id,url,category,title,mime_type,ocr_processed,created_at,updated_at) VALUES (${workspace.id},${url},'Shared',${title},'text/plain',true,${date},${date}) RETURNING id::text`
            );
            const version = row(
                await sql<
                    { id: string }[]
                >`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type,file_size,ocr_processed,created_at) VALUES (${document.id},1,${url},'text/plain',${bytes.length},true,${date}) RETURNING id::text`
            );
            await sql`UPDATE pdr_ai_v2_document SET current_version_id=${version.id} WHERE id=${document.id}`;
            await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${document.id},${version.id},${text},1,1)`;
            return { id: document.id, version: version.id, text, url };
        };
        const excerpt = "Synthetic architecture context requires human review.";
        const architecture = await addDocument(
            "Synthetic scoped architecture",
            excerpt + "\n" + "Outside the approved scope. ".repeat(80)
        );
        const preview = await page.request.get(architecture.url);
        expect(preview.status()).toBe(200);
        expect(await preview.text()).toBe(architecture.text);
        const required = await addDocument(
            "Synthetic required rollback context",
            "Release rollback owner is unknown."
        );
        const star = await addDocument(
            "Synthetic personal star",
            "Personal evidence is available for human review."
        );
        const older = await addDocument(
            "Release rollback owner record",
            "Release rollback owner requires a human approval. No execution is claimed.",
            "2026-10-19"
        );
        for (let index = 0; index < 50; index++)
            await addDocument(
                `Synthetic routine ${index}`,
                `Routine update ${index}. Available for human review.`
            );

        const scope = {
            version: architecture.version,
            expectedParentHash: digest(architecture.text),
            qualification:
                "Explicitly approved synthetic finite span for engineering verification.",
            requiredUnits: [
                {
                    id: "approved-span",
                    start: 0,
                    end: excerpt.length,
                    excerptHash: digest(excerpt),
                },
            ],
        };
        const configured = await page.request.post("/api/vantage/reviews/context", {
            data: {
                expectedVersion: 0,
                architectureDocumentId: architecture.id,
                requiredDocumentIds: [required.id],
                requiredSourceScopes: { [architecture.id]: scope },
            },
        });
        expect(configured.status()).toBe(200);
        const starred = await page.request.patch("/api/vantage/reviews/context", {
            data: { expectedVersion: 0, starDocumentIds: [star.id] },
        });
        expect(starred.status()).toBe(200);
        expect(z.object({ version: z.number() }).parse(await starred.json()).version).toBe(1);
        checks.push("synthetic signup, company and exact-version document fixture");

        await page.goto("/employer/tools/vantage/context?week=2026-11-09");
        await page.getByRole("button", { name: "Open Your role", exact: true }).click();
        await page.getByLabel("Primary business role", { exact: true }).fill("Engineering lead");
        await page.getByLabel("Responsibilities", { exact: true }).fill("Release rollback");
        await page.getByLabel("Priorities", { exact: true }).fill("Owner");
        await page
            .getByLabel("I confirm these are my current business responsibilities and priorities.")
            .check();
        const savedRole = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/reviews/context/role" &&
                response.request().method() === "PATCH"
        );
        await page.getByRole("button", { name: "Confirm and save", exact: true }).click();
        expect((await savedRole).status()).toBe(200);
        await expect(
            page.getByRole("button", { name: "Generate review", exact: true }).first()
        ).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: "Your decision", exact: true })).toHaveCount(
            0
        );

        const roleResponse = await page.request.get("/api/vantage/reviews/context/role");
        expect(roleResponse.status()).toBe(200);
        const saved = z
            .object({
                version: z.number(),
                role: z.object({
                    primaryRole: z.string(),
                    confirmed: z.literal(true),
                    confirmedBy: z.string(),
                    companyId: z.string(),
                    revision: z.number(),
                }),
            })
            .parse(await roleResponse.json());
        expect(saved).toMatchObject({
            version: 2,
            role: {
                primaryRole: "Engineering lead",
                confirmedBy: authId,
                companyId: workspace.id,
                revision: 2,
            },
        });
        const staleRole = await page.request.patch("/api/vantage/reviews/context/role", {
            data: { expectedVersion: 1, role: null },
        });
        expect(staleRole.status()).toBe(409);
        const staleStars = await page.request.patch("/api/vantage/reviews/context", {
            data: { expectedVersion: 1, starDocumentIds: [] },
        });
        expect(staleStars.status()).toBe(409);
        const resaveStars = await page.request.patch("/api/vantage/reviews/context", {
            data: { expectedVersion: 2, starDocumentIds: [star.id] },
        });
        expect(resaveStars.status()).toBe(200);
        expect(z.object({ version: z.number() }).parse(await resaveStars.json()).version).toBe(3);
        const roleAfterStars = z
            .object({
                version: z.number(),
                role: z.object({ primaryRole: z.string(), revision: z.number() }),
            })
            .parse(await (await page.request.get("/api/vantage/reviews/context/role")).json());
        expect(roleAfterStars).toMatchObject({
            version: 3,
            role: { primaryRole: "Engineering lead", revision: 2 },
        });
        const preferences = z
            .object({
                preferences: z.object({
                    version: z.number(),
                    star_document_ids: z.array(z.string()),
                }),
            })
            .parse(await (await page.request.get("/api/vantage/reviews/context")).json());
        expect(preferences.preferences).toMatchObject({ version: 3, star_document_ids: [star.id] });
        checks.push(
            "browser business-role confirmation; stale role and star CAS rejected; star and role preserved"
        );

        await page.getByRole("link", { name: "Go to This week", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Your role", exact: true })).toHaveCount(0);
        await expect(
            page.getByRole("heading", { name: "Company documents", exact: true })
        ).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: "Generate review", exact: true }).first()
        ).toBeEnabled();
        await expect(page.getByText(/^Week of /)).toContainText("Nov 9");
        const generation = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/reviews" &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Generate review", exact: true }).first().click();
        const generated = await generation;
        expect(generated.status()).toBe(200);
        const rawReview: unknown = await generatedReview(generated);
        const review = reviewSchema.parse(rawReview);
        await saveAdmissionTrace(rawReview);
        const rawSnapshot = (rawReview as { evidence: { inputSnapshot: { sources: unknown } } })
            .evidence.inputSnapshot;
        expect(digest(JSON.stringify(rawSnapshot))).toBe(review.evidence.inputHash);
        expect(digest(JSON.stringify(rawSnapshot.sources))).toBe(review.evidence.freezeHash);
        const { inputSnapshot, selectionDiagnostics } = review.evidence;
        const trace = selectionDiagnostics.dynamicRetrieval;
        expect(inputSnapshot.role).not.toBe("Engineering lead");
        expect(inputSnapshot.retrievalContext.businessRole).toEqual({
            primaryRole: "Engineering lead",
            responsibilities: ["Release rollback"],
            priorities: ["Owner"],
            revision: 2,
        });
        expect(inputSnapshot.retrievalContext.internalDecision.outcome).toBe(
            "INSUFFICIENT_EVIDENCE"
        );
        expect(inputSnapshot.retrievalContext.internalDecision.questions.length).toBeGreaterThan(0);
        expect(trace).toMatchObject({
            roleRevision: 2,
            rankingCandidateCount: 48,
            bounds: { initialCandidates: 48, maxFollowUpRounds: 1 },
            decision: { outcome: "INTERNAL_FOLLOW_UP" },
            finalDecision: { outcome: "INSUFFICIENT_EVIDENCE" },
            followUp: { rounds: 1 },
        });
        expect(trace.decision.queries).toContain("release rollback owner");
        expect(trace.followUp.queryCount).toBeGreaterThan(0);
        expect(trace.followUp.acquiredCount).toBeGreaterThan(0);
        expect(trace.finalDecision.unresolved.length).toBeGreaterThan(0);
        const sources = inputSnapshot.sources;
        const scopedSource = row(
            sources.filter(
                source => source.id === architecture.id && source.purpose === "company-architecture"
            )
        );
        expect(scopedSource).toMatchObject({
            version: architecture.version,
            text: excerpt,
            hash: digest(excerpt),
        });
        expect(scopedSource.ref).toMatch(/^unit:[a-f0-9]{64}$/);
        for (const [document, purpose] of [
            [required, "workspace-required"],
            [star, "personal-star"],
            [older, "retrieved"],
        ] as const) {
            expect(sources).toContainEqual(
                expect.objectContaining({
                    id: document.id,
                    version: document.version,
                    ref: `doc:${document.id}@${document.version}`,
                    text: document.text,
                    hash: digest(document.text),
                    purpose,
                })
            );
        }
        expect(sources.some(source => source.text === architecture.text)).toBe(false);
        expect(inputSnapshot.scopedEvidence).toEqual(
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
        for (const source of sources) {
            expect(source.hash).toBe(digest(source.text));
            expect(
                review.evidence.sourceRegistry.find(item => item.ref === source.ref)
            ).toMatchObject({
                version: source.version,
                hash: source.hash,
                purpose: source.purpose,
            });
        }
        for (const topic of review.report.topics)
            for (const fact of topic.facts)
                for (const ref of fact.refs)
                    expect(sources.some(source => source.ref === ref)).toBe(true);
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
        expect(persisted.ciphertext.length).toBeGreaterThan(0);
        expect(persisted.ciphertext).not.toContain(excerpt);
        expect(persisted.ciphertext).not.toContain(required.text);
        checks.push(
            "browser generation, frozen exact source hashes, scoped proof, injected evaluation pass and one internal follow-up"
        );

        await expect(page.getByText(review.report.headline, { exact: true })).toBeVisible();
        await expect(
            page.getByText("Deterministic provider fixture", { exact: false })
        ).toBeVisible();
        const evidenceResponse = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/vantage/reviews/${review.id}/evidence` &&
                new URL(response.url()).searchParams.get("ref") === scopedSource.ref
        );
        await page.getByRole("button", { name: "Sources used", exact: true }).click();
        await page
            .getByRole("button", {
                name: new RegExp(
                    `^Source \\d+: Synthetic scoped architecture, version ${architecture.version}$`
                ),
            })
            .first()
            .click();
        const evidenceHttp = await evidenceResponse;
        expect(evidenceHttp.status()).toBe(200);
        const exact = z
            .object({
                text: z.string(),
                hash: z.string(),
                authorization: z.literal("current"),
                scope: z.object({ start: z.number(), end: z.number(), parentHash: z.string() }),
            })
            .parse(await evidenceHttp.json());
        expect(exact).toMatchObject({
            text: excerpt,
            hash: digest(excerpt),
            scope: { start: 0, end: excerpt.length, parentHash: digest(architecture.text) },
        });
        const evidenceRegion = page.getByRole("dialog", {
            name: "Synthetic scoped architecture",
            exact: true,
        });
        await expect(evidenceRegion).toContainText(excerpt);
        await evidenceRegion
            .getByRole("button", { name: "Technical details", exact: true })
            .click();
        await expect(evidenceRegion).toContainText(digest(excerpt));
        await evidenceRegion.screenshot({ path: resolve(artifacts, "exact-scoped-citation.png") });
        await evidenceRegion.getByRole("button", { name: "Close", exact: true }).click();
        const decisionText =
            "Synthetic human investigation recorded. Execution remains unverified.";
        const decisionEditor = page
            .getByRole("textbox", { name: "Your decision", exact: true })
            .first();
        // The injected real-report fixture has no recommendation, so this editor stays blank.
        await expect(decisionEditor).toHaveValue("");
        await decisionEditor.fill(decisionText);
        const decisionSave = page.waitForResponse(
            response =>
                new URL(response.url()).pathname ===
                    `/api/vantage/reviews/${review.id}/decisions` &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Record decision", exact: true }).first().click();
        expect((await decisionSave).status()).toBe(200);
        await expect(page.getByText(decisionText, { exact: false }).first()).toBeVisible();
        await page.reload();
        await expect(page.getByText(decisionText, { exact: false }).first()).toBeVisible();
        const history = z
            .object({
                activeId: z.string(),
                runs: z.array(z.object({ id: z.string(), status: z.string() })),
            })
            .parse(
                await (await page.request.get("/api/vantage/reviews?weekStart=2026-11-09")).json()
            );
        expect(history.activeId).toBe(review.id);
        expect(history.runs).toContainEqual(
            expect.objectContaining({ id: review.id, status: "accepted" })
        );
        const persistedDecision = row(
            await sql<
                { n: number; ciphertext: string }[]
            >`SELECT count(*)::int AS n,min(ciphertext) AS ciphertext FROM pdr_ai_v2_vantage_weekly_review_decisions WHERE run_id=${review.id}`
        );
        expect(persistedDecision.n).toBe(1);
        expect(persistedDecision.ciphertext).not.toContain(decisionText);
        await page.screenshot({
            path: resolve(artifacts, "decision-after-reload.png"),
            fullPage: true,
        });

        // A second browser-generated review replaces the active pointer. Reopen the
        // first through the actual history control and verify its decision survived.
        const replacementWait = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/reviews" &&
                response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "Regenerate", exact: true }).click();
        const replacementResponse = await replacementWait;
        expect(replacementResponse.status()).toBe(200);
        const rawReplacement: unknown = await generatedReview(replacementResponse);
        const replacement = reviewSchema.parse(rawReplacement);
        await saveAdmissionTrace(rawReplacement);
        expect(replacement.id).not.toBe(review.id);
        await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeEnabled();
        const historyAfterReplacement = z
            .object({
                activeId: z.string(),
                runs: z.array(z.object({ id: z.string(), status: z.string() })),
            })
            .parse(
                await (await page.request.get("/api/vantage/reviews?weekStart=2026-11-09")).json()
            );
        expect(historyAfterReplacement.activeId).toBe(replacement.id);
        expect(historyAfterReplacement.runs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: review.id, status: "accepted" }),
                expect.objectContaining({ id: replacement.id, status: "accepted" }),
            ])
        );
        await page.getByLabel("Report history", { exact: true }).click();
        await expect(page.getByRole("option")).toHaveCount(2);
        const historicalRead = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/vantage/reviews/${review.id}` &&
                response.request().method() === "GET"
        );
        await page.getByRole("option").nth(1).click();
        expect((await historicalRead).status()).toBe(200);
        await expect(page.getByText(decisionText, { exact: false }).first()).toBeVisible();
        await page.screenshot({
            path: resolve(artifacts, "historical-decision.png"),
            fullPage: true,
        });
        checks.push(
            "exact citation click, encrypted decision and reload; replacement retains historical report and decision"
        );
    } finally {
        await writeFile(
            resolve(artifacts, "browser-evidence.json"),
            JSON.stringify(
                {
                    evidence:
                        "synthetic injected deterministic generation and judge; not independent model quality",
                    allowedLoopbackRequests: allowedRequests,
                    blockedExternalRequests: blockedRequests,
                    checks,
                },
                null,
                2
            )
        );
        await sql.end();
    }
});
