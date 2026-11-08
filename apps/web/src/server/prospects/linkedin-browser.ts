/**
 * Opens LinkedIn profile pages in one Chromium. A sign-up wall, a timeout,
 * or a failed launch is reported and left for the user to open themselves.
 * Nothing here signs in or tries to get past the wall.
 */
import "server-only";

import { readdirSync } from "node:fs";

import type { Browser } from "playwright";

import {
    openProfilesWith,
    type LinkedInLookup,
    type LinkedInSearchRequest,
} from "@launchstack/pipelines/distribution/linkedin-search";

const PAGE_TIMEOUT_MS = 20_000;

/** A browser directory with no Chromium is ignored, so the installed copy is used. */
function preferInstalledBrowsers(): void {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) return;
    try {
        const names = readdirSync(root);
        if (names.some(name => name.startsWith("chromium_headless_shell-"))) return;
    } catch {
        // The override is not a readable directory.
    }
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

function every(
    people: readonly LinkedInSearchRequest[],
    status: "search_error"
): Map<string, LinkedInLookup> {
    return new Map(people.map(person => [person.name, { status, url: null }]));
}

export async function lookupLinkedInProfiles(
    people: readonly LinkedInSearchRequest[]
): Promise<Map<string, LinkedInLookup>> {
    if (people.length === 0) return new Map();
    let browser: Browser | null = null;
    try {
        preferInstalledBrowsers();
        const { chromium } = await import("playwright");
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ locale: "en-US" });
        try {
            return await openProfilesWith(people, async url => {
                const page = await context.newPage();
                try {
                    await page.goto(url, {
                        timeout: PAGE_TIMEOUT_MS,
                        waitUntil: "domcontentloaded",
                    });
                    await page.waitForTimeout(1000);
                    return { html: await page.content(), finalUrl: page.url() };
                } catch (error) {
                    const message = error instanceof Error ? error.message : "";
                    return { error: /timeout/i.test(message) ? "timeout" : "failed" };
                } finally {
                    await page.close().catch(() => undefined);
                }
            });
        } finally {
            await context.close().catch(() => undefined);
        }
    } catch (error) {
        console.warn("[prospects] LinkedIn page could not be opened:", error);
        return every(people, "search_error");
    } finally {
        await browser?.close().catch(() => undefined);
    }
}
