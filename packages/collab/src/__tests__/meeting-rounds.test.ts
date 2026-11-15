/**
 * Whole meetings through the orchestrator, with the DACI and pre-mortem
 * plans the workspace recipes use and scripted agents that thank and name
 * each other the way models do. What is under test is who gets the floor.
 */

import { describe, expect, it } from "vitest";

import type { AgentRuntime, TurnContext } from "../agent";
import { ScriptedAgentRuntime } from "../agent";
import { fixedClock, sequentialIdFactory } from "../clock";
import { createMeeting } from "../create-meeting";
import { InMemoryChannelStore } from "../store";
import type { AgentPersona, ChannelMessage, MeetingPhase } from "../types";
import { ANALYST, COUNSEL, CRITIC, ENGINEER, FACILITATOR, FINANCE, SALES } from "./helpers";

/** Speakers of each phase, in order, read back from the channel. */
function speakersByPhase(transcript: ChannelMessage[]): string[][] {
    const phases: string[][] = [];
    for (const message of transcript) {
        if (message.meta?.event === "phase") phases.push([]);
        else if (message.kind === "chat") phases.at(-1)?.push(message.author.id);
    }
    return phases;
}

async function runMeeting(options: {
    participants: AgentPersona[];
    phases: MeetingPhase[];
    script: Record<string, string[]>;
    maxTurns: number;
    runtime?: (scripted: AgentRuntime) => AgentRuntime;
}) {
    const clock = fixedClock(1_700_000_000_000, 1_000);
    const store = new InMemoryChannelStore(clock, sequentialIdFactory());
    const scripted = new ScriptedAgentRuntime(options.script);
    const meeting = await createMeeting({
        store,
        workspaceId: "ws",
        title: "Tier B price change",
        objective: "Decide whether to ship Tier B in Q3 and name who owns it",
        participants: options.participants,
        runtimes: [options.runtime ? options.runtime(scripted) : scripted],
        turnPolicy: { kind: "moderated", moderatorId: "facilitator" },
        maxTurns: options.maxTurns,
        phases: options.phases,
        clock,
    });
    const state = await meeting.orchestrator.run();
    const transcript = await store.read(meeting.config.channelId);
    return { state, transcript };
}

const DACI: MeetingPhase[] = [
    {
        id: "frame",
        title: "Frame",
        goal: "State the decision.",
        turns: 1,
        speakerIds: ["facilitator"],
    },
    {
        id: "contribute",
        title: "Contribute",
        goal: "Each contributor gives their seat's input.",
        turns: 4,
        speakerIds: ["facilitator", "analyst", "finance", "engineer"],
    },
    {
        id: "challenge",
        title: "Challenge",
        goal: "Test the leading option.",
        turns: 2,
        speakerIds: ["facilitator", "critic"],
    },
    { id: "recommend", title: "Recommend", goal: "Write the recommendation.", turns: 3 },
];

const DACI_SCRIPT = {
    facilitator: [
        "We decide whether to ship Tier B in Q3. @finance, start with the margin; then @engineer and @analyst.",
        "Thanks, all. @critic, test the leading option: ship Tier B with a cap.",
        "Thanks for the challenge. @analyst, answer it on churn.",
        "Recommendation: ship Tier B in Q3 behind the cap. Owner @finance. MEETING_COMPLETE",
    ],
    finance: [
        "Margin recovers to 44% within a quarter. Thanks @facilitator.",
        "I'll own the rollout and the 60-day notice.",
    ],
    engineer: ["Metering needs the billing migration: two sprints. @finance has the cost side."],
    analyst: [
        "Three of 41 customers exceed the cap today.",
        "Churn risk sits with Globex; a cap answers it.",
    ],
    critic: [
        "The plan assumes nobody leaves over overage charges.",
        "Agreed, if the cap ships first.",
    ],
};

