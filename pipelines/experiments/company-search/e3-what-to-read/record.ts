/**
 * Live collection for e3-what-to-read.
 *
 *   COMPANY_SEARCH_BENCH_MODE=record pnpm exec tsx experiments/company-search/e3-what-to-read/record.ts
 *
 * Reads the three directories, picks the sample and records every request
 * the policies could make (see README.md). It is resumable: anything already
 * in the cache is not asked for again. Without COMPANY_SEARCH_BENCH_MODE=record
 * it touches no network and only checks that the recording is complete.
 */
import { NotRecordedError } from "../lib/recorder";
import { buildDataset } from "./dataset";
import { GROUPS } from "./sources";

const started = Date.now();
try {
    const dataset = await buildDataset({ log: line => console.log(line) });
    const fetches = dataset.sites.reduce((sum, site) => sum + site.fetches, 0);
    const exchanges = dataset.sites.reduce((sum, site) => sum + site.exchanges, 0);
    const rejected = GROUPS.reduce((sum, g) => sum + dataset.sample[g.id].rejectedFetches, 0);
    const most = Math.max(0, ...dataset.sites.map(site => site.fetches));
    console.log(
        `\n${dataset.mode === "record" ? "recorded" : "checked (replay, no network)"}: ${dataset.sites.length} sites, ` +
            `${fetches} requests (${exchanges} HTTP exchanges with redirect hops), at most ${most} per site; ` +
            `${rejected} more on candidates that were left out`
    );
    console.log(
        `sites that were given up on after consecutive failures: ${dataset.sites.filter(site => site.abandoned).length}`
    );
    console.log(
        `live requests in this run: ${dataset.live}; ${((Date.now() - started) / 1000).toFixed(0)} s`
    );
    if (dataset.mode !== "record")
        console.log("Nothing was fetched. Set COMPANY_SEARCH_BENCH_MODE=record to collect.");
} catch (error) {
    if (error instanceof NotRecordedError) {
        console.error(
            `${error.message}\nThe recording is incomplete. Run with COMPANY_SEARCH_BENCH_MODE=record to collect what is missing.`
        );
        process.exit(1);
    }
    throw error;
}
