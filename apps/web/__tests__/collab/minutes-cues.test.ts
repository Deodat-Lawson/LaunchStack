/**
 * Minutes stay extractive, so the cue lists decide what counts as a decision
 * or an action item. A chaired meeting ends on a recommendation with named
 * owners rather than "Decision: …", and the minutes must see it.
 */

import {
    buildMinutes,
    type ChannelMessage,
    type MeetingConfig,
    type MeetingState,
} from "@launchstack/collab";

const config: MeetingConfig = {
    id: "mtg",
    channelId: "chan",
    workspaceId: "ws",
    title: "Tier B",
    objective: "Decide",
    agenda: [],
    participants: [
        { id: "facilitator", displayName: "Ada", role: "Facilitator", systemPrompt: "" },
        { id: "finance", displayName: "Dana", role: "Finance partner", systemPrompt: "" },
        { id: "engineer", displayName: "Sam", role: "Engineering lead", systemPrompt: "" },
    ],
    turnPolicy: { kind: "moderated", moderatorId: "facilitator" },
    maxTurns: 10,
};

const state: MeetingState = {
    meetingId: "mtg",
    status: "completed",
    turnIndex: 3,
    nextSpeakerId: null,
};

function message(seq: number, id: string, displayName: string, text: string): ChannelMessage {
    return {
        id: `m${seq}`,
        channelId: "chan",
        seq,
        ts: "2026-09-25T00:00:00.000Z",
        author: { kind: "agent", id, displayName },
        text,
        kind: "chat",
    };
}

describe("minutes cues", () => {
    it("reads a recommendation for the approver as the decision, and third-person owners as actions", () => {
        const transcript = [
            message(1, "facilitator", "Ada", "Options on the table: ship in Q3, or defer to Q4."),
            message(2, "finance", "Dana", "Base uplift is $147.6k ARR."),
            message(
                3,
                "facilitator",
                "Ada",
                [
                    "Recommendation for the approver:",
                    "- Option: ship the Tier B price change in Q3, paired with spending caps.",
                    "- Owner: @finance owns the commercial rollout; Sam owns the billing migration.",
                ].join("\n")
            ),
        ];
        const minutes = buildMinutes(config, state, transcript);
        expect(minutes.decisions.map(d => d.text)).toEqual([
            "Recommendation for the approver:",
            "- Option: ship the Tier B price change in Q3, paired with spending caps.",
        ]);
        expect(minutes.actionItems).toHaveLength(1);
        expect(minutes.actionItems[0]?.owner).toBe("finance");
    });

    it("does not read a list of options, or a request to test one, as a decision", () => {
        const minutes = buildMinutes(config, state, [
            message(
                1,
                "facilitator",
                "Ada",
                "Options on the table: ship in Q3, or defer to Q4. Option 1 is cheaper. Please stress-test this option:"
            ),
        ]);
        expect(minutes.decisions).toHaveLength(0);
    });
});
