/**
 * Speaker selection inside a room (a phase's speakers, or the whole meeting).
 *
 * The cases come from real meetings run against the deployment's model: a
 * DACI where the chair took every other turn and @engineer never spoke, and a
 * pre-mortem where @finance never spoke because the first speaker of a phase
 * without the chair became its hub.
 */

import { describe, expect, it } from "vitest";

import { rankedMentions, roomRound, selectNextSpeaker } from "../turn-policy";
import type { AgentPersona, TurnPolicy } from "../types";
import {
    ANALYST,
    COUNSEL,
    CRITIC,
    ENGINEER,
    FACILITATOR,
    FINANCE,
    SALES,
    Transcript,
} from "./helpers";

const CHAIRED: TurnPolicy = { kind: "moderated", moderatorId: "facilitator" };

/**
 * Runs the policy over `turns` turns of one room, appending each speaker's
 * reply, and returns who spoke. `turnsLeft` is the meeting's count at the
 * room's first turn.
 */
function simulate(options: {
    room: AgentPersona[];
    transcript: Transcript;
    policy: TurnPolicy;
    turns: number;
    turnsLeft?: number;
    reply?: (speaker: AgentPersona, turn: number) => string;
}): string[] {
    const spoke: string[] = [];
    for (let turn = 0; turn < options.turns; turn++) {
        const speaker = selectNextSpeaker({
            participants: options.room,
            transcript: options.transcript.messages,
            turnIndex: turn,
            policy: options.policy,
            turnsLeft: options.turnsLeft === undefined ? undefined : options.turnsLeft - turn,
        })!;
        spoke.push(speaker.id);
        options.transcript.say(
            speaker,
            options.reply?.(speaker, turn) ?? `${speaker.displayName}'s point.`
        );
    }
    return spoke;
}

const CONTRIBUTE = [FACILITATOR, ANALYST, FINANCE, ENGINEER];

