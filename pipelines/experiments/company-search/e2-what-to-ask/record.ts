/**
 * E2 recording.
 *
 *   COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e2-what-to-ask/record.ts [segment-id ...]
 *
 * Per segment: the first pages of the name search for each planned word;
 * then for the words that occur in the names of target companies those
 * pages found (two rounds); then the full target class, for ground truth.
 * Mined words come only from recorded results, never from the truth list.
 */
import { Recorder } from "../lib/recorder";
import { SEGMENTS, type RegisterSegment } from "./segments";
import {
    PAGE_SIZE,
    classUrl,
    nameTokens,
    saveWorld,
    searchUrl,
    type Company,
    type RegisterWorld,
} from "./world";

/**
 * Pages recorded per word: a policy can go this deep and no deeper. Planned
 * words go deeper so that "keep paging the plan" is never cut short within
 * the reported budgets.
 */
const MAX_PAGES = 10;
const MAX_PAGES_PLAN = 40;
const MINED_PER_ROUND = [40, 20];
const MIN_NAME_COUNT = 2;

interface RegisterPage {
    _embedded?: {
        enheter?: Array<{
            organisasjonsnummer: string;
            navn: string;
            naeringskode1?: { kode: string };
        }>;
    };
    page?: { totalElements: number; totalPages: number };
}

function rows(page: RegisterPage): Company[] {
    return (page._embedded?.enheter ?? []).map(e => ({
        id: e.organisasjonsnummer,
        name: e.navn,
        code: e.naeringskode1?.kode ?? null,
    }));
}

async function recordTerm(
    term: string,
    recorder: Recorder,
    maxPages: number
): Promise<{ pages: Company[][]; total: number; requests: number }> {
    const pages: Company[][] = [];
    let total = 0;
    let requests = 0;
    for (let page = 0; page < maxPages; page++) {
        let json: RegisterPage;
        try {
            json = await recorder.getJson<RegisterPage>(searchUrl(term, page));
        } catch (error) {
            console.warn(`  search failed for "${term}" page ${page}: ${String(error)}`);
            break;
        }
        requests += 1;
        const found = rows(json);
        total = json.page?.totalElements ?? total;
        pages.push(found);
        if (found.length < PAGE_SIZE || page + 1 >= (json.page?.totalPages ?? 0)) break;
    }
    return { pages, total, requests };
}

function minedTerms(
    world: Pick<RegisterWorld, "pages" | "segment">,
    recorded: ReadonlySet<string>,
    max: number
): string[] {
    const targets = new Map<string, string>();
    for (const pages of Object.values(world.pages))
        for (const page of pages)
            for (const company of page)
                if (company.code === world.segment.code) targets.set(company.id, company.name);
    const counts = new Map<string, number>();
    for (const name of targets.values()) {
        for (const token of new Set(nameTokens(name))) {
            if (token.length < 3 || /^\d+$/.test(token)) continue;
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([token, count]) => count >= MIN_NAME_COUNT && !recorded.has(token))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, max)
        .map(([token]) => token);
}

async function recordTruth(segment: RegisterSegment, recorder: Recorder): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 0; page < 100; page++) {
        const json = await recorder.getJson<RegisterPage>(classUrl(segment.code, page));
        const found = rows(json);
        ids.push(...found.map(c => c.id));
        if (found.length < 100 || page + 1 >= (json.page?.totalPages ?? 0)) break;
    }
    return ids;
}

async function main(): Promise<void> {
    const wanted = process.argv.slice(2);
    const segments = wanted.length > 0 ? SEGMENTS.filter(s => wanted.includes(s.id)) : SEGMENTS;
    const recorder = new Recorder({ namespace: "e2", minDelayMs: 350, timeoutMs: 30_000 });
    for (const segment of segments) {
        console.log(`\n== ${segment.id} (${segment.label})`);
        const world: RegisterWorld = {
            segment,
            pages: {},
            totals: {},
            terms: { plan: segment.plan.map(t => t.toLowerCase()), mined: [] },
            truth: [],
            requests: 0,
        };
        const run = async (terms: readonly string[], maxPages: number): Promise<void> => {
            for (const term of terms) {
                if (world.pages[term]) continue;
                const recorded = await recordTerm(term, recorder, maxPages);
                world.pages[term] = recorded.pages;
                world.totals[term] = recorded.total;
                world.requests += recorded.requests;
            }
        };
        await run(world.terms.plan, MAX_PAGES_PLAN);
        console.log(`  plan: ${world.requests} requests`);
        for (const max of MINED_PER_ROUND) {
            const next = minedTerms(world, new Set(Object.keys(world.pages)), max);
            await run(next, MAX_PAGES);
            world.terms.mined.push(...next);
            console.log(`  + ${next.length} mined words: ${world.requests} requests`);
        }
        world.truth = await recordTruth(segment, recorder);
        const reachable = new Set<string>();
        for (const pages of Object.values(world.pages))
            for (const page of pages)
                for (const company of page)
                    if (company.code === segment.code) reachable.add(company.id);
        console.log(
            `  target class: ${world.truth.length} companies; recorded pages reach ${reachable.size}`
        );
        saveWorld(world);
    }
    console.log(`\nlive requests: ${recorder.live}, replayed: ${recorder.replayed}`);
}

await main();
