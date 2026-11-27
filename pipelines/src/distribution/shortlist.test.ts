import { describe, expect, it } from "vitest";

import { createShortlistLearner } from "./learn";
import type { FitVerdict } from "./semantic";
import { fillShortlist, LEARNING_ROUND, segmentKey, type ShortlistCandidate } from "./shortlist";
import type { PartnerKind } from "./types";

const candidates = (count: number): ShortlistCandidate[] =>
    Array.from({ length: count }, (_, i) => ({ id: `c${i}`, name: `Company ${i}`, text: `c${i}` }));

/** A judge that answers from a rule and remembers what each round asked. */
function judgeBy(fit: (id: string) => boolean | undefined) {
    const rounds: string[][] = [];
    const judge = async (batch: ShortlistCandidate[]): Promise<Map<string, FitVerdict>> => {
        rounds.push(batch.map(c => c.id));
        const out = new Map<string, FitVerdict>();
        for (const c of batch) {
            const verdict = fit(c.id);
            if (verdict !== undefined) out.set(c.id, { fit: verdict, reason: verdict ? "" : "no" });
        }
        return out;
    };
    return { judge, rounds };
}

describe("segmentKey", () => {
    const segment = {
        offering: "Picking robots for fulfilment warehouses",
        categories: ["fulfilment", "3PL"],
        constraints: null,
        partnerKinds: ["distributor", "retailer"] as PartnerKind[],
        targetTerritories: [{ country: "NL" }, { country: "BE", region: "Flanders" }],
    };

    it("is the same for the same question, however it is written down", () => {
        expect(segmentKey(segment)).toBe(
            segmentKey({ ...segment, offering: `  ${segment.offering}\n`, constraints: "" })
        );
        // Lists are sets: another order, or an entry given twice, asks the same thing.
        expect(segmentKey(segment)).toBe(
            segmentKey({
                ...segment,
                categories: ["3PL", "fulfilment", "3PL"],
                partnerKinds: ["retailer", "distributor", "retailer"],
                targetTerritories: [
                    { country: "BE", region: "Flanders" },
                    { country: "NL" },
                    { country: "NL" },
                ],
            })
        );
        expect(segmentKey(segment)).toMatch(/^[0-9a-f]{32}$/);
    });

    it("changes when what is sold, who buys it, what rules a company out or where changes", () => {
        const keys = new Set([
            segmentKey(segment),
            segmentKey({ ...segment, offering: "Shelving for fulfilment warehouses" }),
            segmentKey({ ...segment, categories: ["fulfilment"] }),
            segmentKey({ ...segment, constraints: "No companies under ten people" }),
            segmentKey({ ...segment, partnerKinds: ["distributor"] }),
            segmentKey({ ...segment, targetTerritories: [{ country: "BE" }] }),
            segmentKey({ ...segment, targetTerritories: [{ country: "NL" }, { country: "BE" }] }),
        ]);
        expect(keys.size).toBe(7);
    });

    it("is the run's own question when a run narrows the segment", () => {
        const narrowed = segmentKey(segment, {
            territories: [{ country: "NL" }],
            partnerKinds: ["distributor"],
        });
        expect(narrowed).not.toBe(segmentKey(segment));
        expect(narrowed).toBe(
            segmentKey({
                ...segment,
                targetTerritories: [{ country: "NL" }],
                partnerKinds: ["distributor"],
            })
        );
        // Options that narrow nothing leave the segment's own key.
        expect(segmentKey(segment, { territories: [], partnerKinds: undefined })).toBe(
            segmentKey(segment)
        );
        expect(segmentKey(segment, null)).toBe(segmentKey(segment));
    });
});

describe("fillShortlist with the fixed ranking", () => {
    it("checks twice the open places per round, down the list, until the list is full", async () => {
        const { judge, rounds } = judgeBy(id => Number(id.slice(1)) % 2 === 0);
        const result = await fillShortlist({ queue: candidates(40), wanted: 5, judge });
        // Round 1: ten companies, five fit. The list is full.
        expect(rounds).toEqual([Array.from({ length: 10 }, (_, i) => `c${i}`)]);
        expect(result.kept).toBe(5);
        expect(result.rounds).toBe(1);
        expect(result.checked).toHaveLength(10);
    });

    it("goes on down the ranking after a round of no's", async () => {
        const { judge, rounds } = judgeBy(id => Number(id.slice(1)) >= 6);
        const result = await fillShortlist({ queue: candidates(12), wanted: 3, judge });
        expect(rounds.map(r => r.length)).toEqual([6, 6]);
        expect(result.kept).toBe(6);
        expect([...result.verdicts.values()].filter(v => !v.fit)).toHaveLength(6);
    });

    it("ends when nobody is left", async () => {
        const { judge } = judgeBy(() => false);
        const result = await fillShortlist({ queue: candidates(7), wanted: 5, judge });
        expect(result.checked).toHaveLength(7);
        expect(result.kept).toBe(0);
    });

    it("keeps a company the judge did not answer for", async () => {
        const { judge } = judgeBy(id => (id === "c1" ? undefined : false));
        const result = await fillShortlist({ queue: candidates(4), wanted: 2, judge });
        expect(result.kept).toBe(1);
        expect(result.verdicts.has("c1")).toBe(false);
        expect(result.checked).toContain("c1");
    });

    it("keeps what it saw when a round fails", async () => {
        let calls = 0;
        const result = await fillShortlist({
            queue: candidates(20),
            wanted: 4,
            judge: async batch => {
                calls += 1;
                if (calls === 2) throw new Error("model down");
                return new Map(batch.map(c => [c.id, { fit: false, reason: "no" }]));
            },
        });
        expect(result.error).toBeInstanceOf(Error);
        expect(result.checked).toHaveLength(8);
        expect(result.rounds).toBe(1);
    });
});