describe("moderated rounds", () => {
    it("hands the floor to the seat the chair asked, not the one it thanked", () => {
        // The DACI transcript from the Docker app, word for word up to the cut-off.
        const t = new Transcript()
            .system("Phase 1 of 4 — Frame", { event: "phase", phaseIndex: 0 })
            .say(FACILITATOR, "Welcome team. Our objective is to decide whether to ship Tier B.")
            .system("Phase 2 of 4 — Contribute", { event: "phase", phaseIndex: 1 })
            .say(
                FACILITATOR,
                "Moving into contributor input. @finance, please share our current gross margin."
            )
            .say(FINANCE, "Gross margin is 42% and recovers to 44% within a quarter.")
            .say(
                FACILITATOR,
                "Thanks @finance. Next, let's look at feasibility. @engineer, what is the engineering cost?"
            );
        const next = selectNextSpeaker({
            participants: CONTRIBUTE,
            transcript: t.messages,
            turnIndex: 3,
            policy: CHAIRED,
            turnsLeft: 7,
        });
        expect(next?.id).toBe("engineer");
    });

    it("gives every seat a phase lists one turn before anyone speaks twice", () => {
        const t = new Transcript()
            .say(FACILITATOR, "We decide whether to ship Tier B in Q3.")
            .system("Phase 2 of 4 — Contribute", { event: "phase", phaseIndex: 1 });
        // Every reply names the chair and the seat before it, the way agents thank each other.
        let previous = FACILITATOR;
        const spoke = simulate({
            room: CONTRIBUTE,
            transcript: t,
            policy: CHAIRED,
            turns: 8,
            turnsLeft: 9,
            reply: speaker => {
                const text = `Agree with @${previous.id} and @facilitator. @${previous.id}, anything to add?`;
                previous = speaker;
                return text;
            },
        });
        expect(new Set(spoke.slice(0, 4))).toEqual(new Set(CONTRIBUTE.map(p => p.id)));
        expect(new Set(spoke.slice(4, 8))).toEqual(new Set(CONTRIBUTE.map(p => p.id)));
        for (let i = 1; i < spoke.length; i++) expect(spoke[i]).not.toBe(spoke[i - 1]);
    });

    it("lets a chair that just framed the phase speak last in it", () => {
        const t = new Transcript().say(FACILITATOR, "We decide whether to ship Tier B in Q3.");
        expect(
            simulate({ room: CONTRIBUTE, transcript: t, policy: CHAIRED, turns: 4, turnsLeft: 9 })
        ).toEqual(["analyst", "finance", "engineer", "facilitator"]);
    });

    it("still answers a question the chair put before the last speaker", () => {
        const t = new Transcript().say(
            FACILITATOR,
            "@engineer, cost first; then @finance, the margin."
        );
        const spoke = simulate({
            room: CONTRIBUTE,
            transcript: t,
            policy: CHAIRED,
            turns: 2,
            turnsLeft: 9,
            reply: () => "Two sprints for the billing migration.",
        });
        // Seating order alone would give the analyst the second turn.
        expect(spoke).toEqual(["engineer", "finance"]);
    });

    it("gives a phase without the chair no hub: each listed seat speaks once", () => {
        const t = new Transcript().say(
            FACILITATOR,
            "Twelve months on, the price change failed. @engineer, start us off; @finance, the cash side next."
        );
        const spoke = simulate({
            room: [ENGINEER, FINANCE, SALES, COUNSEL, CRITIC],
            transcript: t,
            policy: CHAIRED,
            turns: 5,
            turnsLeft: 10,
            reply: speaker =>
                speaker === ENGINEER
                    ? "Metering broke the invoices. @finance will cover the cash impact."
                    : `${speaker.displayName}'s reason it failed.`,
        });
        expect(spoke).toEqual(["engineer", "finance", "sales", "counsel", "critic"]);
    });

    it("opens a round with the chair unless the chair just spoke", () => {
        const challenge = [FACILITATOR, CRITIC];
        const afterEngineer = new Transcript().say(ENGINEER, "Two sprints.");
        expect(
            selectNextSpeaker({
                participants: challenge,
                transcript: afterEngineer.messages,
                turnIndex: 0,
                policy: CHAIRED,
                turnsLeft: 5,
            })?.id
        ).toBe("facilitator");

        const afterChair = new Transcript().say(FACILITATOR, "Over to the challenge.");
        expect(
            simulate({
                room: challenge,
                transcript: afterChair,
                policy: CHAIRED,
                turns: 2,
                turnsLeft: 5,
            })
        ).toEqual(["critic", "facilitator"]);
    });

    it("keeps the chair's seat for the meeting's last turn when the round cannot finish", () => {
        const t = new Transcript()
            .say(FACILITATOR, "Thanks for the challenge. @analyst, answer it on churn.")
            .system("Phase 4 of 4 — Recommend", { event: "phase", phaseIndex: 3 });
        const spoke = simulate({
            room: [FACILITATOR, ANALYST, FINANCE, ENGINEER, CRITIC],
            transcript: t,
            policy: CHAIRED,
            turns: 3,
            turnsLeft: 3,
        });
        expect(spoke).toEqual(["analyst", "finance", "facilitator"]);
    });

    it("lets someone else close when the chair took the turn before", () => {
        const t = new Transcript().say(ANALYST, "Point.").say(FACILITATOR, "Summary.");
        expect(
            selectNextSpeaker({
                participants: [FACILITATOR, ANALYST, FINANCE],
                transcript: t.messages,
                turnIndex: 2,
                policy: CHAIRED,
                turnsLeft: 1,
            })?.id
        ).toBe("finance");
    });

    it("gives a person who names an agent that agent, even one that has spoken", () => {
        const t = new Transcript()
            .say(FACILITATOR, "Opening.")
            .say(FINANCE, "Margin holds at 44%.")
            .human("@finance, what does this do to churn?");
        expect(
            selectNextSpeaker({
                participants: [FACILITATOR, ANALYST, FINANCE],
                transcript: t.messages,
                turnIndex: 2,
                policy: CHAIRED,
                turnsLeft: 6,
            })?.id
        ).toBe("finance");
    });
});

