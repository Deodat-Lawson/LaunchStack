/**
 * One agent, one voice. A pre-mortem run against the deployment's model had
 * @engineer answer the question put to @finance, in her name; these pin the
 * guard against that and the sentence-safe trimming of over-long turns.
 */

import { describe, expect, it } from "vitest";

import {
    buildSystemPrompt,
    keepOwnVoice,
    LlmAgentRuntime,
    trimToCompleteSentence,
    type CollabChatMessage,
    type TurnContext,
} from "../agent";
import { ENGINEER, FACILITATOR, FINANCE, Transcript } from "./helpers";

const ROSTER = [FACILITATOR, ENGINEER, FINANCE];

const CONTEXT: TurnContext = {
    meetingId: "m",
    title: "Tier B pre-mortem",
    objective: "Find the ways it fails",
    agenda: [],
    context: [],
    roster: ROSTER.map(({ id, displayName, role }) => ({ id, displayName, role })),
    turnIndex: 2,
    maxTurns: 11,
    completionMarker: "MEETING_COMPLETE",
    phase: {
        index: 1,
        count: 4,
        title: "Imagine the failure",
        goal: "Say how it failed.",
        offset: 1,
        turns: 5,
        last: false,
        waiting: ["finance"],
    },
};

/** The engineer's turn from the real run, opening in the finance partner's name. */
const SPOKE_AS_FINANCE = [
    "Dana (@finance): Looking at the cash impact, the failure burned us down on three distinct fronts:",
    "",
    "First, technician dispatch costs devoured our launch funds almost immediately.",
    "",
    "@facilitator, that completes the five turns for this phase.",
].join("\n");

describe("keepOwnVoice", () => {
    it("reports a reply that is someone else's turn from its first line", () => {
        const voice = keepOwnVoice(SPOKE_AS_FINANCE, ENGINEER, ROSTER);
        expect(voice).toEqual({ text: "", cut: true, spokeAs: "finance" });
    });

    it("cuts everything from the first line written as another seat", () => {
        const voice = keepOwnVoice(
            "Metering needs two sprints.\n\n**Dana (@finance):** From finance, margin recovers to 44%.",
            ENGINEER,
            ROSTER
        );
        expect(voice).toEqual({ text: "Metering needs two sprints.", cut: true });
    });

    it("drops the speaker's own label, which the channel already shows", () => {
        expect(keepOwnVoice("Sam (@engineer): Two sprints.", ENGINEER, ROSTER)).toEqual({
            text: "Two sprints.",
            cut: false,
        });
    });

    it("leaves addressing, summaries and thanks alone", () => {
        const text = [
            "@finance: what does the cap do to cash?",
            "- Dana: margin recovers to 44%",
            "Thanks @facilitator, and Dana (@finance) has the numbers.",
        ].join("\n");
        expect(keepOwnVoice(text, ENGINEER, ROSTER)).toEqual({ text, cut: false });
    });
});

describe("trimToCompleteSentence", () => {
    it("drops a sentence the length limit cut in half", () => {
        expect(trimToCompleteSentence("Margin is 42%. Churn risk sits with Glob")).toBe(
            "Margin is 42%."
        );
    });

    it("keeps whole lines of a list", () => {
        expect(
            trimToCompleteSentence("Owners:\n- finance: rollout\n- engineer: metering, two spr")
        ).toBe("Owners:\n- finance: rollout");
    });

    it("fits a character cap at a sentence end", () => {
        expect(trimToCompleteSentence("One point. Two points. Three points.", 23)).toBe(
            "One point. Two points."
        );
    });

    it("cuts at a word and says so when no sentence ends in the last half", () => {
        expect(
            trimToCompleteSentence("Short. then a very long clause without any stop at all")
        ).toBe("Short. then a very long clause without any stop at…");
    });
});