describe("fillShortlist with a learner", () => {
    /** Forty companies of two kinds; only the second kind fits, and relevance favours the first. */
    function pool() {
        const vectors: number[][] = [];
        const relevance: number[] = [];
        for (let i = 0; i < 40; i++) {
            const second = i >= 20;
            const v = Array.from({ length: 8 }, (_, a) => Math.sin(i * 7 + a * 3) * 0.2);
            v[second ? 1 : 0]! += 1;
            vectors.push(v);
            relevance.push(second ? 0.2 - (i - 20) * 0.001 : 0.3 - i * 0.001);
        }
        return { vectors, relevance, queue: candidates(40) };
    }
    const fits = (id: string): boolean => Number(id.slice(1)) >= 20;

    it("asks in small rounds and turns to the kind the verdicts favour", async () => {
        const { vectors, relevance, queue } = pool();
        const fixed = judgeBy(fits);
        const before = await fillShortlist({
            queue,
            wanted: 10,
            judge: fixed.judge,
            maxChecks: 30,
        });
        const learner = await createShortlistLearner({ vectors, relevance });
        const learning = judgeBy(fits);
        const after = await fillShortlist({
            queue,
            wanted: 10,
            judge: learning.judge,
            learner,
            maxChecks: 30,
        });
        expect(learning.rounds[0]).toHaveLength(LEARNING_ROUND);
        // The fixed ranking spends its first twenty checks on the kind that never fits.
        expect(before.kept).toBeLessThan(after.kept);
        // A round may overshoot the open places, as with the fixed ranking.
        expect(after.kept).toBeGreaterThanOrEqual(10);
        expect(after.checked.length).toBeLessThan(30);
        expect(learner.learnedFrom).toBe(after.checked.length);
    });

    it("shrinks the last rounds to twice the open places", async () => {
        const { vectors, relevance, queue } = pool();
        const learner = await createShortlistLearner({ vectors, relevance });
        const { judge, rounds } = judgeBy(() => true);
        await fillShortlist({ queue, wanted: 12, judge, learner });
        // Ten fit, then two places are open: four are asked, not ten.
        expect(rounds.map(r => r.length)).toEqual([10, 4]);
    });

    it("works through a higher area tier before touching a lower one", async () => {
        const { vectors, relevance, queue } = pool();
        const learner = await createShortlistLearner({ vectors, relevance });
        const { judge, rounds } = judgeBy(fits);
        // The first kind is confirmed in the area, the second is not.
        await fillShortlist({
            queue,
            wanted: 5,
            judge,
            learner,
            tierOf: index => (index < 20 ? 2 : 1),
        });
        const asked = rounds.flat().map(id => Number(id.slice(1)));
        const firstLow = asked.findIndex(i => i >= 20);
        expect(firstLow).toBe(20);
        expect(asked.slice(0, 20).every(i => i < 20)).toBe(true);
    });

    it("does not learn from a company the judge did not answer for", async () => {
        const { vectors, relevance, queue } = pool();
        const learner = await createShortlistLearner({ vectors, relevance });
        // Whoever is asked about first gets no answer.
        let unanswered: string | null = null;
        const { judge } = judgeBy(id => {
            unanswered ??= id;
            return id === unanswered ? undefined : fits(id);
        });
        const result = await fillShortlist({ queue, wanted: 3, judge, learner, maxChecks: 10 });
        expect(result.checked[0]).toBe(unanswered);
        expect(result.verdicts.has(unanswered!)).toBe(false);
        expect(learner.learnedFrom).toBe(result.checked.length - 1);
    });

    it("goes on down the fixed order when the learner has nobody to offer", async () => {
        const { vectors, relevance, queue } = pool();
        const real = await createShortlistLearner({ vectors, relevance });
        // A learner that ranks one round and then loses its footing.
        let calls = 0;
        const learner = {
            next: (count: number, among?: (index: number) => boolean) =>
                calls++ === 0 ? real.next(count, among) : [],
            observe: real.observe.bind(real),
            skip: real.skip.bind(real),
        };
        const { judge, rounds } = judgeBy(fits);
        const result = await fillShortlist({ queue, wanted: 10, judge, learner });

        expect(result.learnerQuit).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.kept).toBeGreaterThanOrEqual(10);
        // Nobody is asked about twice, and after the first round the order is the queue's.
        const asked = rounds.flat();
        expect(new Set(asked).size).toBe(asked.length);
        const later = rounds
            .slice(1)
            .flat()
            .map(id => Number(id.slice(1)));
        expect(later).toEqual([...later].sort((a, b) => a - b));
        const first = new Set(rounds[0]);
        expect(later[0]).toBe(queue.findIndex(c => !first.has(c.id)));
    });

    it("does not report a learner that simply ran out of companies", async () => {
        const { vectors, relevance, queue } = pool();
        const learner = await createShortlistLearner({ vectors, relevance });
        const { judge } = judgeBy(() => false);
        const result = await fillShortlist({ queue, wanted: 5, judge, learner });
        expect(result.checked).toHaveLength(queue.length);
        expect(result.learnerQuit).toBeUndefined();
    });
});
