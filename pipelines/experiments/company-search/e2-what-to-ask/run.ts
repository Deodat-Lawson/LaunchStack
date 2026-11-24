/**
 * E2 — what to ask a paged keyword search.
 *
 *   pnpm exec tsx experiments/company-search/e2-what-to-ask/run.ts
 *
 * Replays every policy against the recorded register search of each segment
 * (see ./record.ts) and writes ../results/e2-what-to-ask.json. Offline and
 * deterministic.
 *
 * A request is one page of 20 results for one word. "Today" is the static
 * plan: every planned word once, first page only, which is how Prospects
 * runs its planned queries (each once, top results, nothing learned).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DiscoveryEnv, ResultItem, TermCursor } from "../lib/discovery";
import { evaluatePolicies, printPolicyTable } from "../lib/discovery-report";
import { mean, round } from "../lib/stats";
import { SEGMENTS } from "./segments";
import { PAGE_SIZE, loadWorld, nameTokens, type RegisterWorld } from "./world";

const BUDGETS = [6, 12, 24, 48, 96];
const MAX_BUDGET = 96;
const LONG_BUDGET = 400;
const SEEDS = 30;
const COVERAGE_MARKS = [0.5, 0.8, 0.95];

function createEnv(world: RegisterWorld): DiscoveryEnv {
    const open = (term: string): TermCursor => {
        const pages = world.pages[term] ?? [];
        let next = 0;
        const items = (page: number): ResultItem[] =>
            (pages[page] ?? []).map(company => ({
                id: company.id,
                name: company.name,
                target: company.code === world.segment.code,
            }));
        return {
            pending: () => pages.length - next,
            peek: () => (next < pages.length ? items(next) : null),
            next: () => items(next++),
            // Complete only when the recording holds every match of the word.
            complete: () =>
                next >= pages.length && (world.totals[term] ?? 0) <= pages.length * PAGE_SIZE,
        };
    };
    return {
        cap: PAGE_SIZE,
        planTerms: world.terms.plan,
        letterTerms: [],
        allTerms: () => Object.keys(world.pages),
        hasTerm: term => world.pages[term] !== undefined,
        open,
        tokens: nameTokens,
        // The register's name search matches whole words.
        wordMatches: (nameWord, queryWord) => nameWord === queryWord,
        keysOf: nameWord => [nameWord],
    };
}

function runSegment(world: RegisterWorld) {
    const env = createEnv(world);
    const truth = new Set(world.truth);
    const reachable = new Set<string>();
    let results = 0;
    let targetResults = 0;
    for (const pages of Object.values(world.pages)) {
        for (const page of pages) {
            for (const company of page) {
                results += 1;
                if (company.code !== world.segment.code) continue;
                targetResults += 1;
                reachable.add(company.id);
            }
        }
    }
    const { policies, estimators } = evaluatePolicies(env, {
        id: world.segment.id,
        budgets: BUDGETS,
        maxBudget: MAX_BUDGET,
        longBudget: LONG_BUDGET,
        seeds: SEEDS,
        reachable: reachable.size,
        coverageMarks: COVERAGE_MARKS,
        letters: false,
        estimatorPolicies: ["plan-static", "mined-thompson"],
    });
    const planStatic = policies.find(p => p.id === "plan-static")!;
    const planSize = world.terms.plan.length;
    return {
        id: world.segment.id,
        label: world.segment.label,
        targetClass: world.segment.code,
        population: {
            /** Companies in the target class, from the register itself. */
            targetClass: truth.size,
            /** Targets that some recorded page returned. */
            reachable: reachable.size,
            reachableShare: truth.size > 0 ? round(reachable.size / truth.size, 3) : null,
            /** Share of all recorded results that were targets. */
            targetShareOfResults: results > 0 ? round(targetResults / results, 3) : null,
        },
        recordedWords: { plan: world.terms.plan, mined: world.terms.mined.length },
        recordingRequests: world.requests,
        /** Every planned word once, first page only. */
        today: {
            requests: planSize,
            targetsFound: planStatic.curve[planSize - 1] ?? 0,
        },
        policiesAtTodayBudget: Object.fromEntries(
            policies.map(p => [p.id, p.curve[planSize - 1] ?? 0])
        ),
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
    const policyIds = segments[0]?.policies.map(p => p.id) ?? [];
    // Per budget: targets found relative to the fixed-order plan (1 = same), averaged over segments.
    const overall = policyIds.map(id => {
        const row: Record<string, number | string> = { id };
        for (const budget of BUDGETS) {
            row[`relativeToPlanAt${budget}`] = round(
                mean(
                    segments.map(s => {
                        const mine = s.policies.find(p => p.id === id)!.found[budget]!.mean;
                        const plan = s.policies.find(p => p.id === "plan-static")!.found[budget]!
                            .mean;
                        return plan > 0 ? mine / plan : 1;
                    })
                ),
                3
            );
        }
        return row;
    });

    const output = {
        experiment: "e2-what-to-ask",
        question:
            "With a keyword search that returns 20 results a page and mixes targets with everything else, which word and page should the next request ask?",
        budgets: BUDGETS,
        seedsPerStochasticPolicy: SEEDS,
        costModel: "One page of 20 results costs 1.",
        segments,
        overall,
    };
    const here = path.dirname(fileURLToPath(import.meta.url));
    const outDir = path.resolve(here, "..", "results");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "e2-what-to-ask.json"), `${JSON.stringify(output, null, 2)}\n`);

    for (const s of segments) {
        console.log(
            `\n== ${s.label}: ${s.population.targetClass} in the class; recorded pages reach ${s.population.reachable} (${s.population.reachableShare}); ${s.population.targetShareOfResults} of results are targets`
        );
        console.log(
            `   today (each of ${s.today.requests} planned words once): ${s.today.targetsFound} targets`
        );
        printPolicyTable(s.policies, BUDGETS, COVERAGE_MARKS);
    }
    console.log("\ntargets found relative to the fixed-order plan (mean over segments):");
    for (const row of overall) console.log("  ", JSON.stringify(row));
}

main();
