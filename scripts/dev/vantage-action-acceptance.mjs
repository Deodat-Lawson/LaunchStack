#!/usr/bin/env node
/** Local-only acceptance for the synthetic Vantage action sample. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireWeb = createRequire(join(ROOT, "apps/web/package.json"));
const { chromium } = requireWeb("@playwright/test");
const BASE = "http://localhost:3110";
const SAMPLE = `${BASE}/dev/vantage-action-sample`;
const CREDENTIALS = join(ROOT, "test-output/vantage-context-demo/runtime/credentials.json");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const output = join(ROOT, "test-output/vantage-action-acceptance", stamp);
mkdirSync(output, { recursive: true });

const checks = [];
const blockedRequests = [];
const captures = [];
const observedApiRequests = [];
const failedRequests = [];
const failedResponses = [];
const consoleMessages = [];
const pageErrors = [];
let credential;
let browser;
let context;
let page;
let authPending = true;

function redact(value) {
    let message = String(value);
    for (const secret of [credential?.loginEmail, credential?.loginPassword]) {
        if (secret) message = message.split(secret).join("[redacted]");
    }
    return message;
}
function safeRequest(requestUrl, method, reason) {
    const url = new URL(requestUrl);
    blockedRequests.push({ method, origin: url.origin, pathname: url.pathname, reason });
}
function local(url) {
    return (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.port === "3110"
    );
}
function localWebSocket(url) {
    return (
        url.protocol === "ws:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.port === "3110"
    );
}
function assert(condition, message) {
    if (!condition) throw new Error(message);
}
async function check(name, action) {
    try {
        const details = await action();
        checks.push({ name, status: "passed", ...(details === undefined ? {} : { details }) });
        return true;
    } catch (error) {
        checks.push({ name, status: "failed", error: redact(error?.message ?? error) });
        if (page && !authPending) {
            try {
                await page.goto(SAMPLE);
            } catch {
                /* Subsequent checks still report their own failures. */
            }
        }
        return false;
    }
}
async function capture(name, width, height) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: join(output, `${name}.png`), scale: "css" });
    captures.push(`${name}.png`);
}

