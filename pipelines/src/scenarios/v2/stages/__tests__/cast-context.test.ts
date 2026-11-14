import { mixCounts, REALISTIC_MIX } from "@launchstack/simulation";
import { describe, expect, it } from "vitest";

import type { CastPlan, CastSlot, EvidenceSnapshot, SnapshotEdge } from "../../contracts";
import { approxTokens, hashOf } from "../../hash";
import { buildActorContext, supportedHits } from "../actor-context";
import { FALLBACK_SEGMENTS } from "../common";
import { stanceTargets } from "../cast-plan";
import { finalizeManifest } from "../sources";
import {
    fakeGraph,
    groundingCollection,
    groundingExtraction,
    makeHarness,
    runAll,
    runScript,
    runUnit,
    scriptedModel,
    section,
} from "./harness";

const at = new Date("2026-11-12T09:30:00Z");

function items(extra: string[] = []): EvidenceSnapshot[] {
    const c = groundingCollection();
    for (const [i, text] of extra.entries())
        c.sections.push(section({ text, sourceId: String(20 + i), documentIds: [20 + i] }));
    return finalizeManifest(
        c,
        { perDocumentTokens: 100_000, totalTokens: 100_000, maxSections: 500 },
        { collector: "t", capturedAt: at }
    ).items;
}

const operations: CastSlot = {
    slotId: "s01",
    segment: "operations lead at a mid-size customer",
    stanceTarget: -1,
    query: "migration effort for operations",
};

describe("cast:plan", () => {
    it("draws starting stances from the realistic mix, spread through the slots", () => {
        for (const n of [1, 4, 10, 25, 37]) {
            const stances = stanceTargets(n);
            const want = mixCounts(n, REALISTIC_MIX);
            expect(stances.filter(s => s < 0)).toHaveLength(want.against);
            expect(stances.filter(s => s === 0)).toHaveLength(want.undecided);
            expect(stances.filter(s => s > 0)).toHaveLength(want.inFavour);
            expect(stanceTargets(n)).toEqual(stances);
        }
        // Each batch of ten gets its share instead of all the critics landing in the first.
        const first = stanceTargets(30).slice(0, 10);
        expect(first.filter(s => s < 0).length).toBeGreaterThanOrEqual(3);
        expect(first.filter(s => s > 0).length).toBeGreaterThanOrEqual(2);
    });

    it("takes the model's segments and queries, never its stances, and fills gaps", async () => {
        const h = makeHarness();
        h.model = scriptedModel(request =>
            request.purpose === "cast_plan"
                ? {
                      slots: [
                          { slotId: "s02", segment: "finance approver", query: "who approves" },
                          { slotId: "s99", segment: "nobody", query: "x" },
                          { slotId: "s02", segment: "duplicate", query: "y" },
                      ],
                  }
                : runScript(request)
        );
        await runUnit(h, "sources");
        await runUnit(h, "brief");
        await runUnit(h, "cast:plan");
        const plan = h.artifacts.outputs.get("cast:plan") as CastPlan;
        expect(plan.mix).toEqual(REALISTIC_MIX);
        expect(plan.slots.map(s => s.slotId)).toEqual(["s01", "s02", "s03", "s04"]);
        expect(plan.slots.map(s => s.stanceTarget)).toEqual(stanceTargets(4));
        expect(plan.slots[1]).toMatchObject({ segment: "finance approver", query: "who approves" });
        expect(plan.slots[0]!.segment).toBe(FALLBACK_SEGMENTS[0]);
        expect(plan.slots[2]!.segment).toBe(FALLBACK_SEGMENTS[2]);
        expect(plan.slots[0]!.query).toContain(h.spec.subject.slice(0, 40));
        const prompt = h.model.requests.find(r => r.purpose === "cast_plan")!.prompt;
        expect(prompt).toContain("s01: starts against");
        expect(prompt).toContain("[E2] (document) renewal.pdf, page 4");
    });
});