describe("a DACI meeting under the chair", () => {
    it("hears every contributor the phase lists, and the chair closes", async () => {
        const { state, transcript } = await runMeeting({
            participants: [FACILITATOR, ANALYST, FINANCE, ENGINEER, CRITIC],
            phases: DACI,
            script: DACI_SCRIPT,
            maxTurns: 10,
        });

        expect(state.status).toBe("completed");
        expect(speakersByPhase(transcript)).toEqual([
            ["facilitator"],
            ["finance", "engineer", "analyst", "facilitator"],
            ["critic", "facilitator"],
            ["analyst", "finance", "facilitator"],
        ]);
        const chat = transcript.filter(m => m.kind === "chat");
        expect(chat.at(-1)!.author.id).toBe("facilitator");
        // Four of ten: frame, the close of each listed phase, and the recommendation.
        expect(chat.filter(m => m.author.id === "facilitator")).toHaveLength(4);
    });

    it("tells each speaker who is still to speak in the phase", async () => {
        const seen = new Map<number, string[] | undefined>();
        await runMeeting({
            participants: [FACILITATOR, ANALYST, FINANCE, ENGINEER, CRITIC],
            phases: DACI,
            script: DACI_SCRIPT,
            maxTurns: 10,
            runtime: scripted => ({
                nodeId: scripted.nodeId,
                serves: persona => scripted.serves(persona),
                takeTurn: request => {
                    const context: TurnContext = request.context;
                    seen.set(context.turnIndex, context.phase?.waiting);
                    return scripted.takeTurn(request);
                },
            }),
        });
        expect(seen.get(0)).toEqual([]);
        // Finance opens Contribute; the chair and the other two are still owed a turn.
        expect(seen.get(1)).toEqual(["facilitator", "analyst", "engineer"]);
        expect(seen.get(3)).toEqual(["facilitator"]);
        // Nobody speaks after the meeting's last turn.
        expect(seen.get(9)).toEqual([]);
    });
});

describe("a pre-mortem whose middle phase has no chair", () => {
    it("gives each listed seat one turn instead of making the first one a hub", async () => {
        const { transcript } = await runMeeting({
            participants: [FACILITATOR, ENGINEER, FINANCE, SALES, COUNSEL, CRITIC],
            phases: [
                {
                    id: "brief",
                    title: "Brief",
                    goal: "State the plan.",
                    turns: 1,
                    speakerIds: ["facilitator"],
                },
                {
                    id: "imagine",
                    title: "Imagine the failure",
                    goal: "Say how it failed.",
                    turns: 5,
                    speakerIds: ["engineer", "finance", "sales", "counsel", "critic"],
                },
                {
                    id: "rank",
                    title: "Rank",
                    goal: "Rank the causes.",
                    turns: 2,
                    speakerIds: ["facilitator", "critic"],
                },
                { id: "mitigate", title: "Mitigate", goal: "One mitigation per cause.", turns: 3 },
            ],
            script: {
                facilitator: [
                    "Twelve months on, the Tier B change failed. @engineer, start us off; @finance, the cash side next.",
                    "Top causes: invoices, churn, notice. @critic, rank them.",
                    "Mitigations agreed with owners. MEETING_COMPLETE",
                ],
                engineer: [
                    "Metering broke the invoices. @finance will cover the cash impact.",
                    "Feature flag on the invoice path, owned by me.",
                ],
                finance: ["Cash ran out two months early.", "Weekly burn review, owned by me."],
                sales: ["Globex left over the overage."],
                counsel: ["We missed the 60-day notice in MSA §7.2."],
                critic: ["Nobody priced in churn.", "Invoices first, then churn, then notice."],
            },
            maxTurns: 11,
        });

        const phases = speakersByPhase(transcript);
        expect(phases[1]).toEqual(["engineer", "finance", "sales", "counsel", "critic"]);
        expect(phases[2]).toEqual(["facilitator", "critic"]);
        expect(phases[3]).toEqual(["engineer", "finance", "facilitator"]);
    });
});
