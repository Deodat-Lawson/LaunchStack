#!/usr/bin/env node
/** Synthetic, headless browser review. Only local GETs and fixed synthetic sign-in may reach server. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(join(ROOT, "apps/web/package.json"))("@playwright/test");
const BASE = "http://localhost:3111";
const phase = process.argv.includes("--before")
    ? "before"
    : process.argv.includes("--probe")
      ? "probe"
      : process.argv.includes("--inspect")
        ? "inspect"
        : process.argv.includes("--quick")
          ? "quick"
          : "after";
const contextOnly = process.argv.includes("--context-action");
const actionOnly = process.argv.includes("--actions") || contextOnly;
const out = join(
    ROOT,
    "test-output/vantage-unified-review",
    contextOnly ? "context-diagnostic" : actionOnly ? "actions-diagnostic" : phase
);
mkdirSync(out, { recursive: true });
const result = {
    phase,
    base: BASE,
    checks: [],
    captures: [],
    api: [],
    doubled: [],
    blocked: [],
    errors: [],
};
let credential, browser, context, page;
function redact(value) {
    let s = String(value);
    for (const v of [credential?.loginEmail, credential?.loginPassword])
        if (v) s = s.split(v).join("[redacted]");
    return s;
}
function assert(ok, message) {
    if (!ok) throw Error(message);
}
async function check(name, fn) {
    if (
        actionOnly &&
        !(
            contextOnly
                ? /^(real saved report|fixture-only primary|real saved state|network guard)/
                : /^(real saved report|fixture-only review|fixture-only primary|fixture-only historical|real saved state|network guard)/
        ).test(name)
    ) {
        result.checks.push({ name, status: "skipped", reason: "targeted action diagnostic" });
        return true;
    }
    try {
        const details = await fn();
        result.checks.push({
            name,
            status: "passed",
            ...(details === undefined ? {} : { details }),
        });
        process.stdout.write(`PASS ${name}\n`);
        return true;
    } catch (e) {
        result.checks.push({ name, status: "failed", error: redact(e?.message ?? e) });
        process.stdout.write(`FAIL ${name}: ${redact(e?.message ?? e)}\n`);
        return false;
    }
}
async function capture(name) {
    const body = await page.locator("body").innerText();
    assert(
        ![credential?.loginEmail, credential?.loginPassword]
            .filter(Boolean)
            .some(v => body.includes(v)),
        "Credential visible; capture withheld"
    );
    await page.screenshot({ path: join(out, `${name}.png`), scale: "css", caret: "initial" });
    result.captures.push(`${name}.png`);
}
try {
    credential = JSON.parse(
        readFileSync(
            join(ROOT, "test-output/vantage-context-demo/runtime/credentials.json"),
            "utf8"
        )
    );
    assert(credential.loginEmail && credential.loginPassword, "Synthetic credentials missing");
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
    });
    await context.route("**/*", async route => {
        const req = route.request(),
            u = new URL(req.url());
        const local =
            u.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(u.hostname) &&
            u.port === "3111";
        if (!local || !["GET", "HEAD"].includes(req.method())) {
            result.blocked.push({ method: req.method(), origin: u.origin, pathname: u.pathname });
            return route.abort("blockedbyclient");
        }
        return route.continue();
    });
    await context.routeWebSocket("**/*", async socket => {
        const u = new URL(socket.url());
        if (
            u.protocol !== "ws:" ||
            !["localhost", "127.0.0.1"].includes(u.hostname) ||
            u.port !== "3111"
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
    page.on("pageerror", e => result.errors.push(redact(e.message)));
    const auth = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
        data: {
            email: credential.loginEmail,
            password: credential.loginPassword,
            rememberMe: true,
        },
        timeout: 60000,
    });
    assert(auth.ok(), `Synthetic sign-in returned HTTP ${auth.status()}`);
    result.checks.push({ name: "synthetic sign-in", status: "passed" });
    if (phase === "probe") {
        await check("read synthetic saved report and personal context", async () => {
            await page.goto(`${BASE}/dev/vantage-context`, { waitUntil: "domcontentloaded" });
            await page
                .getByRole("region", { name: "Saved contextual weekly summary" })
                .waitFor({ timeout: 60000 });
            const reads = await page.evaluate(async () => {
                const get = async path => {
                    const r = await fetch(path, { cache: "no-store" });
                    return { status: r.status, body: await r.json() };
                };
                const report = await get("/api/vantage/demo?week=2026-10-12");
                const personal = await get("/api/vantage/demo/personal?week=2026-10-12");
                const pending = await get(
                    `/api/vantage/agendas/${encodeURIComponent(report.body.nativeAgendaId)}/pending-questions`
                );
                const source = report.body.companyArchitecture.source;
                const query = new URLSearchParams({
                    reportId: report.body.report.id,
                    kind: source.kind,
                    id: source.id,
                    version: source.version,
                });
                const company = await get(`/api/vantage/demo/source?${query}`);
                return { report, personal, pending, company };
            });
            assert(
                reads.report.status === 200 && reads.personal.status === 200,
                "saved GET failed"
            );
            result.syntheticReads = JSON.parse(redact(JSON.stringify(reads)));
            return {
                reportStatus: reads.report.status,
                personalStatus: reads.personal.status,
                topicCount: reads.report.body.report?.topics?.length,
            };
        });
    }
    if (phase === "inspect") {
        await check("diagnostic current review render", async () => {
            await page.goto(`${BASE}/dev/vantage-context/review?week=2026-10-12`, {
                waitUntil: "domcontentloaded",
            });
            await page.waitForTimeout(2000);
            result.url = page.url();
            result.body = redact(await page.locator("body").innerText());
            result.controls = await page
                .locator('a,button,summary,select,[role="tab"]')
                .evaluateAll(els =>
                    els
                        .map(e => ({
                            tag: e.tagName,
                            text: (e.innerText || e.getAttribute("aria-label") || "").trim(),
                            aria: e.getAttribute("aria-label"),
                            href: e.getAttribute("href"),
                        }))
                        .filter(e => e.text || e.aria)
                );
            await capture("inspect-desktop");
            return { url: result.url, controlCount: result.controls.length };
        });
    }
    if (phase === "inspect") {
        await check("diagnostic decision drawer", async () => {
            const row = page
                .getByRole("button", { name: /Reconcile QA and Operations deletion results/ })
                .first();
            await row.click();
            const dialog = page.getByRole("dialog").last();
            await dialog.waitFor({ state: "visible" });
            result.decisionBody = redact(await dialog.innerText());
            result.decisionControls = await dialog
                .locator("button,summary,input,textarea")
                .evaluateAll(els =>
                    els.map(e => ({
                        tag: e.tagName,
                        text: (e.innerText || e.getAttribute("aria-label") || "").trim(),
                        aria: e.getAttribute("aria-label"),
                        role: e.getAttribute("role"),
                    }))
                );
            await capture("inspect-decision");
            await page.keyboard.press("Escape");
        });
        await check("diagnostic context drawer", async () => {
            await page.getByRole("button", { name: "My context" }).click();
            const dialog = page.getByRole("dialog").last();
            await dialog.waitFor({ state: "visible" });
            await dialog.getByRole("button", { name: "Save roles" }).waitFor({ timeout: 30000 });
            result.contextBody = redact(await dialog.innerText());
            result.contextControls = await dialog
                .locator("button,summary,input,select")
                .evaluateAll(els =>
                    els.map(e => ({
                        tag: e.tagName,
                        text: (e.innerText || e.getAttribute("aria-label") || "").trim(),
                        aria: e.getAttribute("aria-label"),
                        role: e.getAttribute("role"),
                    }))
                );
            await capture("inspect-context");
            await page.keyboard.press("Escape");
        });
    }
    if (phase === "after") {
        const week = "2026-10-12";
        const reviewUrl = `${BASE}/dev/vantage-context/review?week=${week}`;
        let saved, personal, pending, company;
        const list = () => page.locator('section[aria-label="Decisions to make"]');
        const rows = () => list().locator("article");
        const firstRow = () => rows().first().getByRole("button");
        async function home() {
            await page.goto(reviewUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
            await list().waitFor({ state: "visible", timeout: 60000 });
            await rows().first().waitFor({ state: "visible", timeout: 60000 });
        }
        async function closeDialogs() {
            for (let i = 0; i < 4; i++) {
                const count = await page.locator('[role="dialog"][data-state="open"]').count();
                if (!count) break;
                await page.keyboard.press("Escape");
                try {
                    await page.waitForFunction(
                        n =>
                            document.querySelectorAll('[role="dialog"][data-state="open"]').length <
                            n,
                        count,
                        { timeout: 6000 }
                    );
                } catch {
                    const info = await page.evaluate(() => ({
                        active: document.activeElement?.outerHTML?.slice(0, 600),
                        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(d => ({
                            state: d.getAttribute("data-state"),
                            text: d.innerText.slice(0, 240),
                        })),
                    }));
                    throw Error(`Escape did not close dialog: ${JSON.stringify(info)}`);
                }
            }
            await page.waitForFunction(
                () => document.querySelectorAll('[role="dialog"]').length === 0,
                null,
                { timeout: 6000 }
            );
        }
        async function waitForFocus(locator) {
            const handle = await locator.elementHandle();
            try {
                await page.waitForFunction(el => el === document.activeElement, handle, {
                    timeout: 6000,
                });
            } catch {
                const active = await page.evaluate(() => ({
                    tag: document.activeElement?.tagName,
                    outer: document.activeElement?.outerHTML?.slice(0, 400),
                }));
                throw Error(`Focus did not return to opener; active=${JSON.stringify(active)}`);
            }
        }
        async function openDecision() {
            const opener = firstRow();
            await opener.click();
            const sheet = page.getByRole("dialog").first();
            await sheet.waitFor({ state: "visible" });
            return { opener, sheet };
        }
        async function openContext() {
            const opener = page.getByRole("button", { name: /^My context/ });
            await opener.click();
            const sheet = page.getByRole("dialog").first();
            await sheet.waitFor({ state: "visible" });
            await sheet
                .getByRole("button", { name: "Save roles" })
                .waitFor({ state: "visible", timeout: 60000 });
            return { opener, sheet };
        }
        async function getJson(path) {
            return await page.evaluate(async path => {
                const r = await fetch(path, { cache: "no-store" });
                return { status: r.status, data: await r.json() };
            }, path);
        }
        await check(
            "real saved report, personal context, pending queue and company GETs",
            async () => {
                await home();
                const r = await getJson(`/api/vantage/demo?week=${week}`);
                assert(r.status === 200 && r.data.report, "Saved report GET failed");
                saved = r.data;
                const p = await getJson(`/api/vantage/demo/personal?week=${week}`);
                assert(p.status === 200, "Personal GET failed");
                personal = p.data;
                const q = await getJson(
                    `/api/vantage/agendas/${encodeURIComponent(saved.nativeAgendaId)}/pending-questions`
                );
                assert(q.status === 200, "Pending GET failed");
                pending = q.data;
                const ref = saved.companyArchitecture.source;
                const query = new URLSearchParams({
                    reportId: saved.report.id,
                    kind: ref.kind,
                    id: ref.id,
                    version: ref.version,
                });
                const c = await getJson(`/api/vantage/demo/source?${query}`);
                assert(c.status === 200, "Company source GET failed");
                company = c.data;
                result.actual = {
                    week: saved.selectedWeek,
                    reportId: saved.report.id,
                    reportVersion: saved.report.version,
                    summary: saved.report.summary,
                    topicIds: saved.report.topics.map(t => t.id),
                    personalRevision: personal.state.revision,
                    pendingVersion: pending.version,
                    pendingCount: pending.questions.length,
                    companyFacts: JSON.parse(company.body).facts.length,
                    companyReview: company.reviewState,
                };
                assert(
                    saved.selectedWeek === week && saved.report.topics.length > 0,
                    "Unexpected selected week or empty report"
                );
                return {
                    week: saved.selectedWeek,
                    topics: saved.report.topics.length,
                    pending: pending.questions.length,
                    companyFacts: result.actual.companyFacts,
                    source: "real local synthetic GETs",
                };
            }
        );
        if (saved && personal && pending && company) {
            await check("unified navigation and explicit topic filters", async () => {
                await home();
                const links = await page
                    .locator("a:visible")
                    .evaluateAll(els =>
                        els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute("href") }))
                    );
                for (const name of ["Weekly Review", "Actions", "Evidence", "Metrics"])
                    assert(
                        links.filter(l => l.text === name).length === 1,
                        `Expected one visible ${name} navigation link`
                    );
                assert(
                    !links.some(l => /Context-Aware Demo/i.test(l.text)),
                    "Separate demo navigation remains"
                );
                for (const name of ["All", "To review", "Decided", "Dismissed"])
                    assert(
                        await list()
                            .getByRole("button", { name: new RegExp(`^${name}\\s`) })
                            .isVisible(),
                        `Missing ${name} filter`
                    );
                const visible = await rows().evaluateAll(els =>
                    els.map(e => e.getAttribute("aria-label"))
                );
                assert(
                    JSON.stringify(visible) ===
                        JSON.stringify(saved.report.topics.map(t => t.title)),
                    "All filter does not expose every saved topic"
                );
                result.navigation = links;
                return {
                    visibleLinks: links.filter(l =>
                        ["Weekly Review", "Actions", "Evidence", "Metrics"].includes(l.text)
                    ),
                    topics: visible.length,
                };
            });
            await check("compact brief preserves substantive saved-report qualifiers", async () => {
                await home();
                const brief = page
                    .locator("section")
                    .filter({ hasText: /This week.s brief/i })
                    .first();
                const compact = await brief.innerText();
                const shown = compact.split(/Read full brief/i)[0];
                assert(
                    /QA/i.test(shown) && /operations/i.test(shown),
                    "Compact brief does not show both saved accounts"
                );
                assert(
                    /3\s*(?:of|\/)\s*3/i.test(shown) && /2\s*(?:of|\/)\s*3/i.test(shown),
                    "Compact brief omits reported sample counts"
                );
                assert(
                    /account.{0,80}(?:may|might|could|differ|different)/i.test(shown),
                    "Compact brief omits possible difference in account lists"
                );
                assert(
                    /approval/i.test(shown) && /(record|document|supplied)/i.test(shown),
                    "Compact brief omits that no approval is documented in the supplied record"
                );
                assert(
                    !/no approval (?:exists|has been granted)/i.test(shown),
                    "Compact brief overstates approval status"
                );
                await brief.locator("summary").click();
                const full = await brief.innerText();
                assert(
                    full.includes(saved.report.summary),
                    "Expanded brief differs from complete saved summary"
                );
                result.brief = { compact: redact(shown), fullMatchesSaved: true };
                return { source: "real saved report GET", completeSummaryMatches: true };
            });
            for (const [label, path] of [
                ["legacy context alias", `/dev/vantage-context?week=${week}`],
                ["primary review", `/dev/vantage-context/review?week=${week}`],
                ["legacy agenda", `/dev/vantage-context/agenda?week=${week}`],
            ])
                await check(
                    `${label} deeplink preserves selected week and reaches review`,
                    async () => {
                        await page.goto(BASE + path, {
                            waitUntil: "domcontentloaded",
                            timeout: 60000,
                        });
                        await list().waitFor({ state: "visible", timeout: 60000 });
                        await rows().first().waitFor({ state: "visible", timeout: 60000 });
                        const first = page.url();
                        await page.waitForTimeout(350);
                        assert(page.url() === first, "Navigation did not settle");
                        const url = new URL(page.url());
                        assert(
                            url.origin === BASE && url.searchParams.get("week") === week,
                            "Week or local origin was not preserved"
                        );
                        return { url: first };
                    }
                );
            await check("alternative Rules report remains separately accessible", async () => {
                await home();
                const link = page.getByRole("link", { name: "Alternative saved report" });
                const href = await link.getAttribute("href");
                assert(
                    href?.includes("report=rules") && href.includes(`week=${week}`),
                    "Alternative link is missing explicit Rules/week parameters"
                );
                await page.goto(BASE + href, { waitUntil: "domcontentloaded", timeout: 60000 });
                await page.getByText("The week at a glance").waitFor({ timeout: 60000 });
                const response = await getJson(`/api/vantage/agendas?week=${week}`);
                assert(
                    response.status === 200 && response.data.agenda?.execution?.mode === "rules",
                    "Rules report GET failed or mode differs"
                );
                const native = response.data.agenda.topics;
                assert(
                    native.length > 0 && native.every(t => t.origin === "rules"),
                    "Native Rules topics are absent"
                );
                const text = await page.locator("body").innerText();
                for (const t of native)
                    assert(text.includes(t.title), `Rules topic missing: ${t.title}`);
                assert(!(await list().count()), "Contextual and Rules topic lists were merged");
                return {
                    href,
                    origin: "rules",
                    topics: native.length,
                    source: "real native saved report GET",
                };
            });
            for (const size of [
                { name: "desktop", width: 1440, height: 900 },
                { name: "mobile", width: 390, height: 844 },
            ])
                for (const theme of ["light", "dark"]) {
                    await check(`${size.name} ${theme} review and drawers`, async () => {
                        await page.setViewportSize({ width: size.width, height: size.height });
                        await page.evaluate(value => localStorage.setItem("theme", value), theme);
                        await home();
                        await page.waitForFunction(
                            value => document.documentElement.getAttribute("data-theme") === value,
                            theme,
                            { timeout: 30000 }
                        );
                        const overflow = await page.evaluate(
                            () =>
                                Math.max(
                                    document.documentElement.scrollWidth,
                                    document.body.scrollWidth
                                ) - innerWidth
                        );
                        assert(overflow <= 1, `Horizontal overflow ${overflow}px`);
                        await capture(`${size.name}-${theme}-review`);
                        const { opener, sheet } = await openDecision();
                        assert(
                            await sheet.evaluate(el => el.contains(document.activeElement)),
                            "Focus did not enter decision drawer"
                        );
                        const actions = [
                            "Go",
                            "No-go",
                            "Needs more evidence",
                            "Dismiss topic",
                            "Keep for later",
                        ];
                        const hits = [];
                        for (const name of actions) {
                            const button = sheet.getByRole("button", { name, exact: true });
                            const hit = await button.evaluate(el => {
                                const r = el.getBoundingClientRect(),
                                    x = r.left + r.width / 2,
                                    y = r.top + r.height / 2,
                                    top = document.elementFromPoint(x, y);
                                return {
                                    name: el.innerText,
                                    x,
                                    y,
                                    bottom: r.bottom,
                                    viewport: innerHeight,
                                    hit: top === el || el.contains(top),
                                };
                            });
                            hits.push(hit);
                            assert(
                                hit.bottom <= hit.viewport + 1 && hit.y >= 0 && hit.hit,
                                `${name} is obscured or outside viewport: ${JSON.stringify(hit)}`
                            );
                        }
                        await capture(`${size.name}-${theme}-decision`);
                        await page.keyboard.press("Escape");
                        await sheet.waitFor({ state: "hidden" });
                        await waitForFocus(opener);
                        const opened = await openContext();
                        assert(
                            await opened.sheet.evaluate(el => el.contains(document.activeElement)),
                            "Focus did not enter context drawer"
                        );
                        const done = opened.sheet.getByRole("button", {
                            name: "Done",
                            exact: true,
                        });
                        const doneHit = await done.evaluate(el => {
                            const r = el.getBoundingClientRect(),
                                x = r.left + r.width / 2,
                                y = r.top + r.height / 2,
                                top = document.elementFromPoint(x, y);
                            return {
                                bottom: r.bottom,
                                viewport: innerHeight,
                                hit: top === el || el.contains(top),
                            };
                        });
                        assert(
                            doneHit.bottom <= doneHit.viewport + 1 && doneHit.hit,
                            "Context Done footer is obscured or outside viewport"
                        );
                        await capture(`${size.name}-${theme}-context`);
                        await page.keyboard.press("Escape");
                        await opened.sheet.waitFor({ state: "hidden" });
                        await waitForFocus(opened.opener);
                        return {
                            overflow,
                            decisionButtons: hits,
                            contextDone: doneHit,
                            focus: "drawer -> Escape -> opener",
                        };
                    });
                }
            await page.setViewportSize({ width: 1440, height: 900 });
            await check("real exact document source and nested Escape focus", async () => {
                await home();
                const { opener, sheet } = await openDecision();
                const ref = saved.report.topics[0].facts[0].refs[0];
                const doc = sheet.getByRole("button", { name: /Workspace document 16/ }).first();
                const [response] = await Promise.all([
                    page.waitForResponse(
                        r =>
                            new URL(r.url()).pathname === "/api/vantage/demo/source" &&
                            r.request().method() === "GET",
                        { timeout: 30000 }
                    ),
                    doc.click(),
                ]);
                assert(response.ok(), `Source GET HTTP ${response.status()}`);
                const source = page.getByRole("dialog").last();
                await source
                    .getByText(`Exact version ${ref.version}`, { exact: true })
                    .waitFor({ timeout: 30000 });
                await capture("desktop-document-source");
                await page.keyboard.press("Escape");
                await page.waitForFunction(
                    () =>
                        document.querySelectorAll('[role="dialog"][data-state="open"]').length ===
                        1,
                    null,
                    { timeout: 6000 }
                );
                assert(await sheet.isVisible(), "Closing source closed its decision drawer");
                await page.keyboard.press("Escape");
                await sheet.waitFor({ state: "hidden" });
                await waitForFocus(opener);
                return {
                    status: response.status(),
                    version: ref.version,
                    source: "real exact document GET",
                    stack: "source -> decision -> row",
                };
            });
            await check(
                "company profile shows all unreviewed facts from real exact source",
                async () => {
                    await home();
                    const { opener, sheet } = await openContext();
                    const profile = sheet.getByRole("region", { name: "Company profile" });
                    const profileText = await profile.innerText();
                    assert(
                        /isn.t reviewed|unreviewed/i.test(profileText) && /13/.test(profileText),
                        "Unreviewed 13-fact profile summary missing"
                    );
                    const [response] = await Promise.all([
                        page.waitForResponse(
                            r => {
                                const u = new URL(r.url());
                                return (
                                    u.pathname === "/api/vantage/demo/source" &&
                                    u.searchParams.get("kind") === "company"
                                );
                            },
                            { timeout: 30000 }
                        ),
                        sheet.getByRole("button", { name: "Inspect profile" }).click(),
                    ]);
                    assert(response.ok(), `Company source GET HTTP ${response.status()}`);
                    const data = await response.json();
                    const source = page.getByRole("dialog").last();
                    await source
                        .getByText(`Exact version ${data.source.version}`, { exact: true })
                        .waitFor({ timeout: 30000 });
                    const text = await source.innerText(),
                        facts = JSON.parse(data.body).facts;
                    assert(
                        data.reviewState === "unreviewed" && facts.length === 13,
                        "Wrong company fact count or review status"
                    );
                    for (const fact of facts)
                        assert(text.includes(fact.value), `Company value absent: ${fact.label}`);
                    assert(/unreviewed/i.test(text), "Full source lost unreviewed status");
                    await capture("desktop-company-source");
                    await page.keyboard.press("Escape");
                    await page.waitForFunction(
                        () =>
                            document.querySelectorAll('[role="dialog"][data-state="open"]')
                                .length === 1,
                        null,
                        { timeout: 6000 }
                    );
                    assert(await sheet.isVisible(), "Closing profile closed context drawer");
                    await page.keyboard.press("Escape");
                    await sheet.waitFor({ state: "hidden" });
                    await waitForFocus(opener);
                    return {
                        status: response.status(),
                        factCount: facts.length,
                        reviewState: data.reviewState,
                        source: "real exact company GET",
                    };
                }
            );
            const reviewActions = [
                ["Keep for later", "kept"],
                ["Dismiss topic", "dismissed"],
                ["Go", "go"],
                ["No-go", "no-go"],
                ["Needs more evidence", "needs-more-evidence"],
            ];
            for (const [label, value] of reviewActions)
                await check(`fixture-only review ${label}`, async () => {
                    let fixture = structuredClone(saved),
                        sent;
                    const handler = async route => {
                        const req = route.request();
                        if (req.method() !== "PATCH") return route.fallback();
                        const payload = req.postDataJSON();
                        sent = payload;
                        const topic = fixture.report.topics.find(t => t.id === payload.topicId);
                        assert(topic, "Fixture topic absent");
                        if (payload.status) topic.status = payload.status;
                        if (payload.decision)
                            topic.decision = {
                                ...payload.decision,
                                recordedAt: "2026-10-29T00:00:00.000Z",
                            };
                        fixture.report.version++;
                        result.doubled.push({
                            kind: "review",
                            method: "PATCH",
                            pathname: "/api/vantage/demo/topics",
                            payload,
                            delivery: "fixture response; not sent to server",
                        });
                        return route.fulfill({ status: 200, json: fixture });
                    };
                    const predicate = u =>
                        u.origin === BASE && u.pathname === "/api/vantage/demo/topics";
                    await page.route(predicate, handler);
                    try {
                        await home();
                        const { sheet } = await openDecision();
                        await sheet.getByRole("button", { name: label, exact: true }).click();
                        if (!["kept", "dismissed"].includes(value)) {
                            const dialog = page.getByRole("dialog").last();
                            await dialog
                                .getByRole("heading", { name: "Record your decision" })
                                .waitFor();
                            assert(
                                await dialog
                                    .getByRole("radio", { name: label, exact: true })
                                    .isChecked(),
                                `Incorrect initial choice for ${label}`
                            );
                            await dialog
                                .getByRole("textbox", { name: "Decision note (optional)" })
                                .fill("Synthetic fixture-only review");
                            await dialog.getByRole("button", { name: "Save decision" }).click();
                        }
                        await page
                            .getByText("Review saved. No action or commitment was created.")
                            .waitFor({ timeout: 30000 });
                        assert(
                            sent?.reportId === saved.report.id &&
                                sent?.topicId === saved.report.topics[0].id &&
                                sent?.expectedVersion === saved.report.version,
                            "Incorrect report/topic/version payload"
                        );
                        if (["kept", "dismissed"].includes(value))
                            assert(sent.status === value, "Wrong review status payload");
                        else
                            assert(
                                sent.decision?.value === value &&
                                    sent.decision?.text === "Synthetic fixture-only review",
                                "Wrong decision payload"
                            );
                        if (value === "kept") await closeDialogs();
                        if (value === "dismissed") {
                            await closeDialogs();
                            await list()
                                .getByRole("button", { name: /^Dismissed\s/ })
                                .click();
                            assert(
                                (await rows().count()) === 1,
                                "Dismissed filter did not expose dismissed topic"
                            );
                            assert(
                                (await rows().first().getAttribute("aria-label")) ===
                                    saved.report.topics[0].title,
                                "Wrong dismissed topic"
                            );
                        }
                        if (!["kept", "dismissed"].includes(value)) {
                            await closeDialogs();
                            await list()
                                .getByRole("button", { name: /^Decided\s/ })
                                .click();
                            assert(
                                (await rows().count()) === 1,
                                "Decided filter did not expose recorded topic"
                            );
                        }
                        return {
                            value,
                            expectedVersion: sent.expectedVersion,
                            delivery: "intercepted PATCH; no server write",
                        };
                    } finally {
                        await page.unroute(predicate, handler);
                    }
                });
            await check("fixture-only primary role and star use current revision", async () => {
                let fixture = structuredClone(personal),
                    dirty = false;
                const writes = [];
                const predicate = u =>
                    u.origin === BASE && u.pathname === "/api/vantage/demo/personal";
                const handler = async route => {
                    const req = route.request();
                    if (req.method() === "GET") {
                        if (!dirty) return route.fallback();
                        result.doubled.push({
                            kind: "personal readback",
                            method: "GET",
                            pathname: "/api/vantage/demo/personal",
                            delivery: "fixture readback; not sent to server",
                        });
                        return route.fulfill({ status: 200, json: fixture });
                    }
                    if (req.method() !== "PATCH") return route.fallback();
                    const payload = req.postDataJSON();
                    writes.push(payload);
                    assert(
                        payload.expectedRevision === fixture.state.revision,
                        "Fixture revision mismatch"
                    );
                    fixture.state.revision++;
                    if (payload.operation === "roles") {
                        fixture.roles.roleIds = payload.roleIds;
                        fixture.roles.primaryRoleId = payload.primaryRoleId;
                        fixture.roles.userConfirmed = true;
                    } else if (payload.operation === "star") {
                        fixture.state.stars = fixture.state.stars.filter(
                            s => s.documentId !== payload.documentId
                        );
                        if (payload.starred)
                            fixture.state.stars.push({ documentId: payload.documentId });
                    }
                    dirty = true;
                    result.doubled.push({
                        kind: "personal",
                        method: "PATCH",
                        pathname: "/api/vantage/demo/personal",
                        payload,
                        delivery: "fixture response; not sent to server",
                    });
                    return route.fulfill({ status: 200, json: fixture });
                };
                await page.route(predicate, handler);
                try {
                    await home();
                    const { sheet } = await openContext();
                    await sheet.getByRole("button", { name: /Make primary.*Engineering/ }).click();
                    await sheet.getByRole("button", { name: "Save roles" }).click();
                    await sheet
                        .getByText("Your context choices were saved.")
                        .waitFor({ timeout: 30000 });
                    assert(
                        writes[0]?.operation === "roles" &&
                            writes[0]?.primaryRoleId === "engineering" &&
                            writes[0]?.expectedRevision === personal.state.revision,
                        "Role payload or revision incorrect"
                    );
                    const star = sheet.getByRole("button", { name: "Star Workspace document 14" });
                    await star.click();
                    await sheet
                        .getByRole("button", { name: "Unstar Workspace document 14" })
                        .waitFor({ timeout: 30000 });
                    assert(
                        writes[1]?.operation === "star" &&
                            writes[1]?.documentId === "workspace-document/14" &&
                            writes[1]?.starred === true &&
                            writes[1]?.expectedRevision === personal.state.revision + 1,
                        "Star payload or revision incorrect"
                    );
                    try {
                        await page.waitForFunction(
                            el => el.contains(document.activeElement),
                            await sheet.elementHandle(),
                            { timeout: 3000 }
                        );
                    } catch {
                        const info = await page.evaluate(() => {
                            const d = [
                                ...document.querySelectorAll('[role="dialog"][data-state="open"]'),
                            ].find(x => x.innerText.includes("My context"));
                            const header = d?.querySelector("header[tabindex]");
                            const modals = [
                                ...document.querySelectorAll(
                                    '[role="dialog"][aria-modal="true"][data-state="open"]'
                                ),
                            ].map(x => ({
                                inside: d?.contains(x),
                                label: x.getAttribute("aria-labelledby"),
                            }));
                            const before = document.activeElement?.tagName;
                            header?.focus({ preventScroll: true });
                            return {
                                before,
                                modals,
                                headerFound: !!header,
                                headerFocusWorked: document.activeElement === header,
                            };
                        });
                        throw Error(
                            `Post-star focus did not return inside the context drawer within 3 seconds: ${JSON.stringify(info)}`
                        );
                    }
                    await closeDialogs();
                    return {
                        roleRevision: writes[0].expectedRevision,
                        starRevision: writes[1].expectedRevision,
                        delivery: "intercepted PATCH and fixture GET readback",
                    };
                } finally {
                    await page.unroute(predicate, handler);
                }
            });
            for (const [label, status] of [
                ["Dismiss", "dismissed"],
                ["Confirm addressed", "addressed"],
            ])
                await check(`fixture-only historical question ${status}`, async () => {
                    assert(pending.questions.length > 0, "No actual historical question to test");
                    let sent;
                    const predicate = u =>
                        u.origin === BASE &&
                        u.pathname ===
                            `/api/vantage/agendas/${saved.nativeAgendaId}/pending-questions`;
                    const handler = async route => {
                        const req = route.request();
                        if (req.method() !== "PATCH") return route.fallback();
                        sent = req.postDataJSON();
                        const next = structuredClone(pending);
                        next.version++;
                        next.questions = next.questions.filter(
                            q => q.questionId !== sent.questionId
                        );
                        result.doubled.push({
                            kind: "pending",
                            method: "PATCH",
                            pathname: "/api/vantage/agendas/:id/pending-questions",
                            payload: sent,
                            delivery: "fixture response; not sent to server",
                        });
                        return route.fulfill({ status: 200, json: next });
                    };
                    await page.route(predicate, handler);
                    try {
                        await home();
                        const section = page.getByRole("region", {
                            name: "Pending Questions from Previous Reviews",
                        });
                        await section
                            .getByText(pending.questions[0].question, { exact: true })
                            .waitFor({ timeout: 30000 });
                        const priorReviewWrites = result.doubled.filter(
                            x => x.kind === "review"
                        ).length;
                        await section.getByRole("button", { name: label, exact: true }).click();
                        await page.waitForFunction(
                            () =>
                                !document.querySelector(
                                    '[aria-label="Pending Questions from Previous Reviews"] article'
                                )
                        );
                        assert(
                            sent?.questionId === pending.questions[0].questionId &&
                                sent.status === status &&
                                sent.expectedVersion === pending.version,
                            "Pending payload or version incorrect"
                        );
                        assert(
                            result.doubled.filter(x => x.kind === "review").length ===
                                priorReviewWrites,
                            "Pending action unexpectedly wrote review topic"
                        );
                        return {
                            status,
                            expectedVersion: sent.expectedVersion,
                            delivery: "intercepted independent pending PATCH",
                        };
                    } finally {
                        await page.unroute(predicate, handler);
                    }
                });
            await check("source 409 withholds contextual content", async () => {
                await home();
                const { sheet } = await openDecision();
                const predicate = u =>
                    u.origin === BASE && u.pathname === "/api/vantage/demo/source";
                const handler = route => {
                    result.doubled.push({
                        kind: "source conflict",
                        method: "GET",
                        pathname: "/api/vantage/demo/source",
                        delivery: "fixture 409; not sent to server",
                    });
                    return route.fulfill({
                        status: 409,
                        json: { error: "Synthetic source changed" },
                    });
                };
                await page.route(predicate, handler);
                try {
                    await sheet
                        .getByRole("button", { name: /Workspace document 16/ })
                        .first()
                        .click();
                    await page
                        .getByText(/The source or its access changed\. Content is hidden/)
                        .waitFor({ timeout: 30000 });
                    assert(
                        (await rows().count()) === 0,
                        "Source 409 left contextual topics visible"
                    );
                    return { delivery: "intercepted source GET 409; no server change" };
                } finally {
                    await page.unroute(predicate, handler);
                }
            });
            await check(
                "real saved state remains unchanged after fixture interactions",
                async () => {
                    await home();
                    const r = await getJson(`/api/vantage/demo?week=${week}`),
                        p = await getJson(`/api/vantage/demo/personal?week=${week}`),
                        q = await getJson(
                            `/api/vantage/agendas/${encodeURIComponent(saved.nativeAgendaId)}/pending-questions`
                        );
                    assert(
                        r.status === 200 && p.status === 200 && q.status === 200,
                        "Real readback failed"
                    );
                    assert(
                        JSON.stringify(r.data.report) === JSON.stringify(saved.report),
                        "Real saved report changed"
                    );
                    assert(
                        p.data.state.revision === personal.state.revision &&
                            JSON.stringify(p.data.state.stars) ===
                                JSON.stringify(personal.state.stars),
                        "Real personal context changed"
                    );
                    assert(
                        q.data.version === pending.version &&
                            JSON.stringify(q.data.questions) === JSON.stringify(pending.questions),
                        "Real pending queue changed"
                    );
                    return {
                        reportVersion: r.data.report.version,
                        personalRevision: p.data.state.revision,
                        pendingVersion: q.data.version,
                        source: "real local GET readback",
                    };
                }
            );
            await check("network guard prevents external and unhandled writes", async () => {
                assert(
                    result.blocked.length === 0,
                    `Unexpected blocked attempts: ${JSON.stringify(result.blocked)}`
                );
                assert(
                    !result.api.some(
                        r => r.method === "POST" && r.pathname === "/api/vantage/agendas"
                    ),
                    "Generation POST attempted"
                );
                return {
                    blocked: result.blocked.length,
                    generationPosts: 0,
                    fixtureEvents: result.doubled.length,
                    signIn: "fixed synthetic credential request",
                };
            });
        }
    }
    if (phase === "quick") {
        for (const size of [
            { name: "desktop", width: 1440, height: 900 },
            { name: "mobile", width: 390, height: 844 },
        ])
            await check(`quick ${size.name} updated capture`, async () => {
                await page.setViewportSize({ width: size.width, height: size.height });
                await page.goto(`${BASE}/dev/vantage-context/review?week=2026-10-12`, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });
                await page
                    .locator('section[aria-label="Decisions to make"] article')
                    .first()
                    .waitFor({ timeout: 60000 });
                await capture(`${size.name}-review`);
                await page.getByRole("button", { name: /^My context/ }).click();
                const sheet = page.getByRole("dialog").first();
                await sheet.getByRole("button", { name: "Save roles" }).waitFor({ timeout: 60000 });
                await capture(`${size.name}-context`);
                await page.keyboard.press("Escape");
                await sheet.waitFor({ state: "hidden" });
                return { size: size.name };
            });
    }
    if (phase === "before") {
        await check("baseline saved contextual review desktop", async () => {
            await page.goto(`${BASE}/dev/vantage-context`, { waitUntil: "domcontentloaded" });
            await page
                .getByRole("region", { name: "Saved contextual weekly summary" })
                .waitFor({ timeout: 60000 });
            await capture("before-context-desktop");
            result.contextSnapshot = redact(await page.locator("body").innerText());
        });
        await check("baseline contextual decision drawer desktop", async () => {
            await page
                .locator('[aria-label="Contextual discussion topics"] article')
                .first()
                .getByRole("button")
                .click();
            await page.getByRole("dialog").last().waitFor({ state: "visible" });
            await capture("before-decision-desktop");
            await page.keyboard.press("Escape");
        });
        await check("baseline contextual review mobile", async () => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(`${BASE}/dev/vantage-context`, { waitUntil: "domcontentloaded" });
            await page
                .getByRole("region", { name: "Saved contextual weekly summary" })
                .waitFor({ timeout: 30000 });
            await capture("before-context-mobile");
        });
        await check("baseline native Rules review", async () => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.getByRole("link", { name: "Open native Weekly Review" }).click();
            await page.getByText("The week at a glance").waitFor({ timeout: 30000 });
            await capture("before-native-rules-desktop");
            result.nativeSnapshot = redact(await page.locator("body").innerText());
            result.nativeUrl = page.url();
        });
    }
} catch (e) {
    result.errors.push(redact(e?.stack ?? e));
} finally {
    if (browser) await browser.close();
    result.passed = result.errors.length === 0 && result.checks.every(c => c.status !== "failed");
    writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
    process.stdout.write(
        JSON.stringify(
            {
                phase,
                passed: result.passed,
                checks: result.checks,
                captures: result.captures,
                blocked: result.blocked,
                errors: result.errors,
            },
            null,
            2
        ) + "\n"
    );
    if (!result.passed) process.exitCode = 1;
}
