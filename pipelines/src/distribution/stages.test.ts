import { describe, expect, it } from "vitest";

import { ALLOWED_TRANSITIONS, assertTransition, isInPipeline, stageRequirements } from "./stages";
import { LEGACY_STAGE_MAP, RELATIONSHIP_STAGES } from "./types";

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

    it("stores the same words the screens show, Proposal included", () => {
        expect([...RELATIONSHIP_STAGES]).toEqual([
            "lead",
            "qualified",
            "contacted",
            "meeting",
            "proposal",
            "negotiating",
            "won",
            "lost",
            "nurture",
        ]);
    });

    it("allows the forward path, through Proposal, with the fields filled in", () => {
        const path = [
            "lead",
            "qualified",
            "contacted",
            "meeting",
            "proposal",
            "negotiating",
            "won",
        ] as const;
        for (let i = 0; i < path.length - 1; i++) {
            expect(() =>
                assertTransition({ from: path[i]!, to: path[i + 1]!, context: full })
            ).not.toThrow();
        }
    });

    it("Lead → Qualified works (it was refused when Qualified was stored after Meeting)", () => {
        expect(() =>
            assertTransition({ from: "lead", to: "qualified", context: empty })
        ).not.toThrow();
    });

    it("takes the two real shortcuts and no others", () => {
        expect(() =>
            assertTransition({ from: "lead", to: "contacted", context: full })
        ).not.toThrow();
        expect(() =>
            assertTransition({ from: "proposal", to: "won", context: full })
        ).not.toThrow();
        expect(() => assertTransition({ from: "meeting", to: "won", context: full })).toThrow(
            /Cannot move/
        );
        expect(() =>
            assertTransition({ from: "contacted", to: "proposal", context: full })
        ).toThrow(/Cannot move/);
        expect(() => assertTransition({ from: "won", to: "lead", context: full })).toThrow(
            /Cannot move/
        );
        expect(() => assertTransition({ from: "lead", to: "lead", context: full })).toThrow(
            /already/
        );
    });

    it("enforces per-stage required fields", () => {
        expect(() =>
            assertTransition({ from: "qualified", to: "contacted", context: empty })
        ).toThrow(/owner/);
        expect(() =>
            assertTransition({
                from: "contacted",
                to: "meeting",
                context: { ...empty, ownerUserId: "u" },
            })
        ).toThrow(/next action/);
        // Negotiating with nobody owning it is exactly what the gate exists to stop.
        expect(() =>
            assertTransition({
                from: "proposal",
                to: "negotiating",
                context: { ...full, ownerUserId: null },
            })
        ).toThrow(/owner/);
        expect(() =>
            assertTransition({
                from: "negotiating",
                to: "won",
                context: { ...full, hasAgreement: false },
            })
        ).toThrow(/agreement/);
        expect(stageRequirements("lost", empty)).toEqual([]);
        expect(stageRequirements("qualified", empty)).toEqual([]);
        expect(stageRequirements("proposal", empty).map(e => e.code)).toEqual([
            "owner_required",
            "next_action_required",
        ]);
        expect(stageRequirements("won", empty).map(e => e.code)).toEqual([
            "owner_required",
            "agreement_required",
        ]);
    });

    it("side-exits are reachable from every open stage and come back", () => {
        for (const from of ["lead", "contacted", "proposal", "negotiating"] as const) {
            expect(() => assertTransition({ from, to: "nurture", context: empty })).not.toThrow();
            expect(() => assertTransition({ from, to: "lost", context: empty })).not.toThrow();
        }
        expect(() =>
            assertTransition({ from: "won", to: "nurture", context: empty })
        ).not.toThrow();
        expect(() => assertTransition({ from: "lost", to: "lead", context: empty })).not.toThrow();
    });

    it("knows what counts as in-pipeline", () => {
        expect(isInPipeline("lead")).toBe(false);
        expect(isInPipeline("contacted")).toBe(true);
        expect(isInPipeline("proposal")).toBe(true);
        expect(isInPipeline("lost")).toBe(false);
    });
});

describe("legacy vocabulary", () => {
    it("maps every retired stage onto a stored one, the way the screens showed it", () => {
        expect(Object.keys(LEGACY_STAGE_MAP).sort()).toEqual(
            [
                "active",
                "candidate",
                "contacted",
                "contracted",
                "declined",
                "dormant",
                "in_conversation",
                "negotiating",
                "qualified",
                "researched",
            ].sort()
        );
        for (const stage of Object.values(LEGACY_STAGE_MAP))
            expect(RELATIONSHIP_STAGES).toContain(stage);
        expect(LEGACY_STAGE_MAP.in_conversation).toBe("meeting");
        expect(LEGACY_STAGE_MAP.contracted).toBe("won");
        expect(LEGACY_STAGE_MAP.dormant).toBe("nurture");
    });
});
