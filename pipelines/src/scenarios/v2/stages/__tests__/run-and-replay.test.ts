/**
 * A whole v2 run through every stage (passage, facts and graph modes), then
 * recorded replay: zero model calls and every round's state hash matches;
 * a changed reply, an unrecorded request or an unknown engine does not.
 */
import { describe, expect, it } from "vitest";

import type { ContextMode, RoundCheckpoint } from "../../contracts";
import { requestHash, stateHash } from "../../hash";
import { replayRun } from "../../replay";
import { V2_STAGES } from "../index";
import {
    contextFor,
    fakeGraph,
    groundingCollection,
    groundingExtraction,
    makeHarness,
    runAll,
    runUnit,
    section,
    type Harness,
} from "./harness";

function factsCollection() {
    const c = groundingCollection();
    c.sections.push(
        section({
            kind: "company_profile",
            sourceType: "company_fact",
            sourceId: "customers[0]",
            versionId: null,
            label: "Company profile: Northwind",
            text: "Customer — Northwind. product: Acme Legacy; renewal: March.",
            fact: {
                key: "customers[0]",
                label: "Northwind",
                value: "product: Acme Legacy; renewal: March",
                sourceDocumentIds: [8],
            },
            validity: "unknown",
            documentIds: [8],
            href: null,
            score: 0.5,
        })
    );
    return c;
}

async function finishedRun(mode: ContextMode): Promise<Harness & { graphCalls?: unknown }> {
    const graph = mode === "graph" ? fakeGraph(groundingExtraction) : null;
    const h = makeHarness({
        spec: { contextMode: mode },
        graph: graph?.port ?? null,
        collection: mode === "facts" ? factsCollection() : groundingCollection(),
    });
    h.artifacts.injections.push({
        id: 9,
        text: "Acme offers a free migration week.",
        appliedRound: null,
    });
    await runAll(h);
    return h;
}

describe("a v2 run end to end", () => {
    it.each<ContextMode>(["passage", "facts", "graph"])(
        "runs every unit in %s mode and finishes with a report",
        async mode => {
            const h = await finishedRun(mode);
            expect(h.run.status).toBe("done");
            expect(h.run.report?.headline).toBe("Operations leads resist a rushed migration");
            expect(h.artifacts.saved.map(c => c.round)).toEqual([1, 2]);

            const purposes = h.model.requests.map(r => r.purpose);
            expect(purposes.filter(p => p === "ontology")).toHaveLength(mode === "graph" ? 1 : 0);
            expect(purposes.filter(p => p === "brief")).toHaveLength(1);
            expect(purposes.filter(p => p === "cast_plan")).toHaveLength(1);
            expect(purposes.filter(p => p === "cast_v2")).toHaveLength(1);
            expect(purposes.filter(p => p === "report")).toHaveLength(1);

            const spec = h.artifacts.world!.spec;
            expect(spec.contextMode).toBe(mode);
            expect(spec.network).toEqual({
                basis: "engine_seeded",
                follows: h.artifacts.world!.initialWorld.follows.length,
            });
            expect(spec.ontologyHash === null).toBe(mode !== "graph");
            expect(spec.graphHash === null).toBe(mode !== "graph");
            expect(Object.keys(spec.contextHashes)).toEqual(["s01", "s02", "s03", "s04"]);
            expect(spec.cast).toEqual([
                { slotId: "s01", agentId: "a1" },
                { slotId: "s02", agentId: "a2" },
                { slotId: "s03", agentId: "a3" },
                { slotId: "s04", agentId: "a4" },
            ]);

            // v1 screens keep working off the run row.
            expect(h.run.evidence?.map(e => e.id)).toEqual(
                mode === "facts" ? ["E1", "E2", "E3"] : ["E1", "E2"]
            );
            // Citations in the order the brief makes them.
            expect(h.run.brief?.evidenceIds).toEqual(["E2", "E1"]);
            expect(h.run.world?.round).toBe(2);
            expect(h.run.flags).toMatchObject({
                omittedSources: 0,
                unfilledSlots: 0,
                degradedRounds: [],
                skippedTurns: 0,
            });
        }
    );

    it("closes events before the final round reads them, and applies each event once", async () => {
        const h = await finishedRun("passage");
        // Round 1 reads pending events; round 2 (the last) closes the window first.
        expect(h.artifacts.log).toEqual(["pendingInjections", "closeEvents", "pendingInjections"]);
        expect(h.artifacts.saved[0]!.interventions).toEqual([
            { id: 9, text: "Acme offers a free migration week." },
        ]);
        expect(h.artifacts.saved[1]!.interventions).toEqual([]);
        expect(h.artifacts.injections[0]!.appliedRound).toBe(1);
    });

    it("records every turn in world agent order with its request hash", async () => {
        const h = await finishedRun("passage");
        for (const checkpoint of h.artifacts.saved) {
            const order = h.run.world!.agents.map(a => a.persona.id);
            const agents = checkpoint.turns.map(t => t.agentId);
            expect(agents).toEqual(order.filter(id => agents.includes(id)));
            expect(checkpoint.turns.every(t => /^[0-9a-f]{64}$/.test(t.requestHash))).toBe(true);
            expect(checkpoint.turns.length).toBe(checkpoint.summary.active);
            expect(checkpoint.degraded).toBe(false);
        }
        expect(h.artifacts.saved[1]!.stateHash).toBe(stateHash(h.run.world!));
    });
});

