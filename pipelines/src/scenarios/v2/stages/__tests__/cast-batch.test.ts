/**
 * The grounding fixtures (design §3.4, §7.1). E1: "Maya recommends
 * Northwind's software purchases; Lee approves them." (contacts.pdf v3 p2).
 * E2: "Northwind uses Acme Legacy. Migration requires approximately fourteen
 * days." (renewal.pdf v5 p4).
 */
import { describe, expect, it } from "vitest";

import type { ActorContext, CastBatchOutput, CastSlot } from "../../contracts";
import { buildActorContext } from "../actor-context";
import { validateMember } from "../cast-batch";
import { finalizeManifest } from "../sources";
import {
    groundingCollection,
    makeHarness,
    operationsMember,
    runAll,
    runScript,
    runUnit,
    scriptedModel,
    slotBlocks,
    type Harness,
} from "./harness";

const operations: CastSlot = {
    slotId: "s01",
    segment: "operations lead at a mid-size customer",
    stanceTarget: -1,
    query: "operations software purchases migration",
};

function contextFrom(withE2: boolean): ActorContext {
    const c = groundingCollection();
    if (!withE2) c.sections.pop();
    const items = finalizeManifest(
        c,
        { perDocumentTokens: 4_000, totalTokens: 20_000, maxSections: 120 },
        { collector: "t", capturedAt: new Date("2026-11-12T00:00:00Z") }
    ).items;
    return buildActorContext({
        slot: operations,
        subject: "Acme moves Northwind to Acme Cloud",
        items,
        mode: "passage",
        cap: 1_200,
        policyVersion: "actor-context@1",
    });
}

describe("grounded cast fields", () => {
    it("grounds an operations slot in E1 and E2, and keeps budget unknown", () => {
        const context = contextFrom(true);
        const { member, errors } = validateMember(
            { ...operationsMember("s01", ["E1", "E2"]), stance: 2 },
            operations,
            context,
            0
        );
        expect(errors).toEqual([]);
        expect(member!.attributes.currentSolution).toEqual({
            value: "Acme Legacy",
            basis: "source",
            evidenceIds: ["E2"],
        });
        expect(member!.attributes.buyingRole).toEqual({
            value: "influences",
            basis: "source",
            evidenceIds: ["E1"],
        });
        expect(member!.attributes.switchingCost).toEqual({
            value: "high",
            basis: "inferred",
            evidenceIds: ["E2"],
            explanation: "A migration of approximately fourteen days is a large switch.",
        });
        expect(member!.attributes.budget).toEqual({
            value: null,
            basis: "unknown",
            evidenceIds: [],
        });

        const p = member!.persona;
        expect(p.currentSolution).toBe("Acme Legacy");
        expect(p.buyingRole).toBe("influences");
        expect(p.switchingCost).toBe("high");
        expect("budget" in p).toBe(false);
        // The stance is the slot's, whatever the model wrote.
        expect(p.stance).toBe(-1);
        expect(p.slotId).toBe("s01");
        expect(p.grounding).toBe("grounded");
        expect(p.sourceIds).toEqual(["E1", "E2"]);
        expect(p.knows).toEqual(
            expect.arrayContaining(["Migration requires approximately fourteen days."])
        );
        expect(p.knows!.length).toBeLessThanOrEqual(5);
    });

    it("rejects citations to evidence the slot was not shown (E2 removed)", () => {
        const context = contextFrom(false);
        expect(context.selected.evidenceIds).toEqual(["E1"]);
        const { member, errors } = validateMember(
            operationsMember("s01", ["E1", "E2"]),
            operations,
            context,
            0
        );
        expect(member).toBeUndefined();
        expect(errors).toEqual([
            "currentSolution cites E2, which is not in s01's evidence.",
            "switchingCost cites E2, which is not in s01's evidence.",
        ]);
    });

    it("checks bases, explanations, enums and names", () => {
        const context = contextFrom(true);
        const reply = {
            ...operationsMember("s01", ["E1", "E2"]),
            name: "Maya Brooks",
            buyingRole: {
                value: "approves",
                basis: "source",
                evidenceIds: ["E1"],
                explanation: null,
            },
            switchingCost: {
                value: "high",
                basis: "inferred",
                evidenceIds: ["E2"],
                explanation: null,
            },
            currentSolution: {
                value: null,
                basis: "source",
                evidenceIds: ["E2"],
                explanation: null,
            },
            objection: { value: "Too slow.", basis: "guess", evidenceIds: [], explanation: null },
        };
        expect(validateMember(reply, operations, context, 0).errors).toEqual([
            'name "Maya Brooks" uses "Maya" from the evidence; invent a name for this composite person.',
            'currentSolution is source but has no value; use basis "unknown" instead.',
            'buyingRole is "approves"; it must be one of decides, influences, uses.',
            "switchingCost is inferred but gives no explanation.",
            'objection has basis "guess"; use source, inferred, assumed or unknown.',
        ]);
    });

    it("nulls unknown values and drops citations from assumptions", () => {
        const context = contextFrom(true);
        const { member } = validateMember(
            {
                ...operationsMember("s01", ["E1", "E2"]),
                budget: {
                    value: "funded",
                    basis: "unknown",
                    evidenceIds: ["E1"],
                    explanation: "x",
                },
                objection: {
                    value: "Who pays for the two weeks?",
                    basis: "assumed",
                    evidenceIds: ["E2"],
                    explanation: "The slot starts against.",
                },
            },
            operations,
            context,
            0
        );
        expect(member!.attributes.budget).toEqual({
            value: null,
            basis: "unknown",
            evidenceIds: [],
        });
        expect(member!.attributes.objection).toEqual({
            value: "Who pays for the two weeks?",
            basis: "assumed",
            evidenceIds: [],
            explanation: "The slot starts against.",
        });
    });
});

