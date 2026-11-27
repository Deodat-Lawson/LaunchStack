/**
 * Production's reader as it was when this experiment was run: the homepage,
 * then 13 guessed paths in a fixed order, until 4 pages were readable. It is
 * what the `today` policy replays.
 *
 * Production follows the homepage's links since then, so that page order no
 * longer exists in `src/`. The loop below is copied from
 * `pipelines/src/distribution/keyless/profile.ts` at commit 968724695 (its
 * 40 s clock left out: the replay has no clock), so that `today` can still
 * be checked against real fetches on any recording.
 */
import type { ReadablePage } from "@launchstack/tools/web-research";

import { normalizeUrlForMatch } from "../../../src/distribution/dossier-agent";
import { PRODUCTION_MAX_PAGES } from "./policies";
import { MIN_READABLE_CHARS, PRODUCTION_EXTRA_PATHS } from "./site";

/** The readable pages the guessed-path reader ends up with, the homepage first. */
export async function readSiteAsBefore(
    fetchPage: (url: string) => Promise<ReadablePage>,
    homeUrl: string
): Promise<ReadablePage[]> {
    const fetched = new Set<string>();
    const pages: ReadablePage[] = [];
    const tryFetch = async (url: string): Promise<ReadablePage | null> => {
        try {
            const page = await fetchPage(url);
            if (page.status >= 400 || page.text.trim().length < MIN_READABLE_CHARS) return null;
            const key = normalizeUrlForMatch(page.finalUrl);
            if (fetched.has(key)) return null;
            fetched.add(key);
            fetched.add(normalizeUrlForMatch(page.url));
            pages.push(page);
            return page;
        } catch {
            return null;
        }
    };
    const home = await tryFetch(homeUrl);
    if (!home) return pages;
    for (const path of PRODUCTION_EXTRA_PATHS) {
        if (pages.length >= PRODUCTION_MAX_PAGES) break;
        let url: string;
        try {
            url = new URL(path, home.finalUrl).href;
        } catch {
            continue;
        }
        await tryFetch(url);
    }
    return pages;
}
