import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test, type APIResponse, type Page } from "@playwright/test";

/**
 * Real HTTP + Better Auth + browser acceptance for the isolated Vantage pilot.
 * The server and throwaway database are provisioned separately. This spec
 * neither starts a database nor reads an application .env file. It never uses
 * /dev/vantage, a fake session, a mocked generation port, or a model provider.
 *
 * Required: E2E_BASE_URL (loopback), VANTAGE_E2E_ISOLATED=1,
 * VANTAGE_E2E_EMAIL, VANTAGE_E2E_PASSWORD, VANTAGE_E2E_FIXTURE_PATH.
 * The fixture manifest identifies synthetic rows seeded in that database;
 * its historical rows must predate their reporting cutoff. Run on a fresh
 * fixture database: the happy-path test expects no saved report initially.
 *
 * Tests labelled @gap are deliberately ordinary acceptance assertions. Known
 * product gaps remain failures and must be reported separately from passes.
 */
type SourceFixture = {
    id: string;
    title: string;
    body: string;
    source: string;
    observedAt: string;
};

type Fixture = {
    weekStart: string;
    followingWeekStart: string;
    evidence: SourceFixture;
    oldEvidence?: SourceFixture;
    oldObservation?: { id: string; value: number; periodStart: string; periodEnd: string };
    definition?: { name: string };
};

type Ref = { ref: string; label: string; date: string | null };
type Topic = {
    id: string;
    title: string;
    contentVersion: number;
    facts: { text: string; refs: Ref[] }[];
    proposedNextStep: string;
    proposedOwner: string | null;
    proposedDue: string | null;
    decision: string | null;
    commitmentId: string | null;
};
type Agenda = {
    id: string;
    version: number;
    weekStart: string;
    topics: Topic[];
    enhancements: {
        id: string;
        topicId: string;
        kind: string;
        text: string;
        status: string;
        baseTopicVersion: number;
    }[];
    reportPeriod: { weekStart: string; timeZone: string; asOf: string } | null;
    execution: {
        mode: string;
        outcome: string;
        attempts: number;
        fallbackReason: string | null;
        modelId: string | null;
    } | null;
};
type Commitment = {
    id: string;
    topicId: string | null;
    title: string;
    status: string;
    outcome: string | null;
};

