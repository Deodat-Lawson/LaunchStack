#!/usr/bin/env node
/** Isolated Joseph integration acceptance. Headless browser; no model calls or native ACL edits. */
import { randomUUID } from "node:crypto";
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect as baseExpect, request } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2),
    options = {};
for (let i = 0; i < args.length; i++) {
    if (!["--base-url", "--credentials", "--output"].includes(args[i]) || !args[i + 1])
        throw Error("Use --base-url, --credentials and --output.");
    options[args[i]] = args[++i];
}
const target = new URL(options["--base-url"] ?? "http://localhost:3106");
if (
    target.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.port !== "3106" ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
)
    throw Error("Joseph smoke writes require the separate local integration port 3106.");
if (!options["--credentials"]) throw Error("Pass the existing ignored synthetic credential file.");
const credentials = JSON.parse(await readFile(resolve(root, options["--credentials"]), "utf8"));
if (
    !/\.(invalid|test)$/.test(credentials.loginEmail ?? "") ||
    typeof credentials.loginPassword !== "string"
)
    throw Error("An existing synthetic login is required.");
const output = resolve(
    root,
    options["--output"] ??
        `test-output/vantage-joseph/headless-${new Date().toISOString().replace(/\D/g, "")}-${randomUUID().slice(0, 8)}`
);
if (!output.startsWith(resolve(root, "test-output") + sep))
    throw Error("Use a fresh ignored test-output directory.");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw Error("Use a new empty artifact directory.");
const result = {
    syntheticOnly: true,
    headless: true,
    startedAt: new Date().toISOString(),
    liveProviderCalled: false,
    checks: [],
    screenshots: [],
};
const mark = name => result.checks.push(name);
const artifact = (name, value) =>
    writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
let api,
    browser,
    page,
    stage = "authentication";
