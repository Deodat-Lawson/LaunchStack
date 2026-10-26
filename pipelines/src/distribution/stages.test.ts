import { describe, expect, it } from "vitest";

import {
    ALLOWED_TRANSITIONS,
    assertTransition,
    isInPipeline,
    stageRequirements,
    type StageTransitionError,
} from "./stages";
import { RELATIONSHIP_STAGES, type RelationshipStage } from "./types";

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

    it("lets a meeting enter proposal, and proposal advance or go back", () => {
        expect(() =>
            assertTransition({ from: "in_conversation", to: "proposal", context: full })
        ).not.toThrow();
        expect(() =>
            assertTransition({ from: "proposal", to: "negotiating", context: full })
        ).not.toThrow();
        expect(() =>
            assertTransition({ from: "proposal", to: "in_conversation", context: full })
        ).not.toThrow();
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

    it("carries what a refusal was beside its English, for the app to word", () => {
        const refusal = (from: RelationshipStage, to: RelationshipStage, context = empty) => {
            try {
                assertTransition({ from, to, context });
            } catch (error) {
                return error as StageTransitionError;
            }
            throw new Error("expected a refusal");
        };
        expect(refusal("candidate", "qualified").details).toEqual({
            from: "candidate",
            to: "qualified",
            allowed: ["researched", "contacted", "declined", "dormant"],
        });
        const missing = refusal("negotiating", "contracted").details?.missing;
        expect(missing?.map(m => [m.code, m.target])).toEqual([
            ["owner_required", "contracted"],
            ["agreement_required", "contracted"],
        ]);
        expect(refusal("candidate", "candidate").details).toEqual({
            from: "candidate",
            to: "candidate",
        });
    });

    it("knows what counts as in-pipeline", () => {
        expect(isInPipeline("candidate")).toBe(false);
        expect(isInPipeline("contacted")).toBe(true);
        expect(isInPipeline("declined")).toBe(false);
    });
});
