/**
 * Workflows are recipes the engine can keep: every phase's speakers exist in
 * the starter roster, turn counts add up, and the plan adapts to whoever is
 * actually in the room.
 */

import { phasePlanProblems } from "@launchstack/collab";
import {
    MEETING_WORKFLOWS,
    meetingWorkflow,
    phasesForRoom,
    workflowTurnCount,
} from "~/lib/agents/meeting-workflows";
import { STARTER_AGENT_KEYS } from "~/lib/agents/starter-agents";

describe("meeting workflows", () => {
    it("only seats starter agents, so a fresh workspace can run every recipe", () => {
        for (const workflow of MEETING_WORKFLOWS) {
            for (const key of workflow.agents) expect(STARTER_AGENT_KEYS).toContain(key);
            for (const phase of workflow.phases) {
                for (const key of phase.speakers ?? []) expect(workflow.agents).toContain(key);
            }
            if (workflow.moderator) expect(workflow.agents).toContain(workflow.moderator);
        }
    });

    it("has unique keys and phase ids", () => {
        const keys = MEETING_WORKFLOWS.map(w => w.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const workflow of MEETING_WORKFLOWS) {
            const ids = workflow.phases.map(p => p.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it("keeps every phased recipe inside the meeting turn cap", () => {
        for (const workflow of MEETING_WORKFLOWS) {
            expect(workflowTurnCount(workflow)).toBeLessThanOrEqual(60);
        }
    });

    it("produces a plan the engine accepts for the suggested room", () => {
        for (const workflow of MEETING_WORKFLOWS) {
            const phases = phasesForRoom(workflow, workflow.agents);
            expect(
                phasePlanProblems(
                    phases,
                    workflow.agents.map(id => ({ id }))
                )
            ).toEqual([]);
        }
    });

    it("drops speakers who are not in the room and opens an emptied phase to everyone", () => {
        const decision = meetingWorkflow("daci-decision")!;
        const phases = phasesForRoom(decision, ["analyst", "finance"]);
        const challenge = phases.find(p => p.id === "challenge")!;
        // The critic is not in the room, nor the facilitator: nobody named → everyone.
        expect(challenge.speakerIds).toBeUndefined();
        const contribute = phases.find(p => p.id === "contribute")!;
        expect(contribute.speakerIds).toEqual(["analyst", "finance"]);
    });

    it("names the method behind every phased recipe", () => {
        for (const workflow of MEETING_WORKFLOWS) {
            if (workflow.phases.length === 0) continue;
            expect(workflow.basis?.name.length).toBeGreaterThan(2);
            expect(workflow.basis?.origin.length).toBeGreaterThan(20);
            expect(workflow.basis?.usedBy.length).toBeGreaterThan(5);
        }
    });

    it("has an open discussion with no phases", () => {
        expect(meetingWorkflow("open-discussion")!.phases).toEqual([]);
        expect(meetingWorkflow("nope")).toBeUndefined();
    });
});