async function toCastBatch(h: Harness): Promise<void> {
    await runAll(h, "actor-context:01");
}

describe("the cast batch stage", () => {
    it("repairs only the slots that failed, and keeps the rest", async () => {
        const h = makeHarness();
        let call = 0;
        h.model = scriptedModel(request => {
            if (request.purpose !== "cast_v2") return runScript(request);
            call += 1;
            const reply = runScript(request) as { members: Array<{ slotId: string }> };
            // First answer leaves s03 out.
            return call === 1 ? { members: reply.members.filter(m => m.slotId !== "s03") } : reply;
        });
        await toCastBatch(h);
        const result = await runUnit(h, "cast:batch:01");
        const out = result.output as CastBatchOutput;
        expect(out.repairs).toBe(1);
        expect(out.unfilled).toEqual([]);
        expect(out.members.map(m => m.slotId)).toEqual(["s01", "s02", "s03", "s04"]);
        const repair = h.model.requests.filter(r => r.purpose === "cast_v2")[1]!;
        expect([...slotBlocks(repair.prompt).keys()]).toEqual(["s03"]);
        expect(repair.prompt).toContain("No member came back for s03.");
    });

    it("with E2 gone, sends the bad citations back and accepts unknown instead", async () => {
        const h = makeHarness();
        h.collection.sections.pop(); // no renewal.pdf
        let call = 0;
        h.model = scriptedModel(request => {
            if (request.purpose !== "cast_v2") return runScript(request);
            call += 1;
            const blocks = [...slotBlocks(request.prompt)];
            return {
                members: blocks.map(([slotId, ids], i) => ({
                    // First answer cites E2 anyway; the repair keeps to what each slot was shown.
                    ...operationsMember(slotId, call === 1 ? ["E1", "E2"] : ids),
                    name: `Riley Stone-${slotId}-${i}`,
                })),
            };
        });
        await toCastBatch(h);
        const out = (await runUnit(h, "cast:batch:01")).output as CastBatchOutput;
        expect(out.repairs).toBe(1);
        expect(out.unfilled).toEqual([]);
        const repair = h.model.requests.filter(r => r.purpose === "cast_v2")[1]!;
        expect(repair.prompt).toContain(
            "currentSolution cites E2, which is not in s01's evidence."
        );
        for (const m of out.members) {
            expect(m.attributes.currentSolution).toEqual({
                value: null,
                basis: "unknown",
                evidenceIds: [],
            });
            expect(m.attributes.switchingCost.basis).toBe("unknown");
            expect(m.attributes.buyingRole).toMatchObject({ basis: "source", evidenceIds: ["E1"] });
            expect(m.persona.currentSolution).toBeUndefined();
            expect(m.persona.switchingCost).toBeUndefined();
        }
    });

    it("lists slots still invalid after the repair allowance as unfilled", async () => {
        const h = makeHarness();
        h.collection.sections.pop();
        h.model = scriptedModel(request =>
            request.purpose === "cast_v2"
                ? {
                      members: [...slotBlocks(request.prompt)].map(([slotId], i) => ({
                          ...operationsMember(slotId, ["E1", "E2"]),
                          name: `Casey Hart-${slotId}-${i}`,
                      })),
                  }
                : runScript(request)
        );
        await toCastBatch(h);
        const out = (await runUnit(h, "cast:batch:01")).output as CastBatchOutput & {
            problems: Record<string, string[]>;
        };
        expect(h.model.requests.filter(r => r.purpose === "cast_v2")).toHaveLength(
            1 + h.spec.budget.repairsPerUnit
        );
        expect(out.members).toEqual([]);
        expect(out.unfilled).toEqual(["s01", "s02", "s03", "s04"]);
        expect(out.problems.s01).toContain(
            "currentSolution cites E2, which is not in s01's evidence."
        );
        // Too few people to run: world:freeze refuses.
        await expect(runUnit(h, "world:freeze")).rejects.toThrow("Only 0 people");
    });

    it("gives each slot its own evidence block, and says displayed people are composites", async () => {
        const h = makeHarness();
        await toCastBatch(h);
        await runUnit(h, "cast:batch:01");
        const request = h.model.requests.find(r => r.purpose === "cast_v2")!;
        expect(request.system).toContain("composite, fictional people");
        expect(request.system).toContain("Keep unknowns unknown");
        expect(request.system).toContain("Keep approximate values approximate");
        expect([...slotBlocks(request.prompt).keys()]).toEqual(["s01", "s02", "s03", "s04"]);
        expect(request.prompt).toContain("Evidence for s01 only:");
    });
});
