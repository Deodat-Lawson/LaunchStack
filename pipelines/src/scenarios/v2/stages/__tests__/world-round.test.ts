import { buildInitialFollows, createRng, hashSeed } from "@launchstack/simulation";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { SCENARIO_SCHEMAS } from "../../../model";
import type { CastMember } from "../../contracts";
import { hashOf, stateHash } from "../../hash";
import { CAST_PLAN_SCHEMA, CAST_V2_SCHEMA, ONTOLOGY_SCHEMA } from "../prompts";
import { seatCast } from "../world";
import {
    fakeGraph,
    groundingExtraction,
    makeHarness,
    runAll,
    runScript,
    runUnit,
    scriptedModel,
} from "./harness";

function member(slotId: string, handle: string): CastMember {
    return {
        slotId,
        persona: {
            id: "x",
            name: `Person ${slotId}`,
            handle,
            role: "Operator",
            bio: "",
            interests: [],
            stance: 0,
            activity: 0.5,
            influence: 0.2,
            grounding: "invented",
            sourceIds: [],
        },
        attributes: {} as CastMember["attributes"],
    };
}

describe("world:freeze", () => {
    it("seats people in slot order as a1… with unique handles", () => {
        const seated = seatCast(
            [member("s03", "@jordan"), member("s01", "@jordan"), member("s02", "@newswire")],
            ["s01", "s02", "s03"]
        );
        expect(seated.map(p => [p.id, p.slotId, p.handle])).toEqual([
            ["a1", "s01", "@jordan"],
            ["a2", "s02", "@newswire2"],
            ["a3", "s03", "@jordan2"],
        ]);
    });

    it("never turns an employment edge into a follow: the starting network is the engine's", async () => {
        const graph = fakeGraph(groundingExtraction);
        const h = makeHarness({ spec: { contextMode: "graph" }, graph: graph.port });
        await runAll(h, "world:freeze");
        const snapshot = [...h.artifacts.snapshots.values()][0]!.data;
        expect(snapshot.edges.find(e => e.name === "WORKS_FOR")).toMatchObject({ supported: true });

        const world = h.artifacts.world!.initialWorld;
        const personas = world.agents.map(a => a.persona);
        expect(world.follows).toEqual(
            buildInitialFollows(personas, createRng(hashSeed(h.spec.seed, "follows")), 4)
        );
        expect(h.artifacts.world!.spec.network).toEqual({
            basis: "engine_seeded",
            follows: world.follows.length,
        });
    });

    it("freezes the hashes the world was built from", async () => {
        const h = makeHarness();
        await runAll(h, "world:freeze");
        const { spec, initialWorld } = h.artifacts.world!;
        const { specHash, ...body } = spec;
        expect(specHash).toBe(hashOf(body));
        expect(spec.requestSpecHash).toBe(hashOf(h.spec));
        expect(spec.manifestHash).toBe(h.artifacts.manifest!.manifestHash);
        expect(spec.initialStateHash).toBe(stateHash(initialWorld));
        expect(spec.contextHashes).toEqual(
            Object.fromEntries(
                [...h.artifacts.contexts.values()].map(c => [c.slotId, c.contextHash])
            )
        );
        expect(spec.versions).toEqual(h.spec.policies.versions);
        expect(spec.seeds).toEqual({ run: h.spec.seed });
        expect(h.run.world).toEqual(initialWorld);
        expect(initialWorld.posts[0]!.text).toBe(
            "Acme tells Northwind its Legacy contract will move to Acme Cloud at renewal."
        );
        expect(initialWorld.agents.every(a => a.persona.slotId)).toBe(true);
    });
});

describe("round", () => {
    it("records failed turns, marks a round degraded and keeps flags cumulative", async () => {
        const h = makeHarness();
        h.model = scriptedModel(request => {
            if (request.purpose === "decide" && /@jordan_s0[12]/.test(request.system))
                return new Error("provider timed out");
            const reply = runScript(request);
            // Everyone is loud, so all four act in round 1.
            if (request.purpose === "cast_v2")
                for (const m of (reply as { members: Array<{ activity: number }> }).members)
                    m.activity = 1;
            return reply;
        });
        // Two of four turns fail: more than a third (degraded), not more than half (failed).
        await runAll(h, "round:01");
        const [checkpoint] = h.artifacts.saved;
        expect(checkpoint!.summary.active).toBe(4);
        expect(checkpoint!.skipped).toEqual(["a1", "a2"]);
        expect(checkpoint!.degraded).toBe(true);
        expect(
            checkpoint!.turns.filter(t => t.error).map(t => [t.agentId, t.error, t.reply])
        ).toEqual([
            ["a1", "provider timed out", null],
            ["a2", "provider timed out", null],
        ]);
        expect(h.run.flags).toMatchObject({ degradedRounds: [1], skippedTurns: 2 });
    });

    it("refuses to run from a world that does not match the last checkpoint", async () => {
        const h = makeHarness();
        await runAll(h, "round:01");
        h.run.world!.posts[0]!.text = "Tampered.";
        await expect(runUnit(h, "round:02")).rejects.toThrow("does not match round 1");
    });
});

describe("the v2 reply schemas", () => {
    function zodKeys(schema: z.ZodTypeAny, path: string[] = []): string[] {
        let node = schema;
        for (const key of path) {
            node = (node as z.AnyZodObject).shape[key] as z.ZodTypeAny;
            if (node instanceof z.ZodArray) node = node.element as z.ZodTypeAny;
        }
        return Object.keys((node as z.AnyZodObject).shape).sort();
    }
    function jsonKeys(schema: Record<string, unknown>, path: string[] = []): string[] {
        let node = schema;
        for (const key of path) {
            node = (node.properties as Record<string, Record<string, unknown>>)[key]!;
            if (node.type === "array") node = node.items as Record<string, unknown>;
        }
        return [...(node.required as string[])].sort();
    }

    const JSON_SCHEMAS: Record<string, Record<string, unknown>> = {
        ontology: ONTOLOGY_SCHEMA,
        cast_plan: CAST_PLAN_SCHEMA,
        cast_v2: CAST_V2_SCHEMA,
    };
    it.each<[string, string]>([
        ["ontology", ""],
        ["ontology", "entities"],
        ["ontology", "edges"],
        ["ontology", "edges.endpoints"],
        ["ontology", "entities.attributes"],
        ["cast_plan", "slots"],
        ["cast_v2", "members"],
        ["cast_v2", "members.budget"],
        ["cast_v2", "members.role"],
    ])("mirror the %s reply at '%s'", (purpose, at) => {
        const path = at ? at.split(".") : [];
        const schema = SCENARIO_SCHEMAS[purpose as keyof typeof SCENARIO_SCHEMAS] as z.ZodTypeAny;
        expect(zodKeys(schema, path)).toEqual(jsonKeys(JSON_SCHEMAS[purpose]!, path));
    });

    it("accept a fixture reply in the zod mirror", () => {
        const reply = runScript({
            purpose: "cast_v2",
            system: "",
            prompt: "## Slot s01\nEvidence: E1 E2\nReturn one member",
            maxOutputTokens: 1,
        });
        expect(SCENARIO_SCHEMAS.cast_v2.safeParse(reply).success).toBe(true);
        expect(
            SCENARIO_SCHEMAS.ontology.safeParse(
                runScript({ purpose: "ontology", system: "", prompt: "", maxOutputTokens: 1 })
            ).success
        ).toBe(true);
    });
});