/** A model stub that answers from a queue and records each request. */
function stubModel(replies: string[]) {
    const requests: CollabChatMessage[][] = [];
    const chat = async ({ messages }: { messages: CollabChatMessage[] }) => {
        requests.push(messages);
        return replies.shift() ?? "";
    };
    return { chat, requests };
}

describe("LlmAgentRuntime", () => {
    const transcript = new Transcript().say(
        FACILITATOR,
        "@engineer, start us off; @finance, the cash side next."
    ).messages;

    it("ends every request by naming whose turn it is", async () => {
        const model = stubModel(["Metering broke the invoices."]);
        const result = await new LlmAgentRuntime(model.chat).takeTurn({
            persona: ENGINEER,
            context: CONTEXT,
            transcript,
        });
        expect(result.text).toBe("Metering broke the invoices.");
        expect(model.requests).toHaveLength(1);
        expect(model.requests[0]!.at(-1)).toEqual({
            role: "user",
            content:
                "System: It is your turn, Sam (@engineer). Write Sam's message only — no lines for anyone else.",
        });
    });

    it("asks again once when the reply speaks as another seat", async () => {
        const model = stubModel([SPOKE_AS_FINANCE, "Metering broke the invoices on day one."]);
        const result = await new LlmAgentRuntime(model.chat).takeTurn({
            persona: ENGINEER,
            context: CONTEXT,
            transcript,
        });
        expect(result.text).toBe("Metering broke the invoices on day one.");
        expect(result.meta).toMatchObject({ retriedOwnVoice: true });
        expect(model.requests).toHaveLength(2);
        expect(model.requests[1]!.at(-1)!.content).toContain(
            "That draft was written as Dana (@finance). You are Sam (@engineer)"
        );
        // The second request does not carry the bad draft forward.
        expect(model.requests[1]!.some(m => m.content.includes("Looking at the cash impact"))).toBe(
            false
        );
    });

    it("fails the turn rather than post words in another seat's name", async () => {
        const model = stubModel([SPOKE_AS_FINANCE, SPOKE_AS_FINANCE]);
        await expect(
            new LlmAgentRuntime(model.chat).takeTurn({
                persona: ENGINEER,
                context: CONTEXT,
                transcript,
            })
        ).rejects.toThrow("spoke as @finance instead of in its own voice");
    });

    it("keeps the speaker's part and drops the lines it wrote for others", async () => {
        const model = stubModel([
            "Metering broke the invoices.\nDana (@finance): And cash ran out early. MEETING_COMPLETE",
        ]);
        const result = await new LlmAgentRuntime(model.chat).takeTurn({
            persona: ENGINEER,
            context: CONTEXT,
            transcript,
        });
        expect(result.text).toBe("Metering broke the invoices.");
        // A completion voiced in someone else's name does not end the meeting.
        expect(result.proposesCompletion).toBe(false);
        expect(result.meta).toMatchObject({ cutOtherVoices: true });
    });

    it("caps a long turn at a sentence end instead of mid-word", async () => {
        const model = stubModel(["Margin is 42%. Churn is rising fast across every tier."]);
        const result = await new LlmAgentRuntime(model.chat).takeTurn({
            persona: { ...ENGINEER, maxTurnChars: 24 },
            context: CONTEXT,
            transcript,
        });
        expect(result.text).toBe("Margin is 42%.");
    });
});

describe("buildSystemPrompt", () => {
    it("tells the speaker to speak only as itself and who is still to speak", () => {
        const prompt = buildSystemPrompt(ENGINEER, CONTEXT);
        expect(prompt).toContain(
            "Speak only as Sam. Never write another participant's lines or answer a question put to someone else"
        );
        expect(prompt).toContain("Still to speak in this phase: @finance.");
    });

    it("leaves the waiting line out when nobody is waiting", () => {
        const prompt = buildSystemPrompt(ENGINEER, {
            ...CONTEXT,
            phase: { ...CONTEXT.phase!, waiting: [] },
        });
        expect(prompt).not.toContain("Still to speak");
    });
});
