import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { policySet } from "./bandits";
import {
    at,
    populationEstimates,
    simulate,
    simulateOracle,
    type DiscoveryEnv,
    type ResultItem,
    type TermCursor,
} from "./discovery";
import { NotRecordedError, Recorder } from "./recorder";
import { createRng, hashSeed } from "./rng";
import { bootstrapMean, mean, pairedDifference, quantile, sd } from "./stats";

describe("rng", () => {
    it("replays the same stream for the same seed", () => {
        const a = createRng(42);
        const b = createRng(42);
        expect(Array.from({ length: 5 }, () => a.next())).toEqual(
            Array.from({ length: 5 }, () => b.next())
        );
        expect(createRng(43).next()).not.toBe(createRng(42).next());
    });

    it("draws beta and gamma variates with the right means", () => {
        const rng = createRng(7);
        const betas = Array.from({ length: 4000 }, () => rng.beta(2, 6));
        const gammas = Array.from({ length: 4000 }, () => rng.gamma(0.5));
        expect(mean(betas)).toBeCloseTo(0.25, 1);
        expect(mean(gammas)).toBeCloseTo(0.5, 1);
        expect(Math.min(...betas)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...betas)).toBeLessThanOrEqual(1);
    });

    it("shuffles without losing items and hashes text stably", () => {
        const items = [1, 2, 3, 4, 5, 6];
        expect([...createRng(3).shuffle(items)].sort()).toEqual(items);
        expect(hashSeed("dk-bicycle|ucb1|0")).toBe(hashSeed("dk-bicycle|ucb1|0"));
        expect(hashSeed("a")).not.toBe(hashSeed("b"));
    });
});

describe("stats", () => {
    it("summarises a sample", () => {
        expect(mean([1, 2, 3, 4])).toBe(2.5);
        expect(sd([2, 2, 2])).toBe(0);
        expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    });

    it("puts the bootstrap interval around the mean", () => {
        const interval = bootstrapMean([4, 5, 6, 5, 4, 6, 5, 5], { seed: 1 });
        expect(interval.lo).toBeLessThanOrEqual(interval.mean);
        expect(interval.hi).toBeGreaterThanOrEqual(interval.mean);
        expect(bootstrapMean([3, 3, 3])).toMatchObject({ mean: 3, lo: 3, hi: 3 });
    });

    it("compares paired samples", () => {
        const diff = pairedDifference([5, 6, 7], [4, 6, 5]);
        expect(diff.mean).toBeCloseTo(1, 5);
        expect(diff.wins).toBeCloseTo(2 / 3, 5);
        expect(diff.ties).toBeCloseTo(1 / 3, 5);
        expect(() => pairedDifference([1], [1, 2])).toThrow();
    });
});

/**
 * A toy search interface: each word has pages of results; "rich" pays a lot,
 * "poor" pays nothing, and "alpha" only becomes askable once it has been seen
 * in found names.
 */
function toyEnv(): DiscoveryEnv {
    const item = (id: string, name: string, target = true): ResultItem => ({ id, name, target });
    const pages: Record<string, ResultItem[][]> = {
        rich: [
            [item("1", "rich alpha one"), item("2", "rich alpha two"), item("3", "rich three")],
            [item("4", "rich four"), item("5", "rich five")],
        ],
        poor: [[item("x", "poor thing", false)], [item("y", "poor other", false)]],
        alpha: [[item("1", "rich alpha one"), item("6", "alpha six"), item("7", "alpha seven")]],
    };
    const open = (term: string): TermCursor => {
        let next = 0;
        const all = pages[term] ?? [];
        return {
            pending: () => all.length - next,
            peek: () => all[next] ?? null,
            next: () => all[next++] ?? [],
            complete: () => next >= all.length,
        };
    };
    return {
        cap: 3,
        planTerms: ["poor", "rich"],
        letterTerms: [],
        allTerms: () => Object.keys(pages),
        hasTerm: term => pages[term] !== undefined,
        open,
        tokens: text => text.toLowerCase().split(/\s+/).filter(Boolean),
        wordMatches: (nameWord, queryWord) => nameWord === queryWord,
        keysOf: nameWord => [nameWord],
    };
}