describe("retries", () => {
    it.each<ContextMode>(["passage", "graph"])(
        "a %s unit run again before it commits sends the same requests, so the journal can serve them",
        async mode => {
            const graph = mode === "graph" ? fakeGraph(groundingExtraction) : null;
            const h = makeHarness({ spec: { contextMode: mode }, graph: graph?.port ?? null });
            for (;;) {
                const next = h.plan
                    .filter(u => !h.committed.has(u.key))
                    .filter(u =>
                        u.dependsOn.every(d =>
                            d.endsWith("*")
                                ? h.plan
                                      .filter(p => p.key.startsWith(d.slice(0, -1)))
                                      .every(p => h.committed.has(p.key))
                                : h.committed.has(d)
                        )
                    )
                    .sort((a, b) => a.seq - b.seq)[0];
                if (!next) break;
                const before = h.model.requests.length;
                // A crash after the model calls, before the commit: the attempt is thrown away.
                await V2_STAGES[next.kind](contextFor(h, next));
                const first = h.model.requests.slice(before).map(r => requestHash(r));
                const mid = h.model.requests.length;
                await runUnit(h, next.key);
                const second = h.model.requests.slice(mid).map(r => requestHash(r));
                expect(second).toEqual(first);
            }
            expect(h.run.status).toBe("done");
        }
    );
});

describe("recorded replay", () => {
    it.each<ContextMode>(["passage", "graph"])(
        "replays a finished %s run with zero model calls and every hash matching",
        async mode => {
            const h = await finishedRun(mode);
            const calls = h.model.requests.length;
            const result = await replayRun(h.artifacts.world!, h.artifacts.saved);
            expect(h.model.requests.length).toBe(calls);
            expect(result.modelCalls).toBe(0);
            expect(result.available).toBe(true);
            expect(result.reason).toBeNull();
            expect(result.rounds.map(r => [r.round, r.matches])).toEqual([
                [0, true],
                [1, true],
                [2, true],
            ]);
            expect(result.matches).toBe(true);
        }
    );

    it("reports a mismatch when a recorded reply changed", async () => {
        const h = await finishedRun("passage");
        const checkpoints: RoundCheckpoint[] = structuredClone(h.artifacts.saved);
        const turn = checkpoints[0]!.turns.find(t => t.reply)!;
        const reply = JSON.parse(turn.reply!.text) as Record<string, unknown>;
        turn.reply = {
            text: JSON.stringify({
                ...reply,
                actions: [{ type: "create_post", postId: null, text: "Changed.", handle: null }],
            }),
        };
        const result = await replayRun(h.artifacts.world!, checkpoints);
        expect(result.available).toBe(true);
        expect(result.matches).toBe(false);
        expect(result.rounds[1]).toMatchObject({ round: 1, matches: false });
    });

    it("treats a request the record does not hold as a mismatch, without calling a model", async () => {
        const h = await finishedRun("passage");
        const checkpoints: RoundCheckpoint[] = structuredClone(h.artifacts.saved);
        checkpoints[1]!.turns[0]!.requestHash = "0".repeat(64);
        const calls = h.model.requests.length;
        const result = await replayRun(h.artifacts.world!, checkpoints);
        expect(h.model.requests.length).toBe(calls);
        expect(result.rounds[2]).toMatchObject({ round: 2, matches: false });
        expect(result.matches).toBe(false);
    });

    it("refuses an engine version it cannot replay, and an unfinished record", async () => {
        const h = await finishedRun("passage");
        const old = structuredClone(h.artifacts.saved);
        old[0]!.engineVersion = "simulation@0";
        await expect(replayRun(h.artifacts.world!, old)).resolves.toMatchObject({
            available: false,
            reason: "replay_unavailable",
            modelCalls: 0,
        });
        await expect(
            replayRun(h.artifacts.world!, h.artifacts.saved.slice(1))
        ).resolves.toMatchObject({ available: false, reason: "not_finished" });
    });
});
