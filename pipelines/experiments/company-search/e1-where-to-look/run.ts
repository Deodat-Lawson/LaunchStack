/**
 * E1 — what to ask a capped place search, and where.
 *
 *   pnpm exec tsx experiments/company-search/e1-where-to-look/run.ts
 *
 * Replays every policy against the recorded Photon world of each segment
 * (see ./record.ts) and writes ../results/e1-where-to-look.json. Offline and
 * deterministic: the same recording gives byte-identical results.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluatePolicies, printPolicyTable } from "../lib/discovery-report";
import { mean, round } from "../lib/stats";
import { createEnv } from "./env";
import { SEGMENTS } from "./segments";
import { loadWorld, type World } from "./world";

const BUDGETS = [8, 16, 32, 64, 96];
const MAX_BUDGET = 96;
const LONG_BUDGET = 400;
const SEEDS = 30;
/** Shares of the reachable population whose cost in requests is reported. */
const COVERAGE_MARKS = [0.5, 0.8, 0.95];

/**
 * "Why not just ask in the local language?" The best case for that fix: the
 * k words whose complete sweeps return the most places, i.e. the words a
 * perfect planner would have guessed. Reported with what they reach and what
 * the sweeps cost, so it can be set against the letter sweep.
 */
function bestCaseWords(world: World, reachable: number) {
    const sweeps = Object.entries(world.sweeps)
        .filter(([term]) => term.length >= 3)
        .map(([term, nodes]) => {
            const places = new Set<string>();
            for (const node of Object.values(nodes)) for (const id of node.places) places.add(id);
            return { term, places, requests: Object.keys(nodes).length };
        });
    const picked: typeof sweeps = [];
    const covered = new Set<string>();
    const rows: Array<{ words: number; placesReached: number; share: number; requests: number }> =
        [];
    // Greedy: each next word adds the most places not reached yet.
    for (let k = 1; k <= 5; k++) {
        let best: (typeof sweeps)[number] | null = null;
        let bestGain = 0;
        for (const sweep of sweeps) {
            if (picked.includes(sweep)) continue;
            let gain = 0;
            for (const id of sweep.places) if (!covered.has(id)) gain += 1;
            if (gain > bestGain) {
                best = sweep;
                bestGain = gain;
            }
        }
        if (!best) break;
        picked.push(best);
        for (const id of best.places) covered.add(id);
        rows.push({
            words: k,
            placesReached: covered.size,
            share: round(covered.size / reachable, 3),
            requests: picked.reduce((sum, sweep) => sum + sweep.requests, 0),
        });
    }
    return rows;
}

function runSegment(world: World) {
    const env = createEnv(world);
    const reachableIds = Object.keys(world.places);
    const reachable = reachableIds.length;
    const { policies, estimators } = evaluatePolicies(env, {
        id: world.segment.id,
        budgets: BUDGETS,
        maxBudget: MAX_BUDGET,
        longBudget: LONG_BUDGET,
        seeds: SEEDS,
        reachable,
        coverageMarks: COVERAGE_MARKS,
        letters: true,
        estimatorPolicies: ["letters-static", "mined-thompson"],
    });
    const truthAll = new Set(world.truth?.all ?? []);
    const truthWeb = new Set(world.truth?.withWebsite ?? []);
    return {
        bestCaseNativeWords: bestCaseWords(world, reachable),
        id: world.segment.id,
        label: world.segment.label,
        category: world.segment.tag,
        population: {
            /** Named places with the category in the country, from Overpass. */
            overpassAll: truthAll.size,
            overpassWithWebsite: truthWeb.size,
            /** Everything any recorded Photon request returned. */
            photonReachable: reachable,
            photonReachableWithWebsite: world.withWebsite.length,
            /** Share of the Overpass population the recorded Photon sweeps reached. */
            reachableShareOfOverpass:
                truthAll.size > 0
                    ? round(reachableIds.filter(id => truthAll.has(id)).length / truthAll.size, 3)
                    : null,
        },
        recordedWords: {
            plan: world.terms.plan,
            letters: world.terms.letters.length,
            mined: world.terms.mined.length,
        },
        recordingRequests: world.photonRequests,
        /** Production's own keyless search for this segment, run unchanged. */
        today: {
            photonRequests: world.production.photonRequests,
            osmApiRequests: world.production.osmApiRequests,
            keptPlaces: world.production.kept,
            keptOnTarget: world.production.keptOnTarget.length,
            shareOfTargetsWithWebsite:
                world.withWebsite.length > 0
                    ? round(world.production.keptOnTarget.length / world.withWebsite.length, 4)
                    : null,
        },
        /** Production's whole place search (Photon, then Overpass, then Nominatim), one live sample. */
        todayWholeSearch: world.productionFull
            ? {
                  keptPlaces: world.productionFull.kept,
                  keptOnTarget: world.productionFull.keptOnTarget,
                  requestsByHost: world.productionFull.requestsByHost,
                  failedByHost: world.productionFull.failedByHost,
                  error: world.productionFull.error,
              }
            : null,
        overpassAttempts: world.truth?.attempts ?? [],
        policies,
        estimators,
    };
}

