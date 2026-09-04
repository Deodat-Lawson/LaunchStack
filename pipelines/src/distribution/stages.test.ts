import { describe, expect, it } from "vitest";

import { ALLOWED_TRANSITIONS, assertTransition, isInPipeline, stageRequirements } from "./stages";
import { RELATIONSHIP_STAGES } from "./types";

const full = { ownerUserId: "u1", nextAction: "call", hasAgreement: true };
const empty = { ownerUserId: null, nextAction: null, hasAgreement: false };

describe("stage transition table", () => {
    it("covers every stage exactly once and never lists a self-move", () => {
        expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...RELATIONSHIP_STAGES].sort());
        for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
            expect(targets).not.toContain(from);
            for (const t of targets) expect(RELATIONSHIP_STAGES).toContain(t);
        }
    });

    it("allows the forward path with the fields filled in", () => {
        const path = [
            "candidate",
            "researched",
            "contacted",
            "in_conversation",
            "qualified",
            "negotiating",
            "contracted",
            "active",
        ] as const;
        for (let i = 0; i < path.length - 1; i++) {
            expect(() =>
                assertTransition({ from: path[i]!, to: path[i + 1]!, context: full })
            ).not.toThrow();
        }
    });

    it("forbids skipping and unknown moves", () => {
        expect(() =>
            assertTransition({ from: "candidate", to: "qualified", context: full })
        ).toThrow(/Cannot move/);
        expect(() => assertTransition({ from: "active", to: "candidate", context: full })).toThrow(
            /Cannot move/
        );
        expect(() =>
            assertTransition({ from: "candidate", to: "candidate", context: full })
        ).toThrow(/already/);
    });

    it("enforces per-stage required fields", () => {
        expect(() =>
            assertTransition({ from: "researched", to: "contacted", context: empty })
        ).toThrow(/owner/);
        expect(() =>
            assertTransition({
                from: "contacted",
                to: "in_conversation",
                context: { ...empty, ownerUserId: "u" },
            })
        ).toThrow(/next action/);
        expect(() =>
            assertTransition({
                from: "negotiating",
                to: "contracted",
                context: { ...full, hasAgreement: false },
            })
        ).toThrow(/agreement/);
        expect(stageRequirements("declined", empty)).toEqual([]);
        expect(stageRequirements("active", empty).map(e => e.code)).toEqual([
            "owner_required",
            "agreement_required",
        ]);
    });

    it("side-exits are reachable from every live stage and come back", () => {
        for (const from of ["candidate", "contacted", "qualified", "active"] as const) {
            expect(() => assertTransition({ from, to: "dormant", context: empty })).not.toThrow();
        }
        expect(() =>
            assertTransition({ from: "declined", to: "candidate", context: empty })
        ).not.toThrow();
    });

    it("knows what counts as in-pipeline", () => {
        expect(isInPipeline("candidate")).toBe(false);
        expect(isInPipeline("contacted")).toBe(true);
        expect(isInPipeline("declined")).toBe(false);
    });
});