describe("roomRound", () => {
    it("counts a failed turn and a person speaking through a seat as that seat's turn", () => {
        const room = [FACILITATOR, ANALYST, FINANCE];
        const t = new Transcript()
            .say(FACILITATOR, "Opening.")
            .failed(ANALYST)
            .human("Speaking for finance: margin holds.", "finance");
        const partial = roomRound(room, t.messages, 2);
        expect([...partial.heard]).toEqual(["analyst", "finance"]);
        expect(partial.waiting.map(p => p.id)).toEqual(["facilitator"]);
        expect(partial.lastSeat).toBe("finance");

        // Everyone has spoken, so the next turn opens a fresh round.
        const full = roomRound(room, t.messages, 3);
        expect(full.heard.size).toBe(0);
        expect(full.waiting.map(p => p.id)).toEqual(["facilitator", "analyst", "finance"]);
    });

    it("ignores a turn taken through a seat outside the room", () => {
        const t = new Transcript()
            .human("For the critic: this fails on notice.", "critic")
            .say(ANALYST, "Three customers exceed the cap.");
        const round = roomRound([ANALYST, FINANCE], t.messages, 2);
        expect([...round.heard]).toEqual(["analyst"]);
        expect(round.waiting.map(p => p.id)).toEqual(["finance"]);
    });

    it("does not count chat that takes no turn", () => {
        const t = new Transcript()
            .say(FACILITATOR, "Opening.")
            .human("FYI churn is up 2%.")
            .system("Phase 2 of 2", { event: "phase", phaseIndex: 1 });
        expect([...roomRound([FACILITATOR, ANALYST], t.messages, 1).heard]).toEqual([
            "facilitator",
        ]);
    });
});

describe("reactive rounds", () => {
    const room = [ANALYST, FINANCE, ENGINEER];

    it("skips a seat that has already spoken this round even when it is named", () => {
        const t = new Transcript()
            .say(ANALYST, "@finance what does a 10% cut do to margin?")
            .say(FINANCE, "It costs 4 points. @analyst do you agree?");
        expect(
            selectNextSpeaker({
                participants: room,
                transcript: t.messages,
                turnIndex: 2,
                policy: { kind: "reactive" },
            })?.id
        ).toBe("engineer");
    });

    it("still follows a mention of someone waiting", () => {
        const t = new Transcript().say(ANALYST, "@engineer can metering ship in Q3?");
        expect(
            selectNextSpeaker({
                participants: room,
                transcript: t.messages,
                turnIndex: 1,
                policy: { kind: "reactive" },
            })?.id
        ).toBe("engineer");
    });
});

describe("round_robin", () => {
    it("is unchanged: a fixed rotation that ignores the transcript", () => {
        const room = [ANALYST, FINANCE, ENGINEER];
        const t = new Transcript().say(ANALYST, "@engineer, you next?");
        const order = [0, 1, 2, 3, 4].map(
            turnIndex =>
                selectNextSpeaker({
                    participants: room,
                    transcript: t.messages,
                    turnIndex,
                    policy: { kind: "round_robin" },
                })?.id
        );
        expect(order).toEqual(["analyst", "finance", "engineer", "analyst", "finance"]);
    });
});

describe("rankedMentions", () => {
    it("puts the people asked something before the people only named", () => {
        expect(
            rankedMentions("Thanks @finance. Next, @engineer, what is the engineering cost?")
        ).toEqual(["engineer", "finance"]);
        expect(
            rankedMentions("Building on @analyst's numbers, can @finance confirm the 44%?")
        ).toEqual(["finance", "analyst"]);
        expect(rankedMentions("@engineer can metering ship in Q3? @finance has the cost.")).toEqual(
            ["engineer", "finance"]
        );
        expect(rankedMentions("To address @critic's challenge: churn is the risk.")).toEqual([
            "critic",
        ]);
    });

    it("reads a decimal as part of a sentence and a full-width comma as a hand-off", () => {
        expect(rankedMentions("Thanks @analyst. What does $1.42M mean for @finance?")).toEqual([
            "finance",
            "analyst",
        ]);
        expect(rankedMentions("谢谢 @analyst。@finance，请确认毛利率。")).toEqual([
            "finance",
            "analyst",
        ]);
    });

    it("drops the author's own handle", () => {
        expect(rankedMentions("As @engineer I'd say @finance, check this.", "engineer")).toEqual([
            "finance",
        ]);
    });
});