let fixture: Fixture;
const blockedBrowserHosts = new WeakMap<Page, Set<string>>();

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Set ${name} for the explicitly isolated acceptance run.`);
    return value;
}

function pathFor(screen: string): string {
    // Exercise the supported legacy deep-link redirect into the real workspace.
    return `/employer/tools/vantage${screen}`;
}

function agendaRequest(url: string, method: string): boolean {
    return new URL(url).pathname === "/api/vantage/agendas" && method === "POST";
}

async function json<T>(response: APIResponse, label: string): Promise<T> {
    expect(response.ok(), `${label}: HTTP ${response.status()}`).toBe(true);
    return (await response.json()) as T;
}

async function readAgenda(page: Page, week: string): Promise<Agenda | null> {
    const result = await json<{ agenda: Agenda | null }>(
        await page.request.get(`/api/vantage/agendas?week=${week}`),
        "Read saved agenda through the authenticated API"
    );
    return result.agenda;
}

async function openWeek(page: Page, week: string) {
    await page.goto(pathFor(`/agenda?week=${week}`));
    await expect(page.getByRole("region", { name: "Generation controls" })).toBeVisible({
        timeout: 90_000,
    });
    await expect(page.getByRole("combobox", { name: "Generation mode" })).toBeEnabled();
    await expect(
        page.getByRole("button", { name: /^(?:Generate|Regenerate) report$/ })
    ).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe("/employer/documents");
}

async function generateRules(page: Page): Promise<Agenda> {
    await page.getByRole("combobox", { name: "Generation mode" }).click();
    await page.getByRole("option", { name: "Rules only", exact: true }).click();
    const pending = page.waitForResponse(response =>
        agendaRequest(response.url(), response.request().method())
    );
    await page.getByRole("button", { name: /^(?:Generate|Regenerate) report$/ }).click();
    const response = await pending;
    expect(response.request().postDataJSON()).toMatchObject({ generationMode: "rules" });
    expect(response.ok(), `UI rules generation: HTTP ${response.status()}`).toBe(true);
    const { agenda } = (await response.json()) as { agenda: Agenda };
    expect(agenda.execution).toMatchObject({
        mode: "rules",
        attempts: 0,
        fallbackReason: null,
        modelId: null,
    });
    await expect(page.getByText("Report generated and saved.", { exact: true })).toBeVisible();
    return agenda;
}

async function seededTopic(page: Page, title: string, refs: Ref[] = []): Promise<Topic> {
    let agenda = await readAgenda(page, fixture.weekStart);
    if (!agenda) {
        // Setup only, for independent regression tests if the happy path failed.
        // This still invokes the installed adapter and the actual database.
        const created = await json<{ agenda: Agenda }>(
            await page.request.post("/api/vantage/agendas", {
                data: { weekStart: fixture.weekStart, generationMode: "rules" },
            }),
            "Create real rules report for independent regression setup"
        );
        agenda = created.agenda;
    }
    const { topic } = await json<{ topic: Topic }>(
        await page.request.post(`/api/vantage/agendas/${agenda.id}/topics`, {
            data: {
                title,
                facts: [{ text: "Synthetic acceptance fixture; no business information.", refs }],
                whyItMatters: "Exercise the isolated acceptance boundary.",
                decisionQuestion: "Should this synthetic check continue?",
                proposedNextStep: "Perform the synthetic check.",
                proposedOwner: "Isolated E2E operator",
                proposedDue: fixture.followingWeekStart,
                shared: false,
            },
        }),
        "Create synthetic regression topic through the authenticated API"
    );
    return topic;
}

async function commitmentsFor(page: Page, topicId: string): Promise<Commitment[]> {
    const result = await json<{ commitments: Commitment[] }>(
        await page.request.get("/api/vantage/commitments"),
        "Read persisted commitments"
    );
    return result.commitments.filter(commitment => commitment.topicId === topicId);
}

async function attachEvidence(name: string, evidence: unknown) {
    const evidencePath = test.info().outputPath(`${name}.json`);
    mkdirSync(test.info().outputDir, { recursive: true });
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    await test.info().attach(name, {
        path: evidencePath,
        contentType: "application/json",
    });
}

test.describe("Vantage Contract v1 authenticated isolated acceptance", () => {
    test.skip(
        process.env.VANTAGE_E2E_ISOLATED !== "1",
        "Requires explicit isolated-database opt-in; no application state was read."
    );
    test.setTimeout(240_000);

    test.beforeAll(() => {
        const target = new URL(required("E2E_BASE_URL"));
        expect(["localhost", "127.0.0.1", "::1", "[::1]"]).toContain(target.hostname);
        expect(target.protocol).toBe("http:");
        required("VANTAGE_E2E_EMAIL");
        required("VANTAGE_E2E_PASSWORD");
        fixture = JSON.parse(readFileSync(required("VANTAGE_E2E_FIXTURE_PATH"), "utf8")) as Fixture;
        expect(fixture.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(fixture.followingWeekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(fixture.evidence.id).toBeTruthy();
        expect(fixture.evidence.body).toBeTruthy();
    });

    test.beforeEach(async ({ page }) => {
        const blocked = new Set<string>();
        blockedBrowserHosts.set(page, blocked);
        const origin = new URL(required("E2E_BASE_URL")).origin;
        await page.context().route("**/*", async route => {
            const target = new URL(route.request().url());
            if (target.origin === origin) await route.continue();
            else {
                blocked.add(target.hostname);
                await route.abort("blockedbyclient");
            }
        });
        test.info().annotations.push({
            type: "verification-boundary",
            description:
                "Real loopback app, Better Auth cookie, installed rules adapter, isolated Postgres; no provider calls.",
        });
        const login = await page.request.post("/api/auth/sign-in/email", {
            headers: { origin: new URL(required("E2E_BASE_URL")).origin },
            data: {
                email: required("VANTAGE_E2E_EMAIL"),
                password: required("VANTAGE_E2E_PASSWORD"),
            },
        });
        // Do not attach auth response bodies or cookies to test output.
        expect(login.ok(), `Real Better Auth sign-in: HTTP ${login.status()}`).toBe(true);
        const session = await page.request.get("/api/auth/get-session");
        expect(session.ok()).toBe(true);
        const sessionBody = (await session.json()) as { user?: { email?: string } };
        expect(sessionBody.user?.email).toBe(required("VANTAGE_E2E_EMAIL"));
        expect(
            (await page.context().cookies()).some(cookie => cookie.name.endsWith("session_token"))
        ).toBe(true);
        // This read also proves the configured workspace/operator gate admitted
        // the real authenticated request, rather than bypassing it in a mock.
        await readAgenda(page, fixture.weekStart);
    });

    test.afterEach(async ({ page }) => {
        const blocked = [...(blockedBrowserHosts.get(page) ?? [])];
        if (blocked.length) await attachEvidence("blocked-external-browser-hosts", blocked);
    });

    test("@access the real session and isolated workspace/operator gate fail closed", async ({
        page,
        playwright,
    }) => {
        const baseURL = required("E2E_BASE_URL");
        const anonymous = await playwright.request.newContext({ baseURL });
        const denied = await playwright.request.newContext({ baseURL });
        const outsider = await playwright.request.newContext({ baseURL });
        try {
            const status: Record<string, { read: number; generate: number }> = {};
            for (const [label, context, email] of [
                ["anonymous", anonymous, null],
                ["same-workspace-unlisted-operator", denied, required("VANTAGE_E2E_DENIED_EMAIL")],
                ["different-workspace", outsider, required("VANTAGE_E2E_OUTSIDER_EMAIL")],
            ] as const) {
                if (email) {
                    const login = await context.post("/api/auth/sign-in/email", {
                        headers: { origin: new URL(baseURL).origin },
                        data: { email, password: required("VANTAGE_E2E_PASSWORD") },
                    });
                    expect(login.ok(), `${label} authenticates through Better Auth`).toBe(true);
                    const authenticated = await json<{ user?: { email?: string } }>(
                        await context.get("/api/auth/get-session"),
                        "Confirm denied actor has a real authenticated session"
                    );
                    expect(authenticated.user?.email).toBe(email);
                }
                const read = await context.get(`/api/vantage/agendas?week=${fixture.weekStart}`);
                const generate = await context.post("/api/vantage/agendas", {
                    data: { weekStart: fixture.weekStart, generationMode: "rules" },
                });
                status[label] = { read: read.status(), generate: generate.status() };
                const expected = email ? 403 : 401;
                expect(
                    status[label],
                    `${label} cannot read or generate in the configured pilot`
                ).toEqual({ read: expected, generate: expected });
            }
            const permitted = await page.request.get(
                `/api/vantage/agendas?week=${fixture.weekStart}`
            );
            expect(permitted.status()).toBe(200);
            await attachEvidence("real-auth-access-gate", {
                denied: status,
                permittedRead: permitted.status(),
            });
        } finally {
            await Promise.all([anonymous.dispose(), denied.dispose(), outsider.dispose()]);
        }
    });

    test("@happy rules → source → edit → regenerate → review → decision → reload → following-week outcome", async ({
        page,
    }) => {
        const generationRequests: unknown[] = [];
        page.on("request", request => {
            if (agendaRequest(request.url(), request.method()))
                generationRequests.push(request.postDataJSON());
        });
        expect(
            await readAgenda(page, fixture.weekStart),
            "Use a fresh isolated fixture database"
        ).toBeNull();
        await openWeek(page, fixture.weekStart);
        await page.reload();
        await expect(
            page.getByRole("button", { name: "Generate report", exact: true })
        ).toBeEnabled();
        expect(generationRequests, "Opening and reloading a week must not generate").toHaveLength(
            0
        );
        expect(await readAgenda(page, fixture.weekStart)).toBeNull();

        const first = await generateRules(page);
        expect(first.reportPeriod).toMatchObject({
            weekStart: fixture.weekStart,
            timeZone: "America/New_York",
        });
        const original = first.topics.find(topic =>
            topic.facts.some(fact => fact.refs.some(ref => ref.ref === `ev:${fixture.evidence.id}`))
        );
        expect(original, "Rules output must cite the real synthetic interview row").toBeDefined();
        if (!original) throw new Error("No source-grounded interview topic was generated.");
        let article = page.getByRole("article", { name: original.title, exact: true });
        await expect(article).toBeVisible();
        await article
            .getByRole("button", {
                name: `${fixture.evidence.source} · ${fixture.evidence.observedAt}`,
                exact: true,
            })
            .first()
            .click();
        let dialog = page.getByRole("dialog");
        await expect(
            dialog.getByRole("heading", { name: fixture.evidence.title, exact: true })
        ).toBeVisible();
        await expect(dialog.getByText(fixture.evidence.body, { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");

        const reviewedTitle = "E2E human-reviewed export check";
        const reviewedStep =
            "Human plan: observe three synthetic export tasks and record assistance.";
        await article.getByRole("button", { name: "Edit topic", exact: true }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("Title", { exact: true }).fill(reviewedTitle);
        await dialog.getByLabel("Proposed next step", { exact: true }).fill(reviewedStep);
        await dialog.getByLabel("Owner", { exact: true }).fill("Isolated E2E operator");
        await dialog.getByLabel("Due", { exact: true }).fill(fixture.followingWeekStart);
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        article = page.getByRole("article", { name: reviewedTitle, exact: true });
        await expect(article).toBeVisible();
        await expect(article.getByText(reviewedStep, { exact: true })).toBeVisible();
        const edited = (await readAgenda(page, fixture.weekStart))!.topics.find(
            topic => topic.id === original.id
        )!;
        expect(edited.contentVersion).toBeGreaterThan(original.contentVersion);
        expect(edited.facts).toEqual(original.facts);

        const regenerated = await generateRules(page);
        const preserved = regenerated.topics.find(topic => topic.id === original.id)!;
        expect(preserved.title).toBe(reviewedTitle);
        expect(preserved.proposedNextStep).toBe(reviewedStep);
        expect(preserved.facts).toEqual(edited.facts);
        const addition = regenerated.enhancements.find(
            item => item.topicId === original.id && item.status === "suggested"
        );
        expect(
            addition,
            "A different generated step must be a separately reviewable addition"
        ).toBeDefined();
        if (!addition) throw new Error("Regeneration did not provide a reviewable addition.");
        expect(addition.baseTopicVersion).toBe(preserved.contentVersion);
        await article
            .getByRole("region", { name: `Suggested addition: ${addition.kind}`, exact: true })
            .filter({ hasText: addition.text })
            .getByRole("button", { name: "Accept addition", exact: true })
            .click();
        await expect(
            article.getByRole("heading", { name: "Approved addition", exact: true })
        ).toBeVisible();
        const reviewed = (await readAgenda(page, fixture.weekStart))!;
        expect(reviewed.enhancements.find(item => item.id === addition.id)?.status).toBe(
            "accepted"
        );
        expect(reviewed.topics.find(topic => topic.id === original.id)?.proposedNextStep).toBe(
            reviewedStep
        );

        const actionTitle = "E2E observe synthetic export tasks";
        const decision = "Approve the synthetic export observation; keep the human plan.";
        await article.getByRole("button", { name: "Record decision", exact: true }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("What was decided", { exact: true }).fill(decision);
        await dialog.getByLabel("Action", { exact: true }).fill(actionTitle);
        await dialog.getByLabel("Owner", { exact: true }).fill("Isolated E2E operator");
        await dialog.getByLabel("Due", { exact: true }).fill(fixture.followingWeekStart);
        await dialog
            .getByLabel("The test", { exact: true })
            .fill("Three synthetic tasks have completion and assistance recorded.");
        await dialog.getByRole("button", { name: "Record", exact: true }).click();
        await expect(article.getByText(decision, { exact: true })).toBeVisible();
        await page.reload();
        article = page.getByRole("article", { name: reviewedTitle, exact: true });
        await expect(article.getByText(decision, { exact: true })).toBeVisible();
        const savedActions = await commitmentsFor(page, original.id);
        expect(savedActions).toHaveLength(1);
        const commitmentId = savedActions[0]!.id;
        expect(
            (await readAgenda(page, fixture.weekStart))!.topics.find(
                topic => topic.id === original.id
            )?.commitmentId
        ).toBe(commitmentId);

        await article.getByRole("button", { name: "View linked action", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Commitments", exact: true })).toBeVisible();
        await expect(page.getByText(actionTitle, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Check in", exact: true }).click();
        await page.getByRole("button", { name: "Done", exact: true }).click();
        const outcome =
            "All three synthetic testers completed export without assistance; this is an acceptance fixture only.";
        await page.getByLabel("What was learned", { exact: true }).fill(outcome);
        await page.getByRole("button", { name: "Save check-in", exact: true }).click();
        await expect
            .poll(async () => (await commitmentsFor(page, original.id))[0]?.status)
            .toBe("done");
        await page.reload();
        await expect(page.getByText(`Learned: ${outcome}`, { exact: true })).toBeVisible();
        expect((await commitmentsFor(page, original.id))[0]).toMatchObject({
            id: commitmentId,
            status: "done",
            outcome,
        });

        const countBeforeNextWeek = generationRequests.length;
        await openWeek(page, fixture.followingWeekStart);
        expect(generationRequests).toHaveLength(countBeforeNextWeek);
        const following = await generateRules(page);
        const outcomeTopic = following.topics.find(topic =>
            topic.facts.some(
                fact =>
                    fact.refs.some(ref => ref.ref === `cm:${commitmentId}`) &&
                    fact.text.includes(outcome)
            )
        );
        expect(outcomeTopic, "Following-week rules must cite the persisted outcome").toBeDefined();
        if (!outcomeTopic)
            throw new Error("The next report did not include the resolved synthetic action.");
        await expect(
            page.getByRole("article", { name: outcomeTopic.title, exact: true })
        ).toContainText(outcome);
        expect(generationRequests).toHaveLength(3);
        await attachEvidence("rules-loop-readback", {
            firstReport: first.id,
            firstPeriod: first.reportPeriod,
            reviewedTopic: original.id,
            acceptedAddition: addition.id,
            commitmentId,
            followingPeriod: following.reportPeriod,
            followingExecution: following.execution,
            browserGenerationRequests: generationRequests,
        });
        await test.info().attach("following-week-real-ui", {
            body: await page.screenshot({ fullPage: true }),
            contentType: "image/png",
        });
    });

    test("@retry committed decision with a lost response retries the identical key and creates one action", async ({
        page,
    }) => {
        const topic = await seededTopic(page, `E2E lost-response ${randomUUID().slice(0, 8)}`);
        await openWeek(page, fixture.weekStart);
        await page
            .getByRole("article", { name: topic.title, exact: true })
            .getByRole("button", { name: "Record decision", exact: true })
            .click();
        const dialog = page.getByRole("dialog");
        await dialog
            .getByLabel("What was decided", { exact: true })
            .fill("Proceed with the isolated retry check.");
        await dialog
            .getByLabel("The test", { exact: true })
            .fill("Exactly one persisted primary action after retry.");
        const attempts: { key: string | null; body: unknown }[] = [];
        let committedStatus: number | null = null;
        await page.route(`**/api/vantage/topics/${topic.id}/decide`, async route => {
            const request = route.request();
            attempts.push({
                key: await request.headerValue("idempotency-key"),
                body: request.postDataJSON(),
            });
            if (attempts.length === 1) {
                // The real server commits first. Only its response delivery is
                // dropped; no canned success body or fake transaction is used.
                const committed = await route.fetch();
                committedStatus = committed.status();
                await committed.body();
                await route.abort("connectionfailed");
            } else {
                await route.continue();
            }
        });
        await dialog.getByRole("button", { name: "Record", exact: true }).click();
        await expect(
            dialog.getByRole("button", { name: "Retry unchanged submission", exact: true })
        ).toBeVisible();
        expect(committedStatus).toBe(200);
        await expect(dialog.getByLabel("What was decided", { exact: true })).toBeDisabled();
        const committed = await commitmentsFor(page, topic.id);
        expect(committed).toHaveLength(1);
        await dialog
            .getByRole("button", { name: "Retry unchanged submission", exact: true })
            .click();
        await expect(dialog).not.toBeVisible();
        expect(attempts).toHaveLength(2);
        expect(attempts[0]!.key).toBeTruthy();
        expect(attempts[1]).toEqual(attempts[0]);
        await page.reload();
        expect(await commitmentsFor(page, topic.id)).toEqual(committed);
        await attachEvidence("real-commit-lost-response-retry", {
            committedStatus,
            attempts,
            persistedActionIds: committed.map(item => item.id),
        });
    });

    test("@reload a lost committed response is reconciled by full reload without an automatic second write", async ({
        page,
    }) => {
        const topic = await seededTopic(page, `E2E reload-boundary ${randomUUID().slice(0, 8)}`);
        await openWeek(page, fixture.weekStart);
        await page
            .getByRole("article", { name: topic.title, exact: true })
            .getByRole("button", { name: "Record decision", exact: true })
            .click();
        const decision = "Reconcile this real saved decision after a full reload.";
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("What was decided", { exact: true }).fill(decision);
        await dialog
            .getByLabel("The test", { exact: true })
            .fill("One saved action survives reload and identical replay.");
        const submissions: { key: string | null; body: unknown }[] = [];
        const browserWrites: string[] = [];
        page.on("request", request => {
            if (
                new URL(request.url()).pathname === `/api/vantage/topics/${topic.id}/decide` &&
                request.method() === "POST"
            )
                browserWrites.push(request.url());
        });
        let committedStatus: number | null = null;
        await page.route(`**/api/vantage/topics/${topic.id}/decide`, async route => {
            const request = route.request();
            submissions.push({
                key: await request.headerValue("idempotency-key"),
                body: request.postDataJSON(),
            });
            const committed = await route.fetch();
            committedStatus = committed.status();
            await committed.body();
            await route.abort("connectionfailed");
        });
        await dialog.getByRole("button", { name: "Record", exact: true }).click();
        await expect(
            dialog.getByRole("button", { name: "Retry unchanged submission", exact: true })
        ).toBeVisible();
        expect(committedStatus).toBe(200);
        expect(submissions).toHaveLength(1);
        const submission = submissions[0]!;
        if (!submission.key)
            throw new Error("The real decision request did not carry an idempotency key.");
        const committedActions = await commitmentsFor(page, topic.id);
        expect(committedActions).toHaveLength(1);

        // The full document reload discards the dialog's in-memory uncertain
        // payload. Reconcile from the actual saved report before any new write.
        await page.reload();
        const article = page.getByRole("article", { name: topic.title, exact: true });
        await expect(article.getByText(decision, { exact: true })).toBeVisible();
        await expect(
            article.getByRole("button", { name: "View linked action", exact: true })
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(browserWrites, "Reload must not automatically resubmit the decision").toHaveLength(
            1
        );
        const reconciled = (await readAgenda(page, fixture.weekStart))!.topics.find(
            item => item.id === topic.id
        )!;
        expect(reconciled.commitmentId).toBe(committedActions[0]!.id);
        expect(await commitmentsFor(page, topic.id)).toEqual(committedActions);

        // This is the exact original authenticated HTTP submission, not a
        // reconstructed dialog payload. The server must return the same result.
        const replay = await json<{ topic: Topic }>(
            await page.request.post(`/api/vantage/topics/${topic.id}/decide`, {
                headers: { "Idempotency-Key": submission.key },
                data: submission.body,
            }),
            "Replay original committed submission after full reload"
        );
        expect(replay.topic.commitmentId).toBe(committedActions[0]!.id);
        expect(replay.topic.contentVersion).toBe(reconciled.contentVersion);
        expect(await commitmentsFor(page, topic.id)).toEqual(committedActions);
        expect(browserWrites).toHaveLength(1);
        await attachEvidence("real-commit-full-reload-reconciliation", {
            committedStatus,
            originalSubmission: submission,
            browserDecisionWrites: browserWrites.length,
            reconciledTopic: {
                id: reconciled.id,
                decision: reconciled.decision,
                commitmentId: reconciled.commitmentId,
                contentVersion: reconciled.contentVersion,
            },
            replayedTopic: {
                id: replay.topic.id,
                commitmentId: replay.topic.commitmentId,
                contentVersion: replay.topic.contentVersion,
            },
            persistedActionIds: committedActions.map(item => item.id),
        });
    });

    test("@readback saved following-week rules report still cites the persisted completed outcome", async ({
        page,
    }) => {
        const businessWrites: { method: string; path: string }[] = [];
        page.on("request", request => {
            const path = new URL(request.url()).pathname;
            if (path.startsWith("/api/vantage/") && !["GET", "HEAD"].includes(request.method()))
                businessWrites.push({ method: request.method(), path });
        });
        const following = await readAgenda(page, fixture.followingWeekStart);
        expect(
            following,
            "Run the successful happy path once before this read-only follow-up"
        ).not.toBeNull();
        if (!following) throw new Error("No saved following-week report exists for readback.");
        expect(following.execution).toMatchObject({
            mode: "rules",
            attempts: 0,
            fallbackReason: null,
            modelId: null,
        });
        const all = await json<{ commitments: Commitment[] }>(
            await page.request.get("/api/vantage/commitments"),
            "Read completed happy-path action"
        );
        const completed = all.commitments.find(
            item =>
                item.title === "E2E observe synthetic export tasks" &&
                item.status === "done" &&
                item.outcome
        );
        expect(completed).toBeDefined();
        if (!completed?.outcome)
            throw new Error("The completed synthetic action has no persisted outcome.");
        const cited = following.topics.find(topic =>
            topic.facts.some(
                fact =>
                    fact.refs.some(ref => ref.ref === `cm:${completed.id}`) &&
                    fact.text.includes(completed.outcome!)
            )
        );
        expect(
            cited,
            "Saved next-week facts must still cite the real completed action and its outcome"
        ).toBeDefined();
        if (!cited)
            throw new Error(
                "The saved following-week report no longer cites the completed outcome."
            );
        await openWeek(page, fixture.followingWeekStart);
        await page.reload();
        await expect(page.getByRole("article", { name: cited.title, exact: true })).toContainText(
            completed.outcome
        );
        expect(
            businessWrites,
            "Readback and reload must remain read-only for Vantage business state"
        ).toHaveLength(0);
        await attachEvidence("following-week-persisted-readback", {
            reportId: following.id,
            reportVersion: following.version,
            reportPeriod: following.reportPeriod,
            execution: following.execution,
            completedAction: {
                id: completed.id,
                status: completed.status,
                outcome: completed.outcome,
            },
            citedTopic: { id: cited.id, title: cited.title, facts: cited.facts },
            browserBusinessWrites: businessWrites,
        });
        const screenshotPath = test.info().outputPath("following-week-readback.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await test
            .info()
            .attach("following-week-readback", { path: screenshotPath, contentType: "image/png" });
    });

    test("@metrics manual Signups dates survive the real UI request, response, and database readback", async ({
        page,
    }) => {
        type Observation = {
            id: string;
            metricId: string;
            value: number;
            periodStart: string;
            periodEnd: string;
            source: string | null;
        };
        const initial = await json<{ definitions: { id: string; key: string; name: string }[] }>(
            await page.request.get("/api/vantage/metrics"),
            "Read the actual Signups definition"
        );
        const signups = initial.definitions.find(item => item.key === "signups");
        expect(signups).toBeDefined();
        if (!signups) throw new Error("The isolated fixture has no Signups definition.");
        const sameNameIndex = initial.definitions
            .filter(item => item.name === signups.name)
            .findIndex(item => item.id === signups.id);
        expect(sameNameIndex).toBeGreaterThanOrEqual(0);
        const source = `E2E manual dates ${randomUUID().slice(0, 8)}`;
        const intended = {
            metricId: signups.id,
            value: 37,
            periodStart: "2026-10-12",
            periodEnd: "2026-10-18",
            source,
        };
        await page.goto(pathFor("/metrics"));
        await page.getByRole("button", { name: "Record a number", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("combobox", { name: "Metric", exact: true }).click();
        await page
            .getByRole("option", { name: signups.name, exact: true })
            .nth(sameNameIndex)
            .click();
        await dialog.getByLabel("Value (count)", { exact: true }).fill("37");
        await dialog.getByLabel("Period start", { exact: true }).fill(intended.periodStart);
        await dialog.getByLabel("Period end", { exact: true }).fill(intended.periodEnd);
        await dialog.getByLabel("Source", { exact: true }).fill(source);
        const pending = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/metrics/observations" &&
                response.request().method() === "POST"
        );
        await dialog.getByRole("button", { name: "Record", exact: true }).click();
        const response = await pending;
        expect(response.status()).toBe(201);
        const actualRequest = response.request().postDataJSON() as unknown;
        expect(actualRequest).toMatchObject(intended);
        const actualResponse = (await response.json()) as { observations: Observation[] };
        const responseObservation = actualResponse.observations.find(
            item => item.source === source && item.value === intended.value
        );
        expect(responseObservation).toMatchObject(intended);
        await expect(dialog).not.toBeVisible();
        const saved = await json<{ observations: Observation[] }>(
            await page.request.get("/api/vantage/metrics"),
            "Read the saved manual observation independently"
        );
        const persistedObservation = saved.observations.find(
            item => item.id === responseObservation?.id
        );
        expect(persistedObservation).toMatchObject(intended);
        await page.reload();
        await expect(page.getByText(source, { exact: true })).toBeVisible();
        await attachEvidence("manual-period-real-request-and-readback", {
            intended,
            actualRequest,
            actualPostStatus: response.status(),
            actualResponse: {
                observation: responseObservation,
                observationsReturned: actualResponse.observations.length,
            },
            persistedObservation,
        });
    });

    test("@refresh successful decision with a failed following read must show saved content or block stale writes", async ({
        page,
    }) => {
        test.info().annotations.push({
            type: "owner",
            description:
                "Joseph: apply the saved DTO immediately or block stale decision controls until refresh succeeds",
        });
        const topic = await seededTopic(page, `E2E failed-refresh ${randomUUID().slice(0, 8)}`);
        await openWeek(page, fixture.weekStart);
        const article = page.getByRole("article", { name: topic.title, exact: true });
        await expect(
            article.getByRole("button", { name: "Record decision", exact: true })
        ).toBeEnabled();
        let abortedReads = 0;
        let browserDecisionWrites = 0;
        page.on("request", request => {
            if (
                new URL(request.url()).pathname === `/api/vantage/topics/${topic.id}/decide` &&
                request.method() === "POST"
            )
                browserDecisionWrites += 1;
        });
        // Install only after the actual initial read has completed. APIRequest
        // readbacks bypass this browser route and still reach the real server.
        const selectedAgendaRead = (url: URL) =>
            url.pathname === "/api/vantage/agendas" &&
            url.searchParams.get("week") === fixture.weekStart;
        await page.route(selectedAgendaRead, async route => {
            if (route.request().method() === "GET") {
                abortedReads += 1;
                await route.abort("connectionfailed");
            } else await route.continue();
        });
        const decision =
            "The synthetic decision committed successfully before the display refresh failed.";
        await article.getByRole("button", { name: "Record decision", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("What was decided", { exact: true }).fill(decision);
        await dialog
            .getByLabel("The test", { exact: true })
            .fill("The saved decision and one primary action reconcile after a failed refresh.");
        const pending = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/vantage/topics/${topic.id}/decide` &&
                response.request().method() === "POST"
        );
        await dialog.getByRole("button", { name: "Record", exact: true }).click();
        const response = await pending;
        expect(response.status()).toBe(200);
        const savedResponse = (await response.json()) as { topic: Topic };
        await expect(dialog).not.toBeVisible();
        const reload = page.getByRole("button", { name: "Reload saved report", exact: true });
        await expect(reload).toBeVisible();
        expect(abortedReads).toBeGreaterThan(0);
        const persisted = (await readAgenda(page, fixture.weekStart))!.topics.find(
            item => item.id === topic.id
        )!;
        const actions = await commitmentsFor(page, topic.id);
        expect(actions).toHaveLength(1);
        expect(persisted.decision).toBe(decision);
        expect(persisted.commitmentId).toBe(actions[0]!.id);
        expect(savedResponse.topic.commitmentId).toBe(actions[0]!.id);
        const oldRecord = article.getByRole("button", { name: "Record decision", exact: true });
        const uiDecisionVisible = await article.getByText(decision, { exact: true }).isVisible();
        const oldRecordEnabled = (await oldRecord.count()) > 0 && (await oldRecord.isEnabled());
        const beforeRecovery = {
            uiDecisionVisible,
            oldRecordEnabled,
            errorReloadVisible: await reload.isVisible(),
            alertTexts: await page
                .locator('[role="alert"]:not(#__next-route-announcer__)')
                .allTextContents(),
        };
        const screenshotPath = test
            .info()
            .outputPath("successful-write-failed-refresh-before-recovery.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await test.info().attach("successful-write-failed-refresh-before-recovery", {
            path: screenshotPath,
            contentType: "image/png",
        });

        // Recover before asserting the safety gap, so a failure still records
        // that the committed transaction survives and the real UI can reload.
        await page.unroute(selectedAgendaRead);
        await reload.click();
        await expect(article.getByText(decision, { exact: true })).toBeVisible();
        await expect(
            article.getByRole("button", { name: "View linked action", exact: true })
        ).toBeVisible();
        expect(await commitmentsFor(page, topic.id)).toEqual(actions);
        expect(browserDecisionWrites).toBe(1);
        await attachEvidence("successful-write-failed-refresh-readback", {
            actualWriteStatus: response.status(),
            savedResponseTopic: {
                id: savedResponse.topic.id,
                decision: savedResponse.topic.decision,
                commitmentId: savedResponse.topic.commitmentId,
            },
            persistedTopic: {
                id: persisted.id,
                decision: persisted.decision,
                commitmentId: persisted.commitmentId,
            },
            persistedActionIds: actions.map(item => item.id),
            abortedBrowserReads: abortedReads,
            browserDecisionWrites,
            beforeRecovery,
            recoveredDecisionVisible: await article
                .getByText(decision, { exact: true })
                .isVisible(),
            recoveredLinkedActionVisible: await article
                .getByRole("button", { name: "View linked action", exact: true })
                .isVisible(),
        });
        expect(
            uiDecisionVisible || !oldRecordEnabled,
            "After a committed write and failed refresh, show the saved DTO or prevent another stale Record decision submission"
        ).toBe(true);
    });

    test("@gap stale Topic edit must be rejected without overwriting the newer saved content", async ({
        page,
    }) => {
        test.info().annotations.push({
            type: "owner",
            description:
                "TL schema/API/repository version guard + Joseph TopicDialog expectedContentVersion",
        });
        const topic = await seededTopic(page, `E2E stale-edit ${randomUUID().slice(0, 8)}`);
        await openWeek(page, fixture.weekStart);
        await page
            .getByRole("article", { name: topic.title, exact: true })
            .getByRole("button", { name: "Edit topic", exact: true })
            .click();
        const winner = `${topic.title} newer saved edit`;
        await json(
            await page.request.patch(`/api/vantage/topics/${topic.id}`, {
                data: { title: winner, expectedContentVersion: topic.contentVersion },
            }),
            "Concurrent authenticated edit"
        );
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Title", { exact: true }).fill(`${topic.title} stale dialog edit`);
        const pending = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === `/api/vantage/topics/${topic.id}` &&
                response.request().method() === "PATCH"
        );
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        const response = await pending;
        const after = (await readAgenda(page, fixture.weekStart))!.topics.find(
            item => item.id === topic.id
        )!;
        await attachEvidence("stale-edit-real-readback", {
            expectedStatus: 409,
            actualStatus: response.status(),
            submittedPayload: response.request().postDataJSON() as unknown,
            newerTitle: winner,
            persistedTitle: after.title,
            persistedVersion: after.contentVersion,
        });
        expect(response.status(), "The stale browser edit must fail with a conflict").toBe(409);
        expect(after.title, "The newer saved edit must survive").toBe(winner);
    });

    test("@gap private v1 must not offer Share with the program", async ({ page }) => {
        test.info().annotations.push({
            type: "owner",
            description:
                "Joseph inherited EvidenceScreen sharing control; TL keeps server rejection",
        });
        const rejected = await page.request.patch(`/api/vantage/evidence/${fixture.evidence.id}`, {
            data: { visibility: "shared" },
        });
        expect(rejected.status(), "The real server must continue enforcing private-only v1").toBe(
            400
        );
        await page.goto(pathFor("/evidence"));
        await page
            .getByRole("button", { name: `Actions for ${fixture.evidence.title}`, exact: true })
            .click();
        const sharing = page.getByRole("menuitem", { name: "Share with the program", exact: true });
        await attachEvidence("private-only-ui-and-api", {
            serverSharedWriteStatus: rejected.status(),
            visibleShareEntries: await sharing.count(),
        });
        await expect(
            sharing,
            "A private-only contract must not advertise an unavailable shared write"
        ).toHaveCount(0);
    });

    test("@gap an older accessible cited source must remain viewable beyond the latest 200 evidence", async ({
        page,
    }) => {
        test.info().annotations.push({
            type: "owner",
            description: "TL authorized ID-scoped source endpoint + Joseph SourceDialog lookup",
        });
        if (!fixture.oldEvidence) {
            test.skip(
                true,
                "Requires a seeded oldEvidence record beyond the list cap; no synthetic pass claimed."
            );
            return;
        }
        const old = fixture.oldEvidence;
        const list = await json<{ evidence: SourceFixture[] }>(
            await page.request.get("/api/vantage/evidence"),
            "Read the real capped evidence list"
        );
        expect(list.evidence).toHaveLength(200);
        expect(
            list.evidence.some(item => item.id === old.id),
            "Fixture must exercise a source outside the list window"
        ).toBe(false);
        const topic = await seededTopic(page, `E2E old-source ${randomUUID().slice(0, 8)}`, [
            { ref: `ev:${old.id}`, label: old.source, date: old.observedAt },
        ]);
        await openWeek(page, fixture.weekStart);
        await page
            .getByRole("article", { name: topic.title, exact: true })
            .getByRole("button", { name: `${old.source} · ${old.observedAt}`, exact: true })
            .click();
        const dialog = page.getByRole("dialog");
        await attachEvidence("old-source-list-window", {
            seededSourceId: old.id,
            seededSourceTitle: old.title,
            listLength: list.evidence.length,
            sourcePresentInList: false,
        });
        await expect(
            dialog.getByText(old.body, { exact: true }),
            "A real accessible source must be read by ID even when older than the recent list"
        ).toBeVisible();
    });

    test("@gap an older accessible metric citation must remain viewable beyond the latest 500 observations", async ({
        page,
    }) => {
        test.info().annotations.push({
            type: "owner",
            description:
                "TL authorized ID-scoped observation endpoint + Joseph SourceDialog lookup",
        });
        if (!fixture.oldObservation || !fixture.definition) {
            test.skip(
                true,
                "Requires a seeded oldObservation beyond the list cap; no synthetic pass claimed."
            );
            return;
        }
        const old = fixture.oldObservation;
        const list = await json<{ observations: { id: string }[] }>(
            await page.request.get("/api/vantage/metrics"),
            "Read the real capped observation list"
        );
        expect(list.observations).toHaveLength(500);
        expect(
            list.observations.some(item => item.id === old.id),
            "Fixture must exercise an observation outside the list window"
        ).toBe(false);
        const topic = await seededTopic(page, `E2E old-observation ${randomUUID().slice(0, 8)}`, [
            { ref: `obs:${old.id}`, label: "Synthetic fixture", date: old.periodEnd },
        ]);
        await openWeek(page, fixture.weekStart);
        await page
            .getByRole("article", { name: topic.title, exact: true })
            .getByRole("button", { name: `Synthetic fixture · ${old.periodEnd}`, exact: true })
            .click();
        const dialog = page.getByRole("dialog");
        await attachEvidence("old-observation-list-window", {
            seededObservationId: old.id,
            listLength: list.observations.length,
            sourcePresentInList: false,
        });
        await expect(
            dialog.getByRole("heading", { name: fixture.definition.name, exact: true }),
            "A real accessible observation must be read by ID beyond the list window"
        ).toBeVisible();
        await expect(dialog).toContainText(`Value: ${old.value}`);
    });
});