describe("discovery simulation", () => {
    const policies = policySet({ cap: 3, letters: false });
    const byId = (id: string) => policies.find(p => p.id === id)!;

    it("plays the fixed plan in order, level by level", () => {
        const trace = simulate(toyEnv(), byId("plan-static"), { budget: 4, seed: 1 });
        // poor p1 (0), rich p1 (3), poor p2 (0), rich p2 (2)
        expect(trace.found).toEqual([0, 3, 3, 5]);
        expect(trace.wasted).toBe(2);
        expect(trace.wastedBy).toEqual([1, 1, 2, 2]);
    });

    it("stops when every arm has run dry", () => {
        const trace = simulate(toyEnv(), byId("plan-static"), { budget: 50, seed: 1 });
        expect(trace.requests).toBe(4);
        expect(at(trace.found, 50)).toBe(5);
    });

    it("lets only feedback policies ask a word mined from found names", () => {
        const plain = simulate(toyEnv(), byId("thompson"), { budget: 50, seed: 3 });
        const feedback = simulate(toyEnv(), byId("mined-greedy"), { budget: 50, seed: 3 });
        expect(at(plain.found, 50)).toBe(5);
        expect(at(feedback.found, 50)).toBe(7);
    });

    it("is deterministic for a seed", () => {
        const a = simulate(toyEnv(), byId("mined-thompson"), { budget: 10, seed: 9 });
        const b = simulate(toyEnv(), byId("mined-thompson"), { budget: 10, seed: 9 });
        expect(a).toEqual(b);
    });

    it("gives an oracle no learning policy beats on this toy", () => {
        const oracle = simulateOracle(toyEnv(), 5);
        expect(oracle.found[0]).toBe(3);
        for (const policy of policies) {
            const trace = simulate(toyEnv(), policy, { budget: 5, seed: 5 });
            for (let i = 0; i < trace.found.length; i++)
                expect(trace.found[i]).toBeLessThanOrEqual(at(oracle.found, i + 1));
        }
    });

    it("never asks a word that a completed word already covers", () => {
        // A prefix interface: "a" returns everything "ab" would.
        const items: ResultItem[] = [
            { id: "1", name: "abc", target: true },
            { id: "2", name: "abd", target: true },
        ];
        const asked: string[] = [];
        const env: DiscoveryEnv = {
            cap: 5,
            planTerms: ["a", "ab"],
            letterTerms: [],
            allTerms: () => ["a", "ab"],
            hasTerm: () => true,
            open: term => {
                let done = false;
                return {
                    pending: () => (done ? 0 : 1),
                    peek: () => (done ? null : items),
                    next: () => {
                        done = true;
                        asked.push(term);
                        return items;
                    },
                    complete: () => done,
                };
            },
            tokens: text => [text.toLowerCase()],
            wordMatches: (nameWord, queryWord) => nameWord.startsWith(queryWord),
            keysOf: nameWord => [nameWord],
        };
        const greedy = policySet({ cap: 5, letters: false }).find(p => p.id === "mined-greedy")!;
        // Seeds until "a" is asked first; "ab" must then never be asked.
        for (let seed = 1; seed < 20; seed++) {
            asked.length = 0;
            simulate(env, greedy, { budget: 5, seed });
            if (asked[0] === "a") expect(asked).toEqual(["a"]);
        }
        // The fixed plan is not allowed that inference: it asks both.
        asked.length = 0;
        simulate(env, policySet({ cap: 5, letters: false })[0]!, { budget: 5, seed: 1 });
        expect(asked).toEqual(["a", "ab"]);
    });

    it("estimates a population from capture counts", () => {
        // 4 seen once, 2 seen twice: Chao1 = 6 + 4*3 / (2*3) = 8; coverage = 1 - 4/8.
        const captures = new Map([
            ["a", 1],
            ["b", 1],
            ["c", 1],
            ["d", 1],
            ["e", 2],
            ["f", 2],
        ]);
        expect(populationEstimates(captures)).toEqual({ chao1: 8, coverage: 0.5 });
    });
});

describe("recorder", () => {
    let dir: string;
    let url: string;
    let hits = 0;
    const server = createServer((request, response) => {
        hits += 1;
        if (request.url === "/missing") {
            response.writeHead(404, { "content-type": "text/plain" });
            response.end("nope");
            return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ agent: request.headers["user-agent"], n: hits }));
    });

    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), "bench-recorder-"));
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
    });

    it("sends a request once, then replays it without the network", async () => {
        const recording = new Recorder({ dir, mode: "record", minDelayMs: 0 });
        const first = await recording.getJson<{ agent: string; n: number }>(`${url}/a`);
        const second = await recording.getJson<{ agent: string; n: number }>(`${url}/a`);
        expect(first.agent).toContain("company-search-bench");
        expect(second).toEqual(first);
        expect(recording.live).toBe(1);
        expect(recording.replayed).toBe(1);

        const replay = new Recorder({ dir, mode: "replay" });
        expect(await replay.getJson(`${url}/a`)).toEqual(first);
        await expect(replay.getJson(`${url}/never-asked`)).rejects.toBeInstanceOf(NotRecordedError);
        expect(hits).toBe(1);
    });

    it("records failures and replays them as failures", async () => {
        const recording = new Recorder({ dir, mode: "record", minDelayMs: 0 });
        const response = await recording.fetchImpl(`${url}/missing`);
        expect(response.status).toBe(404);
        const replayed = await new Recorder({ dir, mode: "replay" }).fetchImpl(`${url}/missing`);
        expect(replayed.status).toBe(404);
        expect(await replayed.text()).toBe("nope");
    });
});

describe("result files", () => {
    it("keeps lists of plain values on one line and stays valid JSON", async () => {
        const { stringifyResults } = await import("./json");
        const value = {
            curve: [1, 2.5, 3],
            words: ["a", 'b "c"'],
            nested: [{ x: [1, 2] }],
            empty: [],
        };
        const text = stringifyResults(value);
        expect(JSON.parse(text)).toEqual(value);
        expect(text).toContain('"curve": [1, 2.5, 3]');
        expect(text).toContain('"words": ["a", "b \\"c\\""]');
        expect(text.endsWith("\n")).toBe(true);
    });
});
