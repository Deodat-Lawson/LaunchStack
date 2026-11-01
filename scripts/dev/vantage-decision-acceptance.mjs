#!/usr/bin/env node
/** Local-only, in-memory-auth browser acceptance for Vantage decision preparation. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireWeb = createRequire(join(ROOT, "apps/web/package.json"));
const { chromium } = requireWeb("@playwright/test");
const phase = process.argv.includes("--before") ? "before" : "after";
const geometryOnly = process.argv.includes("--mobile-geometry");
const pointerOnly = process.argv.includes("--mobile-pointer");
const port = phase === "before" ? "3104" : "3111";
const BASE = `http://localhost:${port}`;
const credentialPath =
    phase === "before"
        ? "C:/Users/junku/orca/LaunchStack/test-output/vantage-frontend-mvp/20261026161746Z/source/test-output/vantage-context-demo/runtime/credentials.json"
        : join(ROOT, "test-output/vantage-context-demo/runtime/credentials.json");
const output = join(
    ROOT,
    "test-output/vantage-decision-preparation",
    pointerOnly ? "mobile-pointer" : geometryOnly ? "mobile-geometry" : phase
);
mkdirSync(output, { recursive: true });
const result = { phase, base: BASE, checks: [], captures: [], api: [], blocked: [], errors: [] };
let credential, browser, context, page, nativeActual, nativeUrl;
function redact(value) {
    let text = String(value);
    for (const secret of [credential?.loginEmail, credential?.loginPassword])
        if (secret) text = text.split(secret).join("[redacted]");
    return text;
}
function assert(ok, message) {
    if (!ok) throw new Error(message);
}
async function check(name, fn) {
    try {
        const details = await fn();
        result.checks.push({
            name,
            status: "passed",
            ...(details === undefined ? {} : { details }),
        });
        process.stdout.write(`PASS ${name}\n`);
        return true;
    } catch (error) {
        result.checks.push({ name, status: "failed", error: redact(error?.message ?? error) });
        process.stdout.write(`FAIL ${name}: ${redact(error?.message ?? error)}\n`);
        return false;
    }
}
async function capture(name) {
    const text = await page.locator("body").innerText();
    assert(
        ![credential?.loginEmail, credential?.loginPassword]
            .filter(Boolean)
            .some(s => text.includes(s)),
        "Credential visible; capture withheld."
    );
    await page.screenshot({ path: join(output, `${name}.png`), scale: "css", caret: "initial" });
    result.captures.push(`${name}.png`);
}
try {
    credential = JSON.parse(readFileSync(credentialPath, "utf8"));
    assert(credential.loginEmail && credential.loginPassword, "Synthetic credentials missing.");
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
    });
    await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const local =
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname) &&
            url.port === port;
        if (!local || !["GET", "HEAD"].includes(request.method())) {
            result.blocked.push({
                method: request.method(),
                origin: url.origin,
                pathname: url.pathname,
            });
            return route.abort("blockedbyclient");
        }
        await route.continue();
    });
    await context.routeWebSocket("**/*", async socket => {
        const url = new URL(socket.url());
        if (
            url.protocol !== "ws:" ||
            !["localhost", "127.0.0.1"].includes(url.hostname) ||
            url.port !== port
        )
            return socket.close();
        socket.connectToServer();
    });
    context.on("response", response => {
        const u = new URL(response.url());
        if (u.pathname.startsWith("/api/"))
            result.api.push({
                method: response.request().method(),
                pathname: u.pathname,
                status: response.status(),
            });
    });
    page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => result.errors.push(redact(error.message)));
    const auth = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
        data: {
            email: credential.loginEmail,
            password: credential.loginPassword,
            rememberMe: true,
        },
        timeout: 60000,
    });
    assert(auth.ok(), `Synthetic sign-in returned HTTP ${auth.status()}.`);
    result.checks.push({ name: "isolated synthetic sign-in", status: "passed" });
    await page.goto(`${BASE}/dev/vantage-context`, { waitUntil: "domcontentloaded" });
    await page
        .getByRole("region", { name: "Saved contextual weekly summary" })
        .waitFor({ timeout: 60000 });
    await check("contextual saved report loaded", async () => {
        const region = page.getByRole("region", { name: "Saved contextual weekly summary" });
        assert(await region.isVisible(), "Saved report not visible.");
    });
    if (phase === "after") await page.waitForTimeout(1500);
    await capture(`${phase}-context-overview-desktop`);
    const topics = page.getByRole("region", { name: "Contextual discussion topics" });
    if (await topics.count()) {
        await topics.scrollIntoViewIfNeeded();
        await capture(`${phase}-context-list-desktop`);
        result.contextTopics = redact(await topics.innerText());
        result.topicButtons = await topics.getByRole("button").allTextContents();
    } else {
        const el = page.locator('[aria-label="Contextual discussion topics"]');
        if (await el.count()) {
            await el.scrollIntoViewIfNeeded();
            await capture(`${phase}-context-list-desktop`);
            result.contextTopics = redact(await el.innerText());
            result.topicButtons = await el.getByRole("button").allTextContents();
        }
    }
    if (phase === "before") {
        await check("baseline existing exact-source drawer", async () => {
            const source = page
                .locator('[aria-label="Contextual discussion topics"]')
                .getByRole("button", { name: /Workspace document 1120/ })
                .first();
            await source.click();
            const dialog = page.getByRole("dialog").last();
            await dialog.waitFor({ state: "visible" });
            await capture("before-context-source-desktop");
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
        });
        await check("baseline Company Architecture drawer", async () => {
            await page.getByRole("button", { name: "Inspect Company Architecture" }).click();
            const dialog = page.getByRole("dialog").last();
            await dialog.waitFor({ state: "visible" });
            await capture("before-architecture-desktop");
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
        });
    }
    if (phase === "after" && !geometryOnly && !pointerOnly) {
        await check("context topic sheet and real exact source", async () => {
            const row = page.locator('[aria-label="Contextual discussion topics"] article').first();
            await row.getByRole("button").click();
            const sheet = page.getByRole("dialog").last();
            await sheet.waitFor({ state: "visible" });
            result.contextSheetSnapshot = redact(await sheet.innerText());
            await capture("after-context-sheet-desktop");
            await sheet
                .locator("summary")
                .filter({ hasText: /^Evidence/ })
                .click();
            const source = sheet
                .getByRole("group", { name: "Supporting sources" })
                .getByRole("button")
                .first();
            const sourceRead = page.waitForResponse(
                r =>
                    new URL(r.url()).pathname === "/api/vantage/demo/source" &&
                    r.request().method() === "GET",
                { timeout: 30000 }
            );
            await source.click();
            const response = await sourceRead;
            assert(response.ok(), `Exact source HTTP ${response.status()}.`);
            const sourceDialog = page.getByRole("dialog").last();
            await sourceDialog
                .getByText(/Exact version/)
                .first()
                .waitFor();
            result.contextSourceSnapshot = redact(await sourceDialog.innerText());
            const sourceUrl = new URL(response.url());
            result.contextSourceRead = {
                method: "GET",
                status: response.status(),
                kind: sourceUrl.searchParams.get("kind"),
                id: sourceUrl.searchParams.get("id"),
                version: sourceUrl.searchParams.get("version"),
            };
            await capture("after-context-source-desktop");
            await page.keyboard.press("Escape");
            await page.waitForFunction(
                () => document.querySelectorAll('[role="dialog"]').length === 1
            );
            await page.keyboard.press("Escape");
            await page.waitForFunction(
                () => document.querySelectorAll('[role="dialog"]').length === 0
            );
        });
        await check("context company architecture detail", async () => {
            await page.locator('[aria-label="Available Company Architecture"] summary').click();
            await page.getByRole("button", { name: "Inspect Company Architecture" }).click();
            const dialog = page.getByRole("dialog").last();
            await dialog
                .getByText(/Exact version/)
                .first()
                .waitFor();
            result.architectureSnapshot = redact(await dialog.innerText());
            await capture("after-architecture-desktop");
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
        });
        await check("native saved report initial inspection", async () => {
            const nativeResponse = page.waitForResponse(
                r =>
                    new URL(r.url()).pathname === "/api/vantage/agendas" &&
                    r.request().method() === "GET" &&
                    r.ok(),
                { timeout: 30000 }
            );
            nativeResponse.catch(() => {});
            await page.getByRole("link", { name: "Open native Weekly Review" }).click();
            const response = await nativeResponse;
            const data = await response.json();
            nativeActual = data;
            nativeUrl = page.url();
            assert(
                data.agenda && data.agenda.execution?.mode === "rules",
                "Saved Rules report was not returned."
            );
            assert(
                data.agenda.topics.length > 0 &&
                    data.agenda.topics.every(t => t.origin === "rules"),
                "Saved Rules topic origins are missing."
            );
            result.nativeData = {
                week: data.week,
                hasAgenda: !!data.agenda,
                agenda: data.agenda
                    ? {
                          id: data.agenda.id,
                          execution: data.agenda.execution,
                          version: data.agenda.version,
                          topics: data.agenda.topics.map(t => ({
                              id: t.id,
                              title: t.title,
                              origin: t.origin,
                              status: t.status,
                              contentVersion: t.contentVersion,
                              factCount: t.facts.length,
                              refs: t.facts.flatMap(f => f.refs),
                              commitmentId: t.commitmentId,
                          })),
                      }
                    : null,
            };
            await page.waitForTimeout(1500);
            result.nativeSnapshot = redact(await page.locator("body").innerText());
            const rows = page.locator('button[aria-haspopup="dialog"]');
            result.nativeRowLabels = await rows.allTextContents();
            if (await rows.count()) {
                await rows.first().scrollIntoViewIfNeeded();
                await capture("after-native-list-desktop");
                await rows.first().click();
                const dialog = page.getByRole("dialog").last();
                await dialog.waitFor({ state: "visible" });
                result.nativeSheetSnapshot = redact(await dialog.innerText());
                await capture("after-native-sheet-desktop");
            }
        });
    }
    if (phase === "after" && !geometryOnly && !pointerOnly && nativeActual?.agenda) {
        const nativeTopics = nativeActual.agenda.topics;
        async function closeAll() {
            while (await page.getByRole("dialog").count()) {
                await page.keyboard.press("Escape");
                await page.waitForTimeout(250);
            }
        }
        async function contextHome() {
            await page.goto(`${BASE}/dev/vantage-context`, { waitUntil: "domcontentloaded" });
            await page
                .getByRole("region", { name: "Saved contextual weekly summary" })
                .waitFor({ timeout: 30000 });
            await page
                .locator('[aria-label="Contextual discussion topics"] article')
                .first()
                .waitFor();
        }
        async function nativeHome() {
            await contextHome();
            await page.getByRole("link", { name: "Open native Weekly Review" }).click();
            await page.getByText("The week at a glance").waitFor({ timeout: 30000 });
            await page.locator('button[aria-haspopup="dialog"]').first().waitFor();
        }
        async function contextSheet() {
            const opener = page
                .locator('[aria-label="Contextual discussion topics"] article')
                .first()
                .getByRole("button");
            await opener.click();
            const sheet = page.getByRole("dialog").first();
            await sheet.waitFor({ state: "visible" });
            return { opener, sheet };
        }
        async function nativeSheet() {
            const opener = page.locator('button[aria-haspopup="dialog"]').first();
            await opener.click();
            const sheet = page.getByRole("dialog").first();
            await sheet.waitFor({ state: "visible" });
            return { opener, sheet };
        }
        await check(
            "native V1 citation opens its real evidence GET and preserves sheet stack",
            async () => {
                const opener = page.locator('button[aria-haspopup="dialog"]').first();
                const sheet = page.getByRole("dialog").first();
                await sheet
                    .locator("summary")
                    .filter({ hasText: /^Evidence$/ })
                    .click();
                const citation = nativeTopics[0].facts.flatMap(f => f.refs)[0];
                assert(
                    citation?.ref?.startsWith("ev:"),
                    "Saved native evidence reference is absent."
                );
                const button = sheet
                    .getByRole("button", { name: new RegExp(citation.label) })
                    .first();
                const [response] = await Promise.all([
                    page.waitForResponse(
                        r =>
                            new URL(r.url()).pathname ===
                                `/api/vantage/evidence/${citation.ref.slice(3)}` &&
                            r.request().method() === "GET",
                        { timeout: 15000 }
                    ),
                    button.click(),
                ]);
                assert(response.ok(), `Evidence GET returned ${response.status()}.`);
                const source = page.getByRole("dialog").last();
                await source.getByRole("heading", { name: citation.label }).waitFor();
                await capture("after-native-source-desktop");
                await page.keyboard.press("Escape");
                await page.waitForFunction(
                    () => document.querySelectorAll('[role="dialog"]').length === 1
                );
                assert(await sheet.isVisible(), "Closing native source also closed the sheet.");
                await page.keyboard.press("Escape");
                await page.waitForFunction(
                    () => document.querySelectorAll('[role="dialog"]').length === 0
                );
                await page.waitForFunction(
                    el => el === document.activeElement,
                    await opener.elementHandle()
                );
                return {
                    sourceKind: "V1 ev reference",
                    status: response.status(),
                    stack: "source -> sheet -> invoking row",
                };
            }
        );
        await check("native actual linked-action presence is truthful", async () => {
            const linked = nativeTopics.filter(t => t.commitmentId);
            if (!linked.length)
                return {
                    linkedActions: 0,
                    note: "No linked action exists in this saved report; positive link behavior is not exercised.",
                };
            const index = nativeTopics.findIndex(t => t.commitmentId);
            await page.locator('button[aria-haspopup="dialog"]').nth(index).click();
            const dialog = page.getByRole("dialog").first();
            assert(
                await dialog.getByRole("button", { name: "View linked action" }).isVisible(),
                "Existing linked action is absent from its sheet."
            );
            await closeAll();
            return { linkedActions: linked.length };
        });
        await check("native saved Rules rows and summary are compact until opened", async () => {
            await nativeHome();
            const rows = page.locator('button[aria-haspopup="dialog"]');
            assert(
                (await rows.count()) === nativeTopics.length,
                "Native rows differ from the actual saved report."
            );
            for (let index = 0; index < nativeTopics.length; index++) {
                const text = await rows.nth(index).innerText();
                assert(
                    text.includes(nativeTopics[index].title) &&
                        text.includes("Rules suggestion") &&
                        text.includes(nativeTopics[index].status),
                    "Native title, origin, or status missing."
                );
                for (const fact of nativeTopics[index].facts)
                    assert(!text.includes(fact.text), "Native fact leaked into compact row.");
            }
            const summary = page.getByRole("region", { name: "Report summary" });
            const disclosure = summary.locator("details");
            assert(
                !(await disclosure.evaluate(el => el.open)),
                "Full native summary opened by default."
            );
            const heights = await rows.evaluateAll(els =>
                els.map(el => el.getBoundingClientRect().height)
            );
            assert(
                heights.every(height => height <= 100),
                `Native row too tall: ${heights.join(", ")}`
            );
            return {
                count: nativeTopics.length,
                heights,
                origin: "Rules",
                fullSummary: "collapsed",
            };
        });
        await check(
            "actual context rows contain title and metadata without issue, facts, or citations",
            async () => {
                await contextHome();
                const actualResponse = await context.request.get(`${BASE}/api/vantage/demo`);
                assert(actualResponse.ok(), "Real context state GET failed.");
                const actual = await actualResponse.json();
                const rows = page.locator('[aria-label="Contextual discussion topics"] article');
                assert(
                    (await rows.count()) ===
                        actual.report.topics.filter(t => t.status !== "dismissed").length,
                    "Topic count differs from saved report."
                );
                const rowText = await rows.allTextContents();
                for (const topic of actual.report.topics.filter(t => t.status !== "dismissed")) {
                    for (const fact of topic.facts)
                        assert(
                            !rowText.some(text => text.includes(fact.text)),
                            "A source fact leaked into a compact row."
                        );
                }
                assert(
                    (await rows.locator("summary, p, a").count()) === 0,
                    "Compact row contains detail sections or citations."
                );
                const heights = await rows.evaluateAll(els =>
                    els.map(el => el.getBoundingClientRect().height)
                );
                assert(
                    heights.every(height => height <= 85),
                    `Rows exceed compact desktop height: ${heights.join(", ")}`
                );
                assert(
                    await page.getByText(/Synthetic recorded replay.*no fresh AI call/).isVisible(),
                    "Synthetic replay disclosure missing."
                );
                return { heights, count: rowText.length, source: "real saved context GET" };
            }
        );
        await check(
            "context sheet keeps reported issue, interpretation and evidence separate",
            async () => {
                const { opener, sheet } = await contextSheet();
                const issueHeading = sheet.getByRole("heading", { name: /^Issue/ });
                assert(await issueHeading.isVisible(), "Issue heading missing.");
                assert(
                    (await issueHeading.innerText()).includes("source reports") &&
                        !(await issueHeading.innerText()).includes("?"),
                    "Issue source label or separator incorrect."
                );
                assert(
                    await sheet.getByRole("heading", { name: /Why this matters/ }).isVisible(),
                    "Interpretation heading missing."
                );
                assert(
                    await sheet.getByRole("heading", { name: "Key decision" }).isVisible(),
                    "Key decision missing."
                );
                const evidence = sheet.locator("summary").filter({ hasText: /^Evidence/ });
                assert(
                    !(await evidence.locator("xpath=..").evaluate(el => el.open)),
                    "Evidence opened by default."
                );
                await evidence.click();
                const source = sheet
                    .getByRole("group", { name: "Supporting sources" })
                    .getByRole("button")
                    .nth(1);
                const [response] = await Promise.all([
                    page.waitForResponse(
                        r =>
                            new URL(r.url()).pathname === "/api/vantage/demo/source" &&
                            r.request().method() === "GET",
                        { timeout: 15000 }
                    ),
                    source.click(),
                ]);
                assert(response.ok(), `Second exact source GET returned ${response.status()}.`);
                const requested = new URL(response.url()).searchParams.get("version");
                const detail = page.getByRole("dialog").last();
                await detail.getByText(`Exact version ${requested}`, { exact: true }).waitFor();
                await page.keyboard.press("Escape");
                await page.waitForFunction(
                    () => document.querySelectorAll('[role="dialog"]').length === 1
                );
                assert(
                    await sheet.isVisible(),
                    "Closing context source also closed the topic sheet."
                );
                await page.keyboard.press("Escape");
                await page.waitForFunction(
                    () => document.querySelectorAll('[role="dialog"]').length === 0
                );
                await page.waitForFunction(
                    el => el === document.activeElement,
                    await opener.elementHandle()
                );
                return {
                    realSourceStatus: response.status(),
                    version: requested,
                    stack: "source -> sheet -> invoking row",
                };
            }
        );
        await check(
            "company architecture disclosure exposes full unreviewed facts and exact version",
            async () => {
                await contextHome();
                const summary = page.locator(
                    '[aria-label="Available Company Architecture"] summary'
                );
                assert(
                    (await summary.innerText()).includes("unreviewed"),
                    "Unreviewed state missing from compact disclosure."
                );
                assert(
                    !(await summary.locator("xpath=..").evaluate(el => el.open)),
                    "Company Architecture should start collapsed."
                );
                await summary.click();
                const [response] = await Promise.all([
                    page.waitForResponse(
                        r =>
                            new URL(r.url()).pathname === "/api/vantage/demo/source" &&
                            new URL(r.url()).searchParams.get("kind") === "company",
                        { timeout: 15000 }
                    ),
                    page.getByRole("button", { name: "Inspect Company Architecture" }).click(),
                ]);
                assert(response.ok(), `Company exact source GET returned ${response.status()}.`);
                const version = new URL(response.url()).searchParams.get("version");
                const dialog = page.getByRole("dialog").last();
                await dialog.getByText(`Exact version ${version}`, { exact: true }).waitFor();
                const text = await dialog.innerText();
                for (const fact of [
                    "Privacy review",
                    "Decision authority",
                    "Process and dependencies",
                    "Teams and responsibilities",
                    "Explicit unknowns",
                ])
                    assert(text.includes(fact), `Company fact missing: ${fact}`);
                assert(text.includes("unreviewed"), "Open source lost unreviewed status.");
                await closeAll();
                return {
                    realSourceStatus: response.status(),
                    version,
                    facts: "full authorized projection displayed",
                };
            }
        );
        result.matrix = [];
        for (const surface of ["context", "native"]) {
            for (const size of [
                { name: "desktop", width: 1440, height: 900 },
                { name: "mobile", width: 390, height: 844 },
            ]) {
                for (const theme of ["light", "dark"]) {
                    await check(
                        `${surface} ${size.name} ${theme} layout and keyboard`,
                        async () => {
                            await page.setViewportSize({ width: size.width, height: size.height });
                            await page.evaluate(
                                value => localStorage.setItem("theme", value),
                                theme
                            );
                            if (surface === "context") await contextHome();
                            else await nativeHome();
                            await page.waitForFunction(
                                value =>
                                    document.documentElement.getAttribute("data-theme") === value,
                                theme
                            );
                            const rows =
                                surface === "context"
                                    ? page.locator(
                                          '[aria-label="Contextual discussion topics"] article'
                                      )
                                    : page.locator('button[aria-haspopup="dialog"]');
                            const opener =
                                surface === "context"
                                    ? rows.first().getByRole("button")
                                    : rows.first();
                            await opener.scrollIntoViewIfNeeded();
                            await page.waitForTimeout(300);
                            const overflow = await page.evaluate(
                                () =>
                                    Math.max(
                                        document.documentElement.scrollWidth,
                                        document.body.scrollWidth
                                    ) - innerWidth
                            );
                            assert(overflow <= 1, `Horizontal overflow ${overflow}px.`);
                            await capture(`${surface}-${size.name}-${theme}-list`);
                            await opener.focus();
                            await page.keyboard.press("Enter");
                            const sheet = page.getByRole("dialog").first();
                            await sheet.waitFor({ state: "visible" });
                            assert(
                                await sheet.evaluate(el => el.contains(document.activeElement)),
                                "Focus did not enter sheet."
                            );
                            if (surface === "context") {
                                const footer = await sheet.locator("footer").boundingBox();
                                assert(
                                    footer &&
                                        footer.y >= 0 &&
                                        footer.y + footer.height <= size.height + 1,
                                    "Context review controls extend beyond the visible viewport."
                                );
                            }
                            await capture(`${surface}-${size.name}-${theme}-sheet`);
                            await page.keyboard.press("Escape");
                            await page.waitForFunction(
                                () => document.querySelectorAll('[role="dialog"]').length === 0
                            );
                            await page.waitForFunction(
                                el => el === document.activeElement,
                                await opener.elementHandle()
                            );
                            result.matrix.push({ surface, size: size.name, theme, overflow });
                            return { overflow, focus: "Enter -> sheet; Escape -> invoking row" };
                        }
                    );
                }
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(() => localStorage.setItem("theme", "dark"));
        result.doubled = [];
        await check(
            "context Keep, Dismiss, and Record decision payloads use intercepted responses",
            async () => {
                let state;
                const handler = async route => {
                    if (route.request().method() !== "PATCH") return route.fallback();
                    const payload = route.request().postDataJSON();
                    const next = structuredClone(state);
                    const topic = next.report.topics.find(t => t.id === payload.topicId);
                    if (!topic)
                        return route.fulfill({
                            status: 500,
                            json: { error: "Fixture topic absent" },
                        });
                    if (payload.status) topic.status = payload.status;
                    if (payload.decision)
                        topic.decision = {
                            ...payload.decision,
                            recordedAt: "2026-10-29T00:00:00.000Z",
                        };
                    next.report.version += 1;
                    result.doubled.push({
                        surface: "context",
                        method: "PATCH",
                        pathname: "/api/vantage/demo/topics",
                        payload,
                        delivery: "fixture response; not sent to server",
                    });
                    await route.fulfill({ status: 200, json: next });
                };
                await page.route(`${BASE}/api/vantage/demo/topics`, handler);
                try {
                    for (const action of ["keep", "dismiss", "decision"]) {
                        const [response] = await Promise.all([
                            page.waitForResponse(
                                r =>
                                    new URL(r.url()).pathname === "/api/vantage/demo" &&
                                    r.request().method() === "GET" &&
                                    r.ok(),
                                { timeout: 30000 }
                            ),
                            page.goto(`${BASE}/dev/vantage-context`, {
                                waitUntil: "domcontentloaded",
                            }),
                        ]);
                        state = await response.json();
                        const { sheet } = await contextSheet();
                        if (action === "keep")
                            await sheet.getByRole("button", { name: "Keep", exact: true }).click();
                        else if (action === "dismiss")
                            await sheet
                                .getByRole("button", { name: "Dismiss", exact: true })
                                .click();
                        else {
                            await sheet.getByRole("button", { name: "Record decision" }).click();
                            const decision = page.getByRole("dialog").last();
                            await decision
                                .getByRole("textbox", { name: "Decision note (optional)" })
                                .fill("Synthetic response-double note");
                            await decision.getByRole("button", { name: "Save decision" }).click();
                        }
                        await page
                            .getByText("Review saved. No action or commitment was created.")
                            .waitFor();
                        const sent = result.doubled.at(-1)?.payload;
                        assert(
                            sent?.reportId === state.report.id &&
                                sent?.topicId === state.report.topics[0].id &&
                                sent?.expectedVersion === state.report.version,
                            `${action}: incorrect report, topic, or version.`
                        );
                        if (action === "keep") {
                            assert(sent.status === "kept", "Keep payload incorrect.");
                            assert(
                                await sheet
                                    .getByRole("button", { name: "Kept", exact: true })
                                    .isDisabled(),
                                "Kept state was not displayed."
                            );
                        }
                        if (action === "dismiss") {
                            assert(sent.status === "dismissed", "Dismiss payload incorrect.");
                            assert(
                                (await page
                                    .locator('[aria-label="Contextual discussion topics"] article')
                                    .count()) === 1,
                                "Dismissed row remained in the review queue."
                            );
                        }
                        if (action === "decision") {
                            assert(
                                sent.decision?.value === "needs-more-evidence" &&
                                    sent.decision?.text === "Synthetic response-double note",
                                "Decision payload incorrect."
                            );
                            assert(
                                await sheet
                                    .getByRole("heading", { name: "Your recorded decision" })
                                    .isVisible(),
                                "Recorded decision was not displayed."
                            );
                        }
                    }
                } finally {
                    await page.unroute(`${BASE}/api/vantage/demo/topics`, handler);
                }
                return {
                    count: 3,
                    delivery: "intercepted PATCH responses; no review write reached server",
                };
            }
        );
        await check(
            "native Keep, Dismiss, and Record decision payloads use intercepted read/write fixtures",
            async () => {
                let fixture;
                const handler = async route => {
                    const request = route.request(),
                        url = new URL(request.url());
                    if (
                        request.method() === "GET" &&
                        url.pathname === "/api/vantage/agendas" &&
                        url.searchParams.get("week") === nativeActual.week
                    )
                        return route.fulfill({ status: 200, json: fixture });
                    const match = url.pathname.match(
                        /^\/api\/vantage\/topics\/([^/]+)(\/decide)?$/
                    );
                    if (!match || !["PATCH", "POST"].includes(request.method()))
                        return route.fallback();
                    const topic = fixture.agenda.topics.find(
                        t => t.id === decodeURIComponent(match[1])
                    );
                    if (!topic)
                        return route.fulfill({
                            status: 500,
                            json: { error: "Fixture topic absent" },
                        });
                    const payload = request.postDataJSON();
                    result.doubled.push({
                        surface: "native",
                        method: request.method(),
                        pathname: match[2]
                            ? "/api/vantage/topics/:id/decide"
                            : "/api/vantage/topics/:id",
                        payload,
                        delivery: "fixture response; not sent to server",
                    });
                    if (match[2]) {
                        topic.decision = payload.decision;
                        topic.decidedAt = "2026-10-29T00:00:00.000Z";
                    } else topic.status = payload.status;
                    topic.contentVersion += 1;
                    fixture.agenda.version += 1;
                    return route.fulfill({ status: 200, json: { topic } });
                };
                await page.route("**/api/vantage/**", handler);
                try {
                    for (const action of ["keep", "dismiss", "decision"]) {
                        fixture = structuredClone(nativeActual);
                        await nativeHome();
                        const { sheet } = await nativeSheet();
                        if (action === "keep")
                            await sheet.getByRole("button", { name: "Keep topic" }).click();
                        else if (action === "dismiss")
                            await sheet.getByRole("button", { name: "Dismiss topic" }).click();
                        else {
                            await sheet.getByRole("button", { name: "Record decision" }).click();
                            const decision = page.getByRole("dialog").last();
                            await decision
                                .getByRole("textbox", { name: "What was decided" })
                                .fill("Synthetic decision for response double");
                            await decision.getByRole("switch", { name: "Create action" }).click();
                            await decision
                                .getByRole("button", { name: "Save Decision", exact: true })
                                .click();
                        }
                        if (action === "keep")
                            await page.getByText("Topic kept on the agenda.").waitFor();
                        else if (action === "dismiss")
                            await page.getByText("Topic dismissed and preserved.").waitFor();
                        else await sheet.getByRole("button", { name: "Edit decision" }).waitFor();
                        const sent = result.doubled.at(-1);
                        assert(
                            sent?.surface === "native",
                            `${action}: no native intercepted request.`
                        );
                        if (action === "keep" || action === "dismiss")
                            assert(
                                sent.method === "PATCH" &&
                                    sent.payload.status ===
                                        (action === "keep" ? "kept" : "dismissed") &&
                                    sent.payload.expectedContentVersion ===
                                        nativeTopics[0].contentVersion,
                                `${action}: incorrect native status or version.`
                            );
                        else
                            assert(
                                sent.method === "POST" &&
                                    sent.payload.decision ===
                                        "Synthetic decision for response double" &&
                                    sent.payload.commitment === null,
                                "Native decision payload incorrect."
                            );
                    }
                } finally {
                    await page.unroute("**/api/vantage/**", handler);
                }
                return {
                    count: 3,
                    delivery:
                        "intercepted topic writes and selected-week readback; no review write reached server",
                };
            }
        );
        await check("simulated source 409 withholds contextual report", async () => {
            await contextHome();
            const { sheet } = await contextSheet();
            await sheet
                .locator("summary")
                .filter({ hasText: /^Evidence/ })
                .click();
            const handler = route =>
                route.fulfill({ status: 409, json: { error: "Synthetic source changed" } });
            await page.route("**/api/vantage/demo/source?*", handler);
            try {
                await sheet
                    .getByRole("group", { name: "Supporting sources" })
                    .getByRole("button")
                    .first()
                    .click();
                await page.getByText("Contextual content is hidden", { exact: true }).waitFor();
                assert(
                    (await page
                        .locator('[aria-label="Contextual discussion topics"] article')
                        .count()) === 0,
                    "Source 409 left contextual topics visible."
                );
            } finally {
                await page.unroute("**/api/vantage/demo/source?*", handler);
            }
            return { delivery: "intercepted source GET 409; no server state changed" };
        });
        await check(
            "network guard blocked no attempted generation or external writes",
            async () => {
                assert(
                    result.blocked.length === 0,
                    `Unexpected blocked requests: ${JSON.stringify(result.blocked)}.`
                );
                assert(
                    !result.api.some(
                        r => r.method === "POST" && r.pathname === "/api/vantage/agendas"
                    ),
                    "Generation was attempted."
                );
                return { generationPosts: 0, externalOrUninterceptedWriteAttempts: 0 };
            }
        );
    }
    if (geometryOnly) {
        await check("mobile contextual sheet footer fits visible viewport", async () => {
            await page.setViewportSize({ width: 390, height: 844 });
            const opener = page
                .locator('[aria-label="Contextual discussion topics"] article')
                .first()
                .getByRole("button");
            await opener.click();
            const sheet = page.getByRole("dialog").first();
            await sheet.waitFor({ state: "visible" });
            result.mobileGeometry = await sheet.evaluate(el => {
                const sheetRect = el.getBoundingClientRect(),
                    footer = el.querySelector("footer"),
                    footerRect = footer?.getBoundingClientRect();
                return {
                    viewportHeight: innerHeight,
                    sheetTop: sheetRect.top,
                    sheetBottom: sheetRect.bottom,
                    footerTop: footerRect?.top,
                    footerBottom: footerRect?.bottom,
                    footerHeight: footerRect?.height,
                };
            });
            await capture("mobile-context-footer-geometry");
            assert(
                result.mobileGeometry.footerBottom <= result.mobileGeometry.viewportHeight + 1,
                `Footer bottom ${result.mobileGeometry.footerBottom}px exceeds viewport ${result.mobileGeometry.viewportHeight}px.`
            );
            return result.mobileGeometry;
        });
    }
    if (pointerOnly) {
        result.doubled = [];
        let state;
        const handler = async route => {
            if (route.request().method() !== "PATCH") return route.fallback();
            const payload = route.request().postDataJSON();
            const next = structuredClone(state);
            const topic = next.report.topics.find(item => item.id === payload.topicId);
            if (!topic)
                return route.fulfill({ status: 500, json: { error: "Fixture topic absent" } });
            topic.status = payload.status;
            next.report.version += 1;
            result.doubled.push({
                method: "PATCH",
                pathname: "/api/vantage/demo/topics",
                payload,
                delivery: "fixture response; not sent to server",
            });
            return route.fulfill({ status: 200, json: next });
        };
        await page.route(`${BASE}/api/vantage/demo/topics`, handler);
        try {
            for (const theme of ["light", "dark"]) {
                await check(`mobile ${theme} Keep pointer hit and intercepted click`, async () => {
                    await page.setViewportSize({ width: 390, height: 844 });
                    await page.evaluate(value => localStorage.setItem("theme", value), theme);
                    const [response] = await Promise.all([
                        page.waitForResponse(
                            r =>
                                new URL(r.url()).pathname === "/api/vantage/demo" &&
                                r.request().method() === "GET" &&
                                r.ok(),
                            { timeout: 30000 }
                        ),
                        page.goto(`${BASE}/dev/vantage-context`, { waitUntil: "domcontentloaded" }),
                    ]);
                    state = await response.json();
                    await page.waitForFunction(
                        value => document.documentElement.getAttribute("data-theme") === value,
                        theme
                    );
                    const opener = page
                        .locator('[aria-label="Contextual discussion topics"] article')
                        .first()
                        .getByRole("button");
                    await opener.click();
                    const sheet = page.getByRole("dialog").first();
                    await sheet.waitFor({ state: "visible" });
                    const keep = sheet.getByRole("button", { name: "Keep", exact: true });
                    const hit = await keep.evaluate(button => {
                        const rect = button.getBoundingClientRect();
                        const x = rect.left + rect.width / 2,
                            y = rect.top + rect.height / 2;
                        const top = document.elementFromPoint(x, y);
                        return {
                            x,
                            y,
                            bottom: rect.bottom,
                            viewportHeight: innerHeight,
                            centerHitsButton: top === button || button.contains(top),
                            topTag: top?.tagName ?? null,
                        };
                    });
                    await capture(`context-mobile-${theme}-pointer-sheet`);
                    assert(
                        hit.bottom <= hit.viewportHeight && hit.centerHitsButton,
                        `Keep center obscured or outside viewport: ${JSON.stringify(hit)}.`
                    );
                    await keep.click();
                    await page
                        .getByText("Review saved. No action or commitment was created.")
                        .waitFor();
                    assert(
                        await sheet.getByRole("button", { name: "Kept", exact: true }).isDisabled(),
                        "Kept state did not render."
                    );
                    const request = result.doubled.at(-1)?.payload;
                    assert(
                        request?.status === "kept" &&
                            request.topicId === state.report.topics[0].id &&
                            request.reportId === state.report.id &&
                            request.expectedVersion === state.report.version,
                        "Keep payload did not match the saved report and version."
                    );
                    return {
                        ...hit,
                        delivery: "ordinary Playwright click; intercepted PATCH response",
                    };
                });
            }
        } finally {
            await page.unroute(`${BASE}/api/vantage/demo/topics`, handler);
        }
        await check("mobile pointer network boundary", async () => {
            assert(result.doubled.length === 2, "Expected one intercepted Keep request per theme.");
            assert(
                result.blocked.length === 0,
                "Unexpected blocked external or unhandled write request."
            );
            assert(
                !result.api.some(r => r.method === "POST" && r.pathname === "/api/vantage/agendas"),
                "Generation was attempted."
            );
            return { interceptedWrites: result.doubled.length, generationPosts: 0, blocked: 0 };
        });
    }
    result.bodySnapshot = redact((await page.locator("body").innerText()).slice(0, 16000));
} catch (error) {
    result.errors.push(redact(error?.message ?? error));
} finally {
    if (browser) await browser.close();
    result.passed = result.errors.length === 0 && result.checks.every(c => c.status === "passed");
    writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
    process.stdout.write(
        JSON.stringify(
            {
                phase,
                output,
                passed: result.passed,
                checks: result.checks,
                captures: result.captures,
                blocked: result.blocked,
                errors: result.errors,
                topicButtons: result.topicButtons,
            },
            null,
            2
        ) + "\n"
    );
    if (!result.passed) process.exitCode = 1;
}