try {
    api = await request.newContext({ baseURL: target.origin, timeout: 120000 });
    const login = await api.post("/api/auth/sign-in/email", {
        headers: { origin: target.origin },
        data: { email: credentials.loginEmail, password: credentials.loginPassword },
    });
    expect(login.ok()).toBe(true);
    mark("normal synthetic Better Auth login");
    const stateResponse = await api.get("/api/vantage/demo");
    expect(stateResponse.status()).toBe(200);
    const state = await stateResponse.json();
    expect(state.personalContextAvailable).toBe(true);
    expect(state.report?.summary).toBeTruthy();
    expect(state.companyArchitecture.reviewState).toBe("unreviewed");
    const week = state.selectedWeek,
        path = "/api/vantage/demo/personal?" + new URLSearchParams({ week });
    const loadPersonal = async () => {
        const response = await api.get(path);
        expect(response.status()).toBe(200);
        return response.json();
    };
    let personal = await loadPersonal();
    expect(personal.ready).toBe(false);
    await artifact("personal-before.json", personal);
    await artifact("saved-report-before.json", state.report);
    mark("Joseph readiness is blocked while actual Company Architecture stays unreviewed");
    stage = "browser-landing";
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        storageState: await api.storageState(),
        viewport: { width: 1440, height: 1080 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
    });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(120000);
    const shot = async (name, locator) => {
        if (locator) await locator.screenshot({ path: resolve(output, name) });
        else await page.screenshot({ path: resolve(output, name), fullPage: true });
        result.screenshots.push(name);
    };
    await page.goto(target.origin + "/dev/vantage-context", { waitUntil: "domcontentloaded" });
    await expect(
        page.getByRole("region", { name: "Saved contextual weekly summary" })
    ).toContainText(state.report.summary);
    const personalRegion = page.getByRole("region", { name: "Joseph personal context" });
    await expect(personalRegion).toBeVisible();
    const generation = page.getByRole("button", {
        name: /^(Replay recorded report|Generate with context)$/,
    });
    await expect(generation).toBeDisabled();
    await shot("01-integration-landing.png");
    await personalRegion.locator("summary").first().click();
    await expect(
        personalRegion.getByRole("checkbox", { name: "Founder", exact: true })
    ).toBeVisible();
    await expect(personalRegion).toContainText("restarting the server resets them");
    await expect(personalRegion).toContainText("saved report retains its original context");
    mark("integrated page retains prior report/citations and labels process-only personal state");
    stage = "multiple-roles-primary";
    await personalRegion.getByRole("checkbox", { name: "Founder", exact: true }).check();
    await personalRegion.getByRole("checkbox", { name: "Engineering", exact: true }).check();
    const makePrimary = personalRegion.getByRole("button", { name: /Make primary.*Engineering/ });
    if (await makePrimary.count()) await makePrimary.click();
    await personalRegion.getByRole("button", { name: "Save roles", exact: true }).click();
    await expect(
        personalRegion.getByRole("button", { name: "Save roles", exact: true })
    ).toBeEnabled();
    await expect(
        personalRegion.getByRole("button", { name: /Primary perspective.*Engineering/ })
    ).toBeVisible();
    personal = await loadPersonal();
    expect(personal.roles.roleIds).toEqual(expect.arrayContaining(["founder", "engineering"]));
    expect(personal.roles.primaryRoleId).toBe("engineering");
    expect(personal.roles.userConfirmed).toBe(true);
    await shot(
        "02-multiple-roles-primary.png",
        personalRegion.getByRole("region", { name: "Business responsibilities" })
    );
    mark("multiple business roles and Engineering primary saved with Joseph controlled mapping");
    stage = "starred-versioned-documents";
    const initialStars = new Set(personal.state.stars.map(star => star.documentId));
    const choices = personal.documents
        .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate))
        .slice(0, 2);
    expect(choices.length).toBeGreaterThan(0);
    for (const doc of choices) {
        if (!initialStars.has(doc.id))
            await personalRegion
                .getByRole("button", { name: "Star " + doc.title, exact: true })
                .click();
        await expect(
            personalRegion.getByRole("button", { name: "Unstar " + doc.title, exact: true })
        ).toBeEnabled();
    }
    personal = await loadPersonal();
    expect(personal.state.stars.length).toBeGreaterThanOrEqual(2);
    for (const doc of choices) {
        const star = personal.state.stars.find(star => star.documentId === doc.id);
        expect(star.lastKnownRef).toEqual({ kind: "doc", id: doc.id, version: doc.version });
    }
    await shot(
        "03-starred-documents-exact-versions.png",
        personalRegion.getByRole("region", { name: "Your Vantage stars" })
    );
    const removed = choices[0];
    await personalRegion
        .getByRole("button", { name: "Unstar " + removed.title, exact: true })
        .click();
    await expect(
        personalRegion.getByRole("button", { name: "Star " + removed.title, exact: true })
    ).toBeEnabled();
    personal = await loadPersonal();
    expect(personal.state.stars.some(star => star.documentId === removed.id)).toBe(false);
    await personalRegion
        .getByRole("button", { name: "Star " + removed.title, exact: true })
        .click();
    await expect(
        personalRegion.getByRole("button", { name: "Unstar " + removed.title, exact: true })
    ).toBeEnabled();
    personal = await loadPersonal();
    mark(
        "stars add/remove/re-add through authenticated CAS with full V0 IDs and exact source versions"
    );
    stage = "required-context-diagnostics";
    await expect(
        personalRegion.getByText("Required context needs attention before generation.", {
            exact: true,
        })
    ).toBeVisible();
    expect(personal.ready).toBe(false);
    await expect(generation).toBeDisabled();
    await shot(
        "04-required-context-blocked.png",
        personalRegion.getByRole("region", { name: "Required source coverage" })
    );
    mark(
        "required company review failure remains explicit; personal selections never promote approval"
    );
    stage = "scope-and-revision-guards";
    const currentRevision = personal.state.revision;
    const stale = await api.patch(path, {
        headers: { origin: target.origin },
        data: {
            operation: "roles",
            roleIds: personal.roles.roleIds,
            primaryRoleId: personal.roles.primaryRoleId,
            expectedRevision: currentRevision - 1,
        },
    });
    expect(stale.status()).toBe(409);
    const unknown = await api.patch(path, {
        headers: { origin: target.origin },
        data: {
            operation: "star",
            documentId: "workspace-document/999999999",
            starred: true,
            expectedRevision: currentRevision,
        },
    });
    expect([403, 404]).toContain(unknown.status());
    const forged = await api.patch(path, {
        headers: { origin: target.origin },
        data: {
            operation: "roles",
            roleIds: [],
            expectedRevision: currentRevision,
            companyId: "foreign-company",
        },
    });
    expect(forged.status()).toBe(400);
    expect((await loadPersonal()).state).toEqual(personal.state);
    mark(
        `stale revision409, unknown source${unknown.status()} and client company selector400 rejected without personal-state change`
    );
    stage = "guarded-generation";
    const preflight = await api.post("/api/vantage/demo/preflight", {
        headers: { origin: target.origin },
        data: { weekStart: week },
    });
    const preflightBody = await preflight.json();
    expect([200, 409]).toContain(preflight.status());
    expect(preflightBody.ready ?? false).toBe(false);
    const generated = await api.post("/api/vantage/demo", {
        headers: { origin: target.origin },
        data: { weekStart: week },
    });
    expect(generated.status()).toBe(409);
    const afterBlockedResponse = await api.get("/api/vantage/demo");
    expect(afterBlockedResponse.status()).toBe(200);
    const afterBlocked = await afterBlockedResponse.json();
    expect(afterBlocked.report).toEqual(state.report);
    await artifact("generation-guards.json", {
        preflight: { status: preflight.status(), body: preflightBody },
        generation: { status: generated.status() },
        previousReportUnchanged: true,
    });
    mark("preflight not ready and direct generation409; original saved report unchanged");
    stage = "exact-saved-citation";
    const topic = state.report.topics.find(topic =>
        topic.facts.some(fact => fact.refs.some(ref => ref.kind === "doc"))
    );
    const ref = topic.facts.flatMap(fact => fact.refs).find(ref => ref.kind === "doc");
    const identity = ref.kind + ":" + ref.id + "@" + ref.version;
    const article = page.getByRole("article", { name: topic.title, exact: true });
    await article.getByTitle(identity, { exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Exact version " + ref.version, { exact: true })).toBeVisible();
    await expect(dialog.getByText(identity, { exact: true })).toBeVisible();
    await shot("05-preserved-exact-citation.png", dialog);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    mark("saved stable report exact authorized citations still open independently");
    stage = "browser-reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    const refreshed = await loadPersonal();
    expect(refreshed.state).toEqual(personal.state);
    expect(refreshed.roles).toEqual(personal.roles);
    await personalRegion.locator("summary").first().click();
    await expect(
        personalRegion.getByRole("button", { name: /Primary perspective.*Engineering/ })
    ).toBeVisible();
    for (const doc of choices)
        await expect(
            personalRegion.getByRole("button", { name: "Unstar " + doc.title, exact: true })
        ).toBeVisible();
    await shot(
        "06-refresh-retains-process-state.png",
        personalRegion.getByRole("region", { name: "Business responsibilities" })
    );
    mark(
        "browser reload retains choices in the same server process without claiming restart durability"
    );
    stage = "mobile";
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
        personalRegion.getByRole("checkbox", { name: "Engineering", exact: true })
    ).toBeVisible();
    await personalRegion
        .getByRole("checkbox", { name: "Engineering", exact: true })
        .scrollIntoViewIfNeeded();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    ).toBe(false);
    await shot("07-mobile-personal-context.png");
    await personalRegion.locator("summary").first().click();
    const summary = page.getByRole("region", { name: "Saved contextual weekly summary" });
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toContainText(state.report.summary);
    await shot("08-mobile-preserved-report.png");
    mark(
        "desktop/mobile remain usable while generation stays blocked and prior report remains visible"
    );
    await artifact("personal-after.json", personal);
    result.passed = true;
} catch (error) {
    result.passed = false;
    result.failedStage = stage;
    let message = error instanceof Error ? error.message : "Unknown smoke failure";
    for (const value of Object.values(credentials))
        if (typeof value === "string" && value.length > 7)
            message = message.split(value).join("[REDACTED]");
    await artifact("failure.json", { stage, message: message.slice(0, 12000) });
    if (page)
        await page
            .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
            .catch(() => undefined);
    process.exitCode = 1;
} finally {
    await browser?.close();
    await api?.dispose();
    result.completedAt = new Date().toISOString();
    await artifact("results.json", result);
    console.log(
        JSON.stringify({
            passed: result.passed,
            checks: result.checks,
            failedStage: result.failedStage,
            artifacts: relative(root, output),
            headless: true,
            liveProviderCalled: false,
        })
    );
}