function main(): void {
    const segments: Array<ReturnType<typeof runSegment>> = [];
    for (const segment of SEGMENTS) {
        const world = loadWorld(segment.id);
        if (!world) {
            console.warn(`no recording for ${segment.id}; run record.ts first`);
            continue;
        }
        segments.push(runSegment(world));
    }

    // Across segments: the share of the reachable population each policy knows at each budget.
    const policyIds = segments[0]?.policies.map(p => p.id) ?? [];
    const overall = policyIds.map(id => {
        const row: Record<string, number | string> = { id };
        for (const budget of BUDGETS) {
            row[`knownShareAt${budget}`] = round(
                mean(
                    segments.map(
                        s =>
                            s.policies.find(p => p.id === id)!.found[budget]!.mean /
                            s.population.photonReachable
                    )
                ),
                3
            );
        }
        return row;
    });
    // Same number of Photon requests as production spent: who finds more places with a website?
    const todayVsPolicies = segments.map(s => {
        const requests = Math.min(s.today.photonRequests, MAX_BUDGET);
        const atSameRequests = Object.fromEntries(
            s.policies.map(p => [p.id, p.bonusCurve[requests - 1] ?? 0])
        );
        return {
            segment: s.id,
            requests,
            todayOnTargetWithWebsite: s.today.keptOnTarget,
            policiesWithWebsiteAtSameRequests: atSameRequests,
        };
    });
    const attempts = segments.flatMap(s => s.overpassAttempts);
    const answered = attempts.filter(a => a.ok).sort((a, b) => a.ms - b.ms);
    const overpass = {
        attempts: attempts.length,
        answered: answered.length,
        medianSecondsWhenAnswered: round(
            (answered[Math.floor(answered.length / 2)]?.ms ?? 0) / 1000,
            1
        ),
        byHost: Object.fromEntries(
            [...new Set(attempts.map(a => a.host))].sort().map(host => [
                host,
                {
                    attempts: attempts.filter(a => a.host === host).length,
                    answered: attempts.filter(a => a.host === host && a.ok).length,
                },
            ])
        ),
    };

    const output = {
        experiment: "e1-where-to-look",
        question:
            "With a place search that returns at most 50 name matches per request, which words and map boxes should the next request ask?",
        budgets: BUDGETS,
        seedsPerStochasticPolicy: SEEDS,
        costModel:
            "One Photon request costs 1. Looking up websites costs one OSM API request per 100 places, the same for every policy, and is not counted in the budget.",
        segments,
        overall,
        todayVsPolicies,
        overpass,
    };
    const here = path.dirname(fileURLToPath(import.meta.url));
    const outDir = path.resolve(here, "..", "results");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
        path.join(outDir, "e1-where-to-look.json"),
        `${JSON.stringify(output, null, 2)}\n`
    );

    for (const s of segments) {
        console.log(
            `\n== ${s.label}: ${s.population.photonReachable} reachable (${s.population.photonReachableWithWebsite} with a website); Overpass ${s.population.overpassAll} (${s.population.overpassWithWebsite})`
        );
        console.log(
            `   today: ${s.today.photonRequests} Photon requests -> ${s.today.keptOnTarget} on-target places with a website (kept ${s.today.keptPlaces})`
        );
        printPolicyTable(s.policies, BUDGETS, COVERAGE_MARKS);
    }
    console.log("\noverall share of reachable population known:");
    for (const row of overall) console.log("  ", JSON.stringify(row));
    console.log("\noverpass:", JSON.stringify(overpass));
}

main();