describe("actor contexts", () => {
    it("ranks passages lexically for the slot (passage mode)", () => {
        const ctx = buildActorContext({
            slot: operations,
            subject: "Renewal",
            items: items(["The cafeteria menu changes weekly."]),
            mode: "passage",
            cap: 1_200,
            policyVersion: "actor-context@1",
        });
        expect(ctx.passages.map(p => p.evidenceId)).toEqual(["E2", "E1", "E3"]);
        expect(ctx.facts).toEqual([]);
        expect(ctx.selected.evidenceIds).toEqual(["E1", "E2", "E3"]);
        expect(ctx.graphSnapshotId).toBeNull();
        const { contextHash, ...body } = ctx;
        expect(contextHash).toBe(hashOf(body));
    });

    it("puts typed company facts first in facts mode", () => {
        const c = groundingCollection();
        c.sections.push(
            section({
                kind: "company_profile",
                sourceType: "company_fact",
                sourceId: "customers[0]",
                label: "Company profile: Northwind",
                text: "Customer — Northwind. migration window: two weeks.",
                fact: {
                    key: "customers[0]",
                    label: "Northwind",
                    value: "migration window: two weeks",
                    sourceDocumentIds: [8],
                },
                validity: "unknown",
                score: 0.2,
            })
        );
        const all = finalizeManifest(
            c,
            { perDocumentTokens: 9e9, totalTokens: 9e9, maxSections: 99 },
            {
                collector: "t",
                capturedAt: at,
            }
        ).items;
        const ctx = buildActorContext({
            slot: operations,
            subject: "Renewal",
            items: all,
            mode: "facts",
            cap: 1_200,
            policyVersion: "actor-context@1",
        });
        const factItem = all.find(i => i.fact)!;
        expect(ctx.facts).toEqual([
            { id: "fact:customers[0]", text: factItem.quote, evidenceIds: [factItem.id] },
        ]);
        expect(ctx.passages.map(p => p.evidenceId)).not.toContain(factItem.id);
        expect(ctx.selected.evidenceIds).toEqual(["E1", "E2", "E3"]);
    });

    it("holds every context to the actor token cap, whatever the mode", () => {
        const many = items(
            Array.from({ length: 30 }, (_, i) => `Migration note ${i}. ${"operations ".repeat(60)}`)
        );
        for (const cap of [40, 120, 333, 800, 1_200])
            for (const mode of ["passage", "facts"] as const) {
                const ctx = buildActorContext({
                    slot: operations,
                    subject: "Renewal",
                    items: many,
                    mode,
                    cap,
                    policyVersion: "actor-context@1",
                });
                const counted =
                    ctx.facts.reduce((s, f) => s + approxTokens(f.text), 0) +
                    ctx.passages.reduce((s, p) => s + approxTokens(p.text), 0);
                expect(counted).toBe(ctx.tokens);
                expect(ctx.tokens).toBeLessThanOrEqual(cap);
                expect(ctx.passages.length).toBeGreaterThan(0);
            }
    });

    it("keeps only graph hits that are in the frozen snapshot and supported, best first", () => {
        const edge = (uuid: string, supported: boolean): SnapshotEdge => ({
            uuid,
            name: "USES",
            fact: `fact ${uuid}`,
            sourceUuid: "n1",
            targetUuid: "n2",
            episodeUuids: [],
            validAt: null,
            invalidAt: null,
            attributes: {},
            evidenceIds: ["E2"],
            supported,
        });
        const snapshot = [edge("b", true), edge("a", true), edge("c", false)];
        const kept = supportedHits(
            [
                { edge: { uuid: "c" }, score: 9 },
                { edge: { uuid: "b" }, score: 2 },
                { edge: { uuid: "a" }, score: 2 },
                { edge: { uuid: "zz-not-frozen" }, score: 5 },
            ],
            snapshot
        );
        expect(kept.map(e => e.uuid)).toEqual(["a", "b"]);
    });

    it("builds graph contexts from supported facts and their passages, with zero model calls", async () => {
        const graph = fakeGraph(groundingExtraction);
        const h = makeHarness({ spec: { contextMode: "graph" }, graph: graph.port });
        await runAll(h, "actor-context:01");
        const calls = h.model.requests.length;
        expect(h.model.requests.map(r => r.purpose)).toEqual(["brief", "ontology", "cast_plan"]);
        const ctx = h.artifacts.contexts.get("s01")!;
        expect(ctx.mode).toBe("graph");
        expect(ctx.graphSnapshotId).toBe([...h.artifacts.snapshots.values()][0]!.id);
        expect(ctx.selected.edgeIds).not.toContain("e-maya-uses");
        expect(ctx.facts.map(f => f.id)).toEqual(ctx.selected.edgeIds);
        expect(ctx.facts.length).toBeGreaterThan(0);
        // The passages behind the facts come first.
        const behind = new Set(ctx.facts.flatMap(f => f.evidenceIds));
        expect(behind.has(ctx.passages[0]!.evidenceId)).toBe(true);
        expect(graph.calls.search).toBe(4);
        expect(h.model.requests.length).toBe(calls);
    });
});
