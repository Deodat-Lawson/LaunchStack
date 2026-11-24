/**
 * The site sample and its recording, built the same way live and offline:
 * `record.ts` runs this with the recorder in record mode, `run.ts` in replay
 * mode, and both walk the candidate lists in the same seeded order.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Recorder, type RecorderMode } from "../lib/recorder";
import { collectSite, PAGE_TIMEOUT_MS, type FetchContext, type SiteRecord } from "./site";
import {
    forgetFailedSourceExchanges,
    GROUPS,
    loadCandidates,
    type Candidate,
    type GroupId,
    type SourceReport,
} from "./sources";

export const SITES_PER_GROUP = 60;
export const HOSTS_IN_PARALLEL = 8;
export const CACHE_NAMESPACE = "e3";

export interface GroupSample {
    /** Entries with a website the directory returned. */
    listed: number;
    /** After dropping platform hosts and hosts already seen. */
    usable: number;
    /** Candidates tried, in seeded order, until the group was full. */
    screened: number;
    /** Sites in the sample: homepage readable, robots.txt allows it. */
    accepted: number;
    /** Candidates left out, by reason. */
    rejected: Record<string, number>;
    /** Requests spent on candidates that were left out. */
    rejectedFetches: number;
}

export interface Dataset {
    sites: SiteRecord[];
    sample: Record<GroupId, GroupSample>;
    sources: SourceReport;
    mode: RecorderMode;
    /** Live requests made by this process (0 in replay). */
    live: number;
    /** The recorder and the recorded request failures, for anything that replays more. */
    ctx: FetchContext;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Run `worker` over a shared queue with at most `width` running at once. */
async function pool(width: number, worker: () => Promise<void>): Promise<void> {
    await Promise.all(Array.from({ length: Math.max(1, width) }, () => worker()));
}

function errorsFile(recorder: Recorder): string {
    return path.join(recorder.dir, "_fetch-errors.json");
}

function loadErrors(recorder: Recorder): Record<string, string> {
    const file = errorsFile(recorder);
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
}

function saveErrors(recorder: Recorder, errors: Record<string, string>): void {
    if (recorder.mode !== "record" || !existsSync(recorder.dir)) return;
    const sorted = Object.fromEntries(
        Object.entries(errors).sort(([a], [b]) => a.localeCompare(b))
    );
    const file = errorsFile(recorder);
    writeFileSync(`${file}.tmp`, JSON.stringify(sorted, null, 1));
    renameSync(`${file}.tmp`, file);
}

interface Screened {
    accepted: boolean;
    reason: string;
    finalHost: string;
    fetches: number;
}

/**
 * The first `target` candidates, in list order, that have a readable homepage
 * and do not end up on a site already taken. The result does not depend on
 * how many run in parallel: every candidate before the last one chosen has
 * been tried.
 */
async function screenGroup(
    ctx: FetchContext,
    candidates: readonly Candidate[],
    target: number,
    width: number,
    takenHosts: Set<string>
): Promise<{ chosen: Candidate[]; sample: Omit<GroupSample, "listed" | "usable"> }> {
    const results: Array<Screened | undefined> = [];
    const choose = (): number[] => {
        const hosts = new Set(takenHosts);
        const chosen: number[] = [];
        for (let i = 0; i < results.length && chosen.length < target; i++) {
            const result = results[i];
            if (!result?.accepted || hosts.has(result.finalHost)) continue;
            hosts.add(result.finalHost);
            chosen.push(i);
        }
        return chosen;
    };
    let next = 0;
    await pool(width, async () => {
        for (;;) {
            if (choose().length >= target) return;
            const index = next++;
            if (index >= candidates.length) return;
            const result = await collectSite(ctx, candidates[index]!, "screen", "screen");
            results[index] = result.accepted
                ? {
                      accepted: true,
                      reason: "",
                      finalHost: result.finalHost,
                      fetches: result.fetches,
                  }
                : {
                      accepted: false,
                      reason: result.reason,
                      finalHost: "",
                      fetches: result.fetches,
                  };
        }
    });
    const chosen = choose();
    const last = chosen.length > 0 ? chosen[chosen.length - 1]! : results.length - 1;
    const chosenSet = new Set(chosen);
    const rejected: Record<string, number> = {};
    let rejectedFetches = 0;
    for (let i = 0; i <= last; i++) {
        const result = results[i];
        if (!result || chosenSet.has(i)) continue;
        const reason = result.accepted ? "same-site-as-another" : result.reason;
        rejected[reason] = (rejected[reason] ?? 0) + 1;
        rejectedFetches += result.fetches;
    }
    for (const index of chosen) takenHosts.add(results[index]!.finalHost);
    return {
        chosen: chosen.map(index => candidates[index]!),
        sample: {
            screened: last + 1,
            accepted: chosen.length,
            rejected: Object.fromEntries(
                Object.entries(rejected).sort(([a], [b]) => a.localeCompare(b))
            ),
            rejectedFetches,
        },
    };
}

export interface BuildOptions {
    /** Forced mode; by default COMPANY_SEARCH_BENCH_MODE decides (replay unless "record"). */
    mode?: RecorderMode;
    /** Sites per group (default 60, or E3_SITES_PER_GROUP for a quick smoke test). */
    sitesPerGroup?: number;
    log?: (line: string) => void;
}

/** 60 per group unless E3_SITES_PER_GROUP asks for a smaller smoke-test sample. */
export function sitesPerGroup(): number {
    const raw = Number.parseInt(process.env.E3_SITES_PER_GROUP ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : SITES_PER_GROUP;
}

export async function buildDataset(options: BuildOptions = {}): Promise<Dataset> {
    const log = options.log ?? (() => undefined);
    const target = options.sitesPerGroup ?? sitesPerGroup();
    const forced = options.mode ? { mode: options.mode } : {};
    // Company sites: production's 10 s page timeout, the recorder's 1 s gap per host.
    const recorder = new Recorder({
        namespace: CACHE_NAMESPACE,
        timeoutMs: PAGE_TIMEOUT_MS,
        ...forced,
    });
    // The directories: one large file, and slower on purpose for the shared geocoder.
    const directories = new Recorder({
        namespace: CACHE_NAMESPACE,
        timeoutMs: 120_000,
        maxBodyBytes: 120 * 1024 * 1024,
        hostDelayMs: { "photon.komoot.io": 3_000, "api.openstreetmap.org": 2_000 },
        ...forced,
    });
    const width = recorder.mode === "record" ? HOSTS_IN_PARALLEL : 1;

    let loaded: Awaited<ReturnType<typeof loadCandidates>> | null = null;
    for (let attempt = 0; loaded === null || loaded.report.failed > 0; attempt++) {
        if (attempt > 0) {
            if (directories.mode !== "record" || attempt > 3) break;
            const waitMs = 30_000 * attempt;
            const dropped = forgetFailedSourceExchanges(directories);
            log(
                `directories: ${dropped} request(s) failed or were rate-limited; waiting ${waitMs / 1000} s before asking again`
            );
            await sleep(waitMs);
        }
        try {
            loaded = await loadCandidates(directories);
        } catch (error) {
            if (directories.mode !== "record" || attempt >= 3) throw error;
            log(`directories: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (loaded === null) throw new Error("The directories could not be read.");
    const { candidates, report } = loaded;
    log(
        `directories: ${GROUPS.map(g => `${g.id} ${report.usable[g.id]} candidates`).join(", ")}; failed requests ${report.failed}`
    );

    const ctx: FetchContext = { recorder, errors: loadErrors(recorder) };
    const sample = {} as Record<GroupId, GroupSample>;
    const chosen: Candidate[] = [];
    const takenHosts = new Set<string>();
    for (const group of GROUPS) {
        const result = await screenGroup(ctx, candidates[group.id], target, width, takenHosts);
        saveErrors(recorder, ctx.errors);
        sample[group.id] = {
            listed: report.listed[group.id],
            usable: report.usable[group.id],
            ...result.sample,
        };
        chosen.push(...result.chosen);
        log(
            `${group.id}: ${result.sample.accepted} sites from ${result.sample.screened} candidates tried; left out ${JSON.stringify(result.sample.rejected)}`
        );
    }

    const ids = new Map<Candidate, string>();
    const perGroup = new Map<GroupId, number>();
    for (const candidate of chosen) {
        const n = (perGroup.get(candidate.group) ?? 0) + 1;
        perGroup.set(candidate.group, n);
        ids.set(candidate, `${candidate.group}-${String(n).padStart(2, "0")}`);
    }
    const sites: Array<SiteRecord | undefined> = [];
    let next = 0;
    let done = 0;
    await pool(width, async () => {
        for (;;) {
            const index = next++;
            if (index >= chosen.length) return;
            const candidate = chosen[index]!;
            const result = await collectSite(ctx, candidate, ids.get(candidate)!, "full");
            if (!result.accepted || !result.site)
                throw new Error(
                    `${ids.get(candidate)}: accepted when screened, rejected when recorded`
                );
            sites[index] = result.site;
            done += 1;
            if (recorder.mode === "record") {
                if (done % 10 === 0) saveErrors(recorder, ctx.errors);
                const site = result.site;
                log(
                    `[${done}/${chosen.length}] ${site.id}: ${site.fetches} requests, ${site.links.length} links, sitemap ${site.sitemap.usable ? "yes" : "no"}${site.abandoned ? ", gave up after failures" : ""}`
                );
            }
        }
    });
    saveErrors(recorder, ctx.errors);
    return {
        sites: sites.filter((site): site is SiteRecord => site !== undefined),
        sample,
        sources: report,
        mode: recorder.mode,
        live: recorder.live + directories.live,
        ctx,
    };
}
