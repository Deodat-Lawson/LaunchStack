#!/usr/bin/env node
/** Headless, authenticated synthetic demo smoke. Never calls a live model. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, request } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const options = {};
const flags = new Set();
for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (["--review", "--confirm-disposable-fixture", "--replay"].includes(key)) {
        flags.add(key);
    } else if (["--base-url", "--credentials", "--output"].includes(key)) {
        if (!args[index + 1] || args[index + 1].startsWith("--"))
            throw Error("A required smoke option value is missing.");
        options[key] = args[++index];
    } else {
        throw Error("Unknown smoke option. Use --base-url, --credentials and --output.");
    }
}
const target = new URL(
    options["--base-url"] ?? process.env.E2E_BASE_URL ?? "http://localhost:3104"
);
if (
    target.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
)
    throw Error("Smoke is restricted to a local synthetic application origin.");
if (flags.has("--review") && !flags.has("--confirm-disposable-fixture"))
    throw Error(
        "Review writes require --confirm-disposable-fixture on a disposable clean-clone fixture."
    );
if (flags.has("--review") && target.port === "3104")
    throw Error("Review writes are disabled on the preserved original demo port 3104.");
const credentialsFile = options["--credentials"] ?? process.env.VANTAGE_DEMO_CREDENTIALS_FILE;
if (!credentialsFile) throw Error("Pass the local ignored credential file with --credentials.");
const output = resolve(
    root,
    options["--output"] ??
        `test-output/vantage-context-demo/headless-${new Date().toISOString().replace(/\D/g, "")}-${randomUUID().slice(0, 8)}`
);
const ignoredRoot = resolve(root, "test-output");
if (!output.startsWith(ignoredRoot + sep))
    throw Error("Smoke artifacts must stay under test-output.");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length > 0) throw Error("Use a new empty smoke artifact directory.");
const credentials = JSON.parse(await readFile(resolve(root, credentialsFile), "utf8"));
if (
    typeof credentials.loginEmail !== "string" ||
    !/\.(test|invalid)$/.test(credentials.loginEmail) ||
    typeof credentials.loginPassword !== "string" ||
    !credentials.loginPassword
)
    throw Error("An existing isolated synthetic login is required.");
const results = {
    syntheticOnly: true,
    headless: true,
    liveProviderCalled: false,
    startedAt: new Date().toISOString(),
    checks: [],
    reviewWritesRequested: flags.has("--review"),
    replayRequested: flags.has("--replay"),
};
const mark = name => results.checks.push(name);
const artifact = async (name, value) =>
    writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const screenshots = [];
let api, browser;
let stage = "synthetic-authentication";
try {
    api = await request.newContext({ baseURL: target.origin, timeout: 120000 });
    const signedIn = await api.post("/api/auth/sign-in/email", {
        headers: { origin: target.origin },
        data: { email: credentials.loginEmail, password: credentials.loginPassword },
    });
    expect(signedIn.ok(), "Synthetic authentication should succeed").toBe(true);
    mark("existing synthetic account authenticates through normal Better Auth API");
    stage = "authorized-demo-state";
    let stateResponse = await api.get("/api/vantage/demo");
    expect(stateResponse.status()).toBe(200);
    let state = await stateResponse.json();
    expect(state.companyArchitecture?.source.kind).toBe("company");
    expect(state.companyArchitecture?.reviewState).toBe("unreviewed");
    const architecture = JSON.parse(state.companyArchitecture.body);
    expect(architecture.reviewState).toBe("unreviewed");
    expect(architecture.facts).toHaveLength(13);
    expect(architecture.unknowns.map(value => value.code)).toEqual(
        expect.arrayContaining(["personnel_unknown", "hierarchy_unknown"])
    );
    mark("authorized Company Architecture has 13 facts and truthful unknown/unreviewed state");
    stage = "headless-browser-launch";
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        storageState: await api.storageState(),
        viewport: { width: 1440, height: 1080 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(120000);
    const screenshot = async name => {
        await page.screenshot({ path: resolve(output, name), fullPage: true });
        screenshots.push(name);
    };
    stage = "frontend-load";
    await page.goto(`${target.origin}/dev/vantage-context`, { waitUntil: "domcontentloaded" });
    await expect(
        page.getByRole("heading", { name: "Your weekly review, with context" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Inspect Company Architecture" })).toBeVisible();
    mark("development Vantage route loads for authenticated actor");

    if (flags.has("--replay")) {
        stage = "explicit-offline-replay";
        expect(state.generationMode).toBe("replay");
        const replay = page.getByRole("button", {
            name: /replay.*(?:saved|recorded|synthetic)|(?:saved|recorded|synthetic).*replay/i,
        });
        expect(await replay.count()).toBeGreaterThan(0);
        const replayResponsePromise = page.waitForResponse(
            response =>
                new URL(response.url()).pathname === "/api/vantage/demo" &&
                response.request().method() === "POST"
        );
        await replay.first().click();
        const replayResponse = await replayResponsePromise;
        expect(replayResponse.status()).toBe(201);
        state = await replayResponse.json();
        expect(state.report.execution.mode).toBe("replay");
        await expect(
            page.getByRole("region", { name: "Saved contextual weekly summary" })
        ).toBeVisible();
        mark("explicitly labeled offline replay completed without a live-model request");
    }
    stage = "saved-report";
    expect(state.report?.summary).toBeTruthy();
    await expect(
        page.getByRole("region", { name: "Saved contextual weekly summary" })
    ).toContainText(state.report.summary);
    expect(state.report.topics.length).toBeGreaterThan(0);
    await expect(
        page.getByRole("heading", { name: state.report.topics[0].title, exact: true })
    ).toBeVisible();
    await screenshot("desktop-report.png");
    await artifact("saved-report.json", state.report);
    await artifact("authorized-company-architecture.json", state.companyArchitecture);
    mark("actual saved contextual summary and decision topics are displayed");

    stage = "architecture-source-panel";
    await page.getByRole("button", { name: "Inspect Company Architecture" }).click();
    let dialog = page.getByRole("dialog");
    await expect(
        dialog.getByText(`Exact version ${state.companyArchitecture.source.version}`, {
            exact: true,
        })
    ).toBeVisible();
    await expect(dialog.getByText("unreviewed", { exact: true })).toBeVisible();
    for (const fact of architecture.facts)
        await expect(dialog.getByText(fact.value, { exact: true })).toHaveCount(1);
    await screenshot("desktop-company-architecture.png");
    await dialog
        .getByText(architecture.facts.at(-1).value, { exact: true })
        .scrollIntoViewIfNeeded();
    await screenshot("desktop-company-details.png");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    mark("source panel renders all 13 exact authorized values and version identity");

    stage = "exact-topic-citation";
    const topic = state.report.topics.find(value => value.facts.some(fact => fact.refs.length));
    expect(topic).toBeTruthy();
    const citation =
        topic.facts.flatMap(fact => fact.refs).find(ref => ref.kind === "doc") ??
        topic.facts.flatMap(fact => fact.refs)[0];
    const exactIdentity = `${citation.kind}:${citation.id}@${citation.version}`;
    const article = page.getByRole("article", { name: topic.title, exact: true });
    const sourceResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return (
            url.pathname === "/api/vantage/demo/source" &&
            url.searchParams.get("id") === citation.id &&
            url.searchParams.get("version") === citation.version
        );
    });
    await article.getByTitle(exactIdentity, { exact: true }).first().click();
    const sourceResponse = await sourceResponsePromise;
    expect(sourceResponse.status()).toBe(200);
    const source = await sourceResponse.json();
    expect(source.source).toEqual(citation);
    dialog = page.getByRole("dialog");
    await expect(dialog.getByText(exactIdentity, { exact: true })).toBeVisible();
    await expect(
        dialog.getByText(`Exact version ${citation.version}`, { exact: true })
    ).toBeVisible();
    await screenshot("desktop-exact-citation.png");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    mark("topic citation opens the exact authorized kind/id/version source");

    stage = "pending-history";
    const pendingResponse = await api.get(
        `/api/vantage/agendas/${encodeURIComponent(state.nativeAgendaId)}/pending-questions`
    );
    expect(pendingResponse.status()).toBe(200);
    const pending = await pendingResponse.json();
    expect(pending.questions.length).toBeGreaterThan(0);
    const pendingRegion = page.getByRole("region", {
        name: "Pending Questions from Previous Reviews",
    });
    await expect(pendingRegion).toBeVisible();
    for (const question of pending.questions)
        await expect(pendingRegion.getByText(question.question, { exact: true })).toBeVisible();
    await expect(pendingRegion).toContainText("current status is unverified");
    await screenshot("desktop-pending-questions.png");
    mark("original pending questions remain visible with unverified progress");

    stage = "human-review-controls";
    const firstTopic = page.getByRole("article", {
        name: state.report.topics[0].title,
        exact: true,
    });
    await firstTopic.getByRole("button", { name: /^(Record|Update) decision$/ }).click();
    dialog = page.getByRole("dialog", { name: "Record your decision" });
    await expect(dialog.getByRole("radio", { name: "Go", exact: true })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "No-go", exact: true })).toBeVisible();
    await expect(
        dialog.getByRole("radio", { name: "Needs more evidence", exact: true })
    ).toBeVisible();
    await screenshot("desktop-human-review.png");
    if (flags.has("--review")) {
        await dialog.getByRole("radio", { name: "Needs more evidence", exact: true }).check();
        await dialog
            .getByRole("textbox")
            .fill(
                "Synthetic clean-clone smoke review: compare account samples before any privacy decision."
            );
        const savedPromise = page.waitForResponse(
            response =>
                response.url().endsWith("/api/vantage/demo/topics") &&
                response.request().method() === "PATCH"
        );
        await dialog.getByRole("button", { name: "Save decision", exact: true }).click();
        const savedResponse = await savedPromise;
        expect(savedResponse.status()).toBe(200);
        state = await savedResponse.json();
        expect(state.report.topics[0].decision?.value).toBe("needs-more-evidence");
        mark("explicitly opted-in synthetic review saved through guarded API");
    } else {
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        mark(
            "Go/No-go/Needs more evidence review controls inspected without changing saved decisions"
        );
    }
    stage = "reload-preservation";
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
        page.getByRole("region", { name: "Saved contextual weekly summary" })
    ).toContainText(state.report.summary);
    const refreshedResponse = await api.get("/api/vantage/demo");
    expect(refreshedResponse.status()).toBe(200);
    const refreshed = await refreshedResponse.json();
    expect(refreshed.report).toEqual(state.report);
    await expect(
        page.getByRole("region", { name: "Pending Questions from Previous Reviews" })
    ).toBeVisible();
    mark("reload retains exact saved contextual report, review state and pending questions");
    stage = "context-diagnostics";
    await page
        .locator("summary")
        .filter({ hasText: /Saved report details/ })
        .click();
    await expect(page.getByText("Sophia retrieval", { exact: true })).toBeVisible();
    await expect(
        page.getByText("Company profile claims remain unreviewed.", { exact: false })
    ).toBeVisible();
    await screenshot("desktop-context-diagnostics.png");
    mark("retrieval/manifest diagnostics remain visible");
    stage = "mobile-layout";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
        page.getByRole("region", { name: "Saved contextual weekly summary" })
    ).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2
    );
    expect(overflow, "Mobile page should not require horizontal scrolling").toBe(false);
    await screenshot("mobile-report.png");
    mark("390px mobile layout displays contextual report without horizontal page overflow");
    results.passed = true;
} catch {
    results.passed = false;
    results.failedStage = stage;
    process.exitCode = 1;
} finally {
    await browser?.close();
    await api?.dispose();
    results.completedAt = new Date().toISOString();
    results.screenshots = screenshots;
    await artifact("results.json", results);
    console.log(
        JSON.stringify({
            passed: results.passed,
            checks: results.checks,
            ...(results.failedStage ? { failedStage: results.failedStage } : {}),
            artifacts: relative(root, output),
            headless: true,
            liveProviderCalled: false,
        })
    );
}