try {
    credential = JSON.parse(readFileSync(CREDENTIALS, "utf8"));
    assert(credential.loginEmail && credential.loginPassword, "Synthetic credentials missing.");
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
    });
    await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const syntheticSignIn =
            authPending && method === "POST" && url.pathname === "/api/auth/sign-in/email";
        if (!local(url) || !(method === "GET" || method === "HEAD" || syntheticSignIn)) {
            safeRequest(
                request.url(),
                method,
                !local(url) ? "external origin" : "non-read request"
            );
            return route.abort("blockedbyclient");
        }
        return route.continue();
    });
    await context.routeWebSocket("**/*", async socket => {
        const url = new URL(socket.url());
        if (!localWebSocket(url)) {
            safeRequest(socket.url(), "WEBSOCKET", "external origin");
            return socket.close();
        }
        socket.connectToServer();
    });
    context.on("request", request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/"))
            observedApiRequests.push({
                method: request.method(),
                origin: url.origin,
                pathname: url.pathname,
                phase: authPending ? "sign-in" : "read-only",
            });
    });
    context.on("requestfailed", request => {
        const url = new URL(request.url());
        failedRequests.push({
            method: request.method(),
            origin: url.origin,
            pathname: url.pathname,
            error: redact(request.failure()?.errorText ?? "unknown"),
        });
    });
    context.on("response", response => {
        if (response.status() >= 400) {
            const url = new URL(response.url());
            failedResponses.push({
                status: response.status(),
                origin: url.origin,
                pathname: url.pathname,
            });
        }
    });
    page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(redact(error.message)));
    page.on("console", message => {
        if (["warning", "error"].includes(message.type()))
            consoleMessages.push({ level: message.type(), message: redact(message.text()) });
    });
    page.setDefaultTimeout(5000);
    const signedIn = await check("synthetic sign-in", async () => {
        await page.goto(SAMPLE);
        if (new URL(page.url()).pathname === "/signin") {
            await page.getByRole("textbox", { name: "Email" }).fill(credential.loginEmail);
            await page.getByRole("textbox", { name: "Password" }).fill(credential.loginPassword);
            await page.getByRole("button", { name: "Sign in" }).click();
            await page.waitForURL(
                url => url.origin === BASE && url.pathname === "/dev/vantage-action-sample"
            );
        }
        authPending = false;
        assert(
            new URL(page.url()).pathname === "/dev/vantage-action-sample",
            "Synthetic sign-in did not reach sample."
        );
    });
    if (!signedIn) throw new Error("Authentication failed; further UI checks were not run.");

    const ready = await check("captured synthetic sample and truthful initial state", async () => {
        await page.getByRole("heading", { name: "Your week", exact: true }).waitFor();
        assert(
            await page.getByText("Company Architecture needs review").isVisible(),
            "Required context blocker missing."
        );
        assert(
            await page
                .getByText("New generation is blocked. Your saved report is still available.")
                .isVisible(),
            "Blocked state missing."
        );
        assert(
            await page.getByText("Saved replay · no fresh model call").isVisible(),
            "Replay provenance missing."
        );
        const rows = page.locator('[aria-label="Review queue"]').getByRole("button");
        assert((await rows.count()) === 3, "Expected two proposals and one historical question.");
    });
    if (!ready) throw new Error("Sample did not reach its expected initial state.");

    async function home() {
        await page.goto(SAMPLE);
        await page.getByRole("heading", { name: "Your week", exact: true }).waitFor();
    }
    async function theme(value) {
        const current = await page.evaluate(() => document.documentElement.dataset.theme);
        if (current !== value) {
            await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
            await page.waitForFunction(v => document.documentElement.dataset.theme === v, value);
        }
        // Let token color transitions finish before a visual capture.
        await page.waitForTimeout(400);
    }
    async function closeDrawer() {
        const dialog = page.getByRole("dialog");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.waitForTimeout(600);
    }
    async function focusCycle(opener) {
        await opener.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        assert(
            await dialog.evaluate(el => el.contains(document.activeElement)),
            "Focus did not enter drawer."
        );
        await closeDrawer();
        assert(
            await opener.evaluate(el => el === document.activeElement),
            "Focus did not return to invoking control."
        );
    }
    async function layout() {
        return page.evaluate(() => {
            const host = document.querySelector('[class*="sample_frameHost"]');
            const filter = document.querySelector('[aria-label="Filter review items"]');
            const rect = filter?.getBoundingClientRect();
            return {
                viewport: { width: innerWidth, height: innerHeight },
                pageOverflow:
                    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
                    innerWidth,
                paneWidth: host?.getBoundingClientRect().width ?? null,
                filterButtons:
                    filter && rect
                        ? [...filter.querySelectorAll("button")].map(button => {
                              const box = button.getBoundingClientRect();
                              return {
                                  text: button.textContent.trim(),
                                  within: box.left >= rect.left - 1 && box.right <= rect.right + 1,
                              };
                          })
                        : [],
            };
        });
    }

    await check("original context route retains report, source and blocked replay", async () => {
        await page.goto(`${BASE}/dev/vantage-context`);
        await page.getByRole("region", { name: "Saved contextual weekly summary" }).waitFor();
        await page.getByText(/Joseph required context is incomplete/).waitFor();
        assert(
            await page.getByRole("button", { name: "Replay recorded report" }).isDisabled(),
            "Original replay was not blocked."
        );
        await page.getByRole("button", { name: "Inspect Company Architecture" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("heading", { name: "Company Architecture" }).waitFor();
        assert(
            await dialog.getByText("unreviewed", { exact: true }).first().isVisible(),
            "Original Architecture state is missing."
        );
        await closeDrawer();
        await home();
    });

    await check("search, type filters, and empty states", async () => {
        const queue = page.locator('[aria-label="Review queue"]');
        const search = page.getByRole("textbox", { name: "Search your review queue" });
        await search.fill("run-17");
        assert(
            (await queue.getByRole("button").count()) === 1,
            "Search did not narrow to one matching row."
        );
        await search.fill("no-such-synthetic-item-941");
        assert(
            await page.getByRole("heading", { name: "No matching items" }).isVisible(),
            "Search empty state missing."
        );
        await page.getByRole("button", { name: "Show all items" }).click();
        await page.getByRole("button", { name: /^Proposals\s+2$/ }).click();
        assert((await queue.getByRole("button").count()) === 2, "Proposal filter count differs.");
        await page.getByRole("button", { name: /^Questions\s+1$/ }).click();
        assert(
            (await queue.getByRole("button").count()) === 1,
            "Historical question filter count differs."
        );
        await page.getByRole("button", { name: /^Actions\s+0$/ }).click();
        assert(
            await queue.getByRole("heading", { name: "No accepted actions yet" }).isVisible(),
            "Action empty state missing."
        );
        await page.getByRole("button", { name: "Show all items" }).click();
        assert(
            (await queue.getByRole("button").count()) === 3,
            "Return to all did not restore three rows."
        );
    });

    await check("drawer, exact source, original title, and tabs", async () => {
        await page
            .getByRole("button", { name: /Reconcile run-17 deletion checks/ })
            .first()
            .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("heading", { name: "Reconcile run-17 deletion checks" }).waitFor();
        assert(
            await dialog
                .getByText("Reconcile run-17 samples before a privacy go/no-go", { exact: true })
                .isVisible(),
            "Original title missing."
        );
        await dialog.getByRole("tab", { name: "Evidence" }).click();
        await dialog.locator("summary").filter({ hasText: "QA deletion check" }).click();
        assert(
            await dialog.getByText("Workspace document 16", { exact: true }).isVisible(),
            "Original source title missing."
        );
        assert(
            await dialog.getByText("workspace-document/16", { exact: true }).isVisible(),
            "Exact source ID missing."
        );
        assert(
            await dialog
                .locator("details")
                .filter({ hasText: "QA deletion check" })
                .getByText(
                    "Captured synthetic source · current access is not rechecked in this preview."
                )
                .isVisible(),
            "Snapshot authorization limitation missing."
        );
        assert(
            await dialog
                .locator("details")
                .filter({ hasText: "QA deletion check" })
                .getByText(/Authority recorded at capture:/)
                .isVisible(),
            "Captured authority is not time-scoped."
        );
        await dialog.getByRole("tab", { name: "History" }).click();
        assert(
            await dialog.getByRole("heading", { name: "Record history" }).isVisible(),
            "History tab missing."
        );
        await dialog.getByRole("tab", { name: "Context" }).click();
        assert(
            await dialog.getByRole("heading", { name: "Context of the saved report" }).isVisible(),
            "Saved context tab missing."
        );
        const capturedStars = await dialog
            .locator("dt")
            .filter({ hasText: "Stars at capture" })
            .locator("xpath=following-sibling::dd[1]")
            .innerText();
        assert(capturedStars.trim() === "1", "Saved report star count differs from capture.");
        await dialog.getByRole("tab", { name: "Overview" }).click();
        await dialog.getByRole("button", { name: "Keep for discussion" }).click();
        const kept = dialog.getByRole("button", { name: "Kept for discussion" });
        assert(await kept.isDisabled(), "Local review state did not update.");
        assert(
            await dialog.evaluate(el => el.contains(document.activeElement)),
            "Focus escaped the drawer after Keep."
        );
        await kept.focus();
        await page.keyboard.press("Enter");
        await dialog.getByRole("tab", { name: "History" }).click();
        assert(
            (await dialog
                .getByText("Kept for discussion · local preview", { exact: true })
                .count()) === 1,
            "Repeated Keep duplicated the preview history."
        );
        await dialog.getByRole("tab", { name: "Overview" }).click();
        await closeDrawer();
        assert(
            await page
                .getByRole("button", {
                    name: /Reconcile run-17 deletion checks.*Kept for discussion/,
                })
                .isVisible(),
            "Preview review was not reflected in its row."
        );
        await page.getByRole("button", { name: "Review next" }).click();
        assert(
            await page
                .getByRole("dialog")
                .getByRole("heading", { name: "Clarify pilot-access constraints" })
                .isVisible(),
            "Review next did not advance to the next unreviewed item."
        );
        await closeDrawer();
    });

    await check("dismissed preview remains keyboard-dismissible", async () => {
        await home();
        const opener = page
            .getByRole("button", { name: /Clarify pilot-access constraints/ })
            .first();
        await opener.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "Dismiss" }).click();
        assert(
            await dialog.evaluate(el => el.contains(document.activeElement)),
            "Focus escaped the drawer after Dismiss."
        );
        await closeDrawer();
        assert(
            await opener.evaluate(el => el === document.activeElement),
            "Dismissed drawer did not restore focus."
        );
    });

    await check("preview decision remains keyboard-dismissible", async () => {
        await home();
        const opener = page
            .getByRole("button", { name: /Reconcile run-17 deletion checks/ })
            .first();
        await opener.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "Record a decision" }).click();
        await dialog
            .getByRole("textbox", { name: "Decision note" })
            .fill("Synthetic local preview note");
        await dialog.getByRole("button", { name: "Save preview decision" }).click();
        assert(
            await dialog.getByText("Preview decision: Needs more evidence").isVisible(),
            "Preview decision did not appear."
        );
        assert(
            await dialog.evaluate(el => el.contains(document.activeElement)),
            "Focus escaped the drawer after decision save."
        );
        await closeDrawer();
        assert(
            await opener.evaluate(el => el === document.activeElement),
            "Decision drawer did not restore focus."
        );
    });

    await check("question confirmation remains keyboard-dismissible", async () => {
        await home();
        const opener = page
            .getByRole("button", { name: /Confirm privacy review evidence/ })
            .first();
        await opener.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "Confirm addressed" }).click();
        await dialog
            .getByRole("textbox", { name: "What evidence addresses this question?" })
            .fill("Synthetic local preview evidence");
        await dialog.getByRole("button", { name: "Save preview confirmation" }).click();
        assert(
            await dialog.getByRole("button", { name: "Addressed · preview" }).isDisabled(),
            "Question confirmation did not appear."
        );
        assert(
            await dialog.evaluate(el => el.contains(document.activeElement)),
            "Focus escaped the drawer after question confirmation."
        );
        await closeDrawer();
        assert(
            await opener.evaluate(el => el === document.activeElement),
            "Question drawer did not restore focus."
        );
    });

    await home();
    await check("historical question remains unversioned and separate", async () => {
        await page.getByRole("button", { name: /^Questions\s+1$/ }).click();
        await page.getByRole("button", { name: /Confirm privacy review evidence/ }).click();
        const dialog = page.getByRole("dialog");
        assert(
            await dialog.getByText(/Current status is unverified/).isVisible(),
            "Historical status not shown."
        );
        await dialog.getByRole("tab", { name: "Evidence" }).click();
        assert(
            await dialog
                .getByText("No exact source version is attached to this historical record.")
                .isVisible(),
            "Historical version limitation missing."
        );
        await closeDrawer();
        await page.getByRole("button", { name: /^All\s+3$/ }).click();
    });

    await check("preview roles and stars stay separate from saved context", async () => {
        await page.getByRole("link", { name: "Your context" }).click();
        const primary = page.getByRole("combobox", { name: "Primary role" });
        assert(
            (await primary.innerText()).includes("No primary selected"),
            "Initial primary role was invented."
        );
        assert(
            await page.getByText(/^0 starred/).isVisible(),
            "Initial stars differ from capture."
        );
        await primary.click();
        await page.getByRole("option", { name: "Engineering" }).click();
        assert(
            (await primary.innerText()).includes("Engineering"),
            "Primary role selection failed."
        );
        await page.getByRole("button", { name: "Star QA deletion check version 16" }).click();
        assert(await page.getByText(/^1 starred/).isVisible(), "Local star selection failed.");
        await page.getByRole("button", { name: "Unstar QA deletion check version 16" }).click();
        assert(await page.getByText(/^0 starred/).isVisible(), "Local star deselection failed.");
        await page.getByRole("button", { name: "Confirm roles" }).click();
        assert(
            await page.getByText(/Roles confirmed for this local preview/).isVisible(),
            "Local role confirmation missing."
        );
        await page.getByRole("link", { name: "Your week" }).click();
        await page
            .getByRole("button", { name: /Reconcile run-17 deletion checks/ })
            .first()
            .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("tab", { name: "Context" }).click();
        const saved = await dialog
            .locator("dt")
            .filter({ hasText: "Stars at capture" })
            .locator("xpath=following-sibling::dd[1]")
            .innerText();
        assert(
            saved.trim() === "1",
            "Current zero-star selection changed the saved report's one captured star."
        );
        assert(
            await dialog
                .getByText(/current Joseph role and star choices do not change/)
                .isVisible(),
            "Saved/current distinction missing."
        );
        await closeDrawer();
        await page.reload();
        await page.getByRole("link", { name: "Your context" }).click();
        assert(
            (await page.getByRole("combobox", { name: "Primary role" }).innerText()).includes(
                "No primary selected"
            ),
            "Reload did not reset primary selection."
        );
        assert(await page.getByText(/^0 starred/).isVisible(), "Reload did not reset stars.");
    });

    await check("keyboard opening, Escape, and focus restoration", async () => {
        await page.getByRole("link", { name: "Your week" }).click();
        await focusCycle(page.getByRole("button", { name: "Review next" }));
        await focusCycle(
            page.getByRole("button", { name: /Reconcile run-17 deletion checks/ }).first()
        );
        await page.getByRole("link", { name: "Your context" }).click();
        await focusCycle(page.getByRole("button", { name: "Inspect source" }));
    });

    await check("drawer keyboard tab navigation and visible focus", async () => {
        await home();
        const opener = page.getByRole("button", { name: "Review next" });
        await opener.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("tab", { name: "Overview" }).focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() =>
            [...document.querySelectorAll('[role="tab"]')].some(
                element =>
                    element.textContent.trim() === "Evidence" &&
                    element.getAttribute("aria-selected") === "true"
            )
        );
        assert(
            await dialog
                .getByRole("tab", { name: "Evidence" })
                .evaluate(el => el === document.activeElement),
            "ArrowRight did not focus Evidence."
        );
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
            const element = document.activeElement;
            const style = getComputedStyle(element);
            return {
                visible: element.matches(":focus-visible"),
                outline: style.outlineStyle,
                width: style.outlineWidth,
                shadow: style.boxShadow,
            };
        });
        assert(
            focus.visible &&
                ((focus.outline !== "none" && parseFloat(focus.width) > 0) ||
                    focus.shadow !== "none"),
            "Keyboard focus indicator was not visible."
        );
        await closeDrawer();
        assert(
            await opener.evaluate(el => el === document.activeElement),
            "Keyboard drawer did not restore focus."
        );
        return focus;
    });

    await check("reduced motion", async () => {
        await page.getByRole("link", { name: "Your week" }).click();
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.getByRole("button", { name: "Review next" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        const durations = await dialog.evaluate(el => ({
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            animation: getComputedStyle(el).animationDuration,
            transition: getComputedStyle(el).transitionDuration,
        }));
        assert(
            durations.reduced &&
                parseFloat(durations.animation) < 0.02 &&
                parseFloat(durations.transition) < 0.02,
            "Drawer motion was not reduced."
        );
        await closeDrawer();
        await page.emulateMedia({ reducedMotion: "no-preference" });
        return durations;
    });

    await check("weekly review retains the separate historical question", async () => {
        await page.getByRole("link", { name: "Weekly review" }).click();
        assert(
            await page.getByRole("heading", { name: "Carried forward" }).isVisible(),
            "Carried-forward section missing."
        );
        assert(
            await page
                .getByRole("button", {
                    name: /Confirm privacy review evidence.*Current status unverified/,
                })
                .isVisible(),
            "Historical question or its status missing."
        );
        await page.locator("summary").filter({ hasText: "Saved report provenance" }).click();
        assert(
            await page.getByText(/not generated from your current Joseph choices/).isVisible(),
            "Saved report provenance missing."
        );
    });

    await check("actual Inter font glyphs", async () => {
        await home();
        await page.evaluate(() => document.fonts.ready);
        const session = await context.newCDPSession(page);
        await session.send("DOM.enable");
        await session.send("CSS.enable");
        const { root } = await session.send("DOM.getDocument", { depth: -1, pierce: true });
        const fonts = {};
        for (const [name, selector] of Object.entries({
            heading: "main h1",
            row: 'span[class*="rowTitle"]',
            metadata: 'span[class*="rowMeta"]',
        })) {
            const { nodeId } = await session.send("DOM.querySelector", {
                nodeId: root.nodeId,
                selector,
            });
            assert(nodeId, `Font target missing: ${name}`);
            fonts[name] = (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
            assert(
                fonts[name].some(
                    font => font.familyName === "Inter" && font.isCustomFont && font.glyphCount > 0
                ),
                `Inter glyphs not confirmed for ${name}.`
            );
        }
        await session.detach();
        return fonts;
    });

    await check("responsive screenshot matrix", async () => {
        await home();
        const measurements = [];
        const sizes = [
            ["desktop-1440", 1440, 900],
            ["desktop-1280", 1280, 800],
            ["tablet-768", 768, 900],
            ["mobile-390", 390, 844],
        ];
        for (const mode of ["light", "dark"]) {
            await page.setViewportSize({ width: 1440, height: 900 });
            await theme(mode);
            for (const [name, width, height] of sizes) {
                await capture(`${mode}-${name}`, width, height);
                const measured = await layout();
                assert(
                    measured.pageOverflow <= 1,
                    `${mode} ${name} has page overflow ${measured.pageOverflow}px.`
                );
                assert(
                    measured.filterButtons.length === 4 &&
                        measured.filterButtons.every(button => button.within),
                    `${mode} ${name} hides a type filter.`
                );
                measurements.push({ mode, name, ...measured });
            }
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.evaluate(() => {
                const host = document.querySelector('[class*="sample_frameHost"]');
                if (!host) throw new Error("ToolFrame host missing.");
                host.style.width = "420px";
            });
            await capture(`${mode}-narrow-pane-420`, 1440, 900);
            const measured = await layout();
            assert(
                Math.abs(measured.paneWidth - 420) <= 1,
                "ToolFrame pane width was not constrained."
            );
            assert(
                measured.pageOverflow <= 1 && measured.filterButtons.every(button => button.within),
                `${mode} narrow pane overflows or hides a type filter.`
            );
            measurements.push({ mode, name: "narrow-pane-420", ...measured });
            await page.evaluate(() => {
                document.querySelector('[class*="sample_frameHost"]').style.removeProperty("width");
            });
        }
        return measurements;
    });

    await check("Figma reference views captured", async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await theme("light");
        await page.getByRole("button", { name: "Review next" }).click();
        await capture("light-drawer-desktop", 1440, 900);
        await page.getByRole("dialog").getByRole("tab", { name: "Evidence" }).click();
        await page.waitForTimeout(250);
        await capture("light-evidence-desktop", 1440, 900);
        await page
            .getByRole("dialog")
            .locator("summary")
            .filter({ hasText: "QA deletion check" })
            .click();
        await page
            .getByRole("dialog")
            .getByText("Exact version", { exact: true })
            .first()
            .scrollIntoViewIfNeeded();
        await capture("light-evidence-exact-source", 1440, 900);
        await page.getByRole("dialog").getByRole("tab", { name: "History" }).click();
        await page.waitForTimeout(250);
        await capture("light-history-desktop", 1440, 900);
        await closeDrawer();
        await page.getByRole("link", { name: "Weekly review" }).click();
        await capture("light-weekly-desktop", 1440, 900);
        await page.getByRole("link", { name: "Your context" }).click();
        await capture("light-context-desktop", 1440, 900);
        await page.getByRole("link", { name: "Your week" }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "Review next" }).click();
        await capture("light-drawer-mobile", 390, 844);
        await closeDrawer();
    });
} catch (error) {
    checks.push({ name: "runner", status: "failed", error: redact(error?.message ?? error) });
} finally {
    if (context) await context.close();
    if (browser) await browser.close();
    const result = {
        schema: "vantage-action-local-acceptance/v1",
        capturedAt: new Date().toISOString(),
        url: SAMPLE,
        checks,
        blockedRequests,
        observedApiRequests,
        failedRequests,
        failedResponses,
        consoleMessages,
        pageErrors,
        captures,
        passed:
            checks.every(item => item.status === "passed") &&
            blockedRequests.length === 0 &&
            pageErrors.length === 0 &&
            !consoleMessages.some(item => item.level === "error"),
        boundary:
            "Local synthetic preview; external and non-read browser requests are blocked after sign-in.",
    };
    writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
    process.stdout.write(
        `${JSON.stringify({ output, passed: result.passed, checks: checks.map(({ name, status, error }) => ({ name, status, ...(error ? { error } : {}) })), blockedRequests, failedRequests, failedResponses, consoleMessages, pageErrors }, null, 2)}\n`
    );
    if (!result.passed) process.exitCode = 1;
}
