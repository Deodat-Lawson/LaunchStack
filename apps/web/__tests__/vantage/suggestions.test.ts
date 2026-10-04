/**
 * What This week shows, and in which order, is plain data built by
 * `weekSuggestions`. These pin the rules: which topics are still waiting,
 * when the agenda can be marked ready, which promises to check on first,
 * which next steps can be committed to, when the record needs feeding, and
 * that following through comes first once the meeting is held.
 */
import {
    CHECK_IN_DAYS,
    draftedWords,
    hasMaterial,
    originWords,
    readyToCommit,
    topicReason,
    topicSources,
    weekSuggestions,
    type SuggestionGroup,
} from "~/app/employer/tools/vantage/_lib/suggestions";

import {
    LAST_WEEK,
    TODAY,
    WEEK,
    agenda,
    commitment,
    overview,
    ref,
    signals,
    topic,
} from "./factories";

/** Each group as `id: [suggestion ids]`, in order. */
function shape(groups: SuggestionGroup[]): [string, string[]][] {
    return groups.map(g => [g.id, g.items.map(s => s.id)]);
}

function group(groups: SuggestionGroup[], id: SuggestionGroup["id"]) {
    return groups.find(g => g.id === id)?.items ?? [];
}

describe("weekSuggestions — the meeting", () => {
    it("lists suggested topics in agenda position order", () => {
        const o = overview({
            agenda: agenda({
                topics: [
                    topic({ id: "c", position: 2 }),
                    topic({ id: "a", position: 0 }),
                    topic({ id: "b", position: 1 }),
                ],
            }),
        });

        const meeting = group(weekSuggestions(o, { today: TODAY }), "meeting");

        expect(meeting.map(s => s.id)).toEqual(["topic:a", "topic:b", "topic:c"]);
        expect(meeting.every(s => s.kind === "topic")).toBe(true);
    });

    it("leaves out dismissed, decided and kept topics", () => {
        const o = overview({
            agenda: agenda({
                topics: [
                    topic({ id: "waiting", position: 0 }),
                    topic({ id: "dismissed", position: 1, status: "dismissed" }),
                    topic({ id: "decided", position: 2, decision: "Agreed: ship it" }),
                    topic({ id: "kept", position: 3, status: "kept" }),
                ],
            }),
        });

        const meeting = group(weekSuggestions(o, { today: TODAY }), "meeting");

        expect(meeting.map(s => s.id)).toEqual(["topic:waiting"]);
    });

    it("suggests marking a draft ready once nothing is waiting and something is kept", () => {
        const o = overview({
            agenda: agenda({
                id: "a7",
                topics: [
                    topic({ id: "k1", status: "kept" }),
                    topic({ id: "k2", status: "kept", position: 1 }),
                    topic({ id: "d1", status: "dismissed", position: 2 }),
                ],
            }),
        });

        const meeting = group(weekSuggestions(o, { today: TODAY }), "meeting");

        expect(meeting).toEqual([
            expect.objectContaining({ kind: "mark-ready", id: "ready:a7", kept: 2 }),
        ]);
    });

    it("does not suggest marking ready while a topic waits, with nothing kept, or past draft", () => {
        const stillWaiting = agenda({
            topics: [topic({ id: "k", status: "kept" }), topic({ id: "s", position: 1 })],
        });
        const nothingKept = agenda({ topics: [topic({ status: "dismissed" })] });
        const alreadyReady = agenda({ status: "ready", topics: [topic({ status: "kept" })] });

        for (const a of [stillWaiting, nothingKept, alreadyReady]) {
            const groups = weekSuggestions(overview({ agenda: a }), { today: TODAY });
            expect(group(groups, "meeting").some(s => s.kind === "mark-ready")).toBe(false);
        }
    });
});

describe("weekSuggestions — following through", () => {
    it("puts late check-ins first (oldest first), then commits, then what is due soon", () => {
        const o = overview({
            checkIns: [
                commitment({ id: "soon", dueOn: "2026-10-05" }),
                commitment({ id: "late-recent", dueOn: "2026-10-01" }),
                commitment({ id: "due-today", dueOn: TODAY }),
                commitment({ id: "late-oldest", dueOn: "2026-09-28" }),
            ],
            previousAgenda: agenda({
                id: "prev",
                weekStart: LAST_WEEK,
                status: "held",
                topics: [topic({ id: "next", status: "kept", proposedNextStep: "Call Acme" })],
            }),
        });

        const items = group(weekSuggestions(o, { today: TODAY }), "follow-through");

        expect(items.map(s => s.id)).toEqual([
            "check-in:late-oldest",
            "check-in:late-recent",
            "commit:next",
            "check-in:due-today",
            "check-in:soon",
        ]);
        expect(items.map(s => (s.kind === "check-in" ? s.late : null))).toEqual([
            true,
            true,
            null,
            false,
            false,
        ]);
    });

    it(`checks in only on what is late or due within ${CHECK_IN_DAYS} days`, () => {
        expect(CHECK_IN_DAYS).toBe(2);
        const o = overview({
            checkIns: [
                commitment({ id: "in-4-days", dueOn: "2026-10-07" }),
                commitment({ id: "in-3-days", dueOn: "2026-10-06" }),
                commitment({ id: "in-2-days", dueOn: "2026-10-05" }),
                commitment({ id: "late", dueOn: "2026-09-30" }),
            ],
        });

        const items = group(weekSuggestions(o, { today: TODAY }), "follow-through");

        expect(items.map(s => s.id)).toEqual(["check-in:late", "check-in:in-2-days"]);
    });

    it("drops the follow-through group when every check-in is further out", () => {
        const o = overview({ checkIns: [commitment({ id: "later", dueOn: "2026-10-07" })] });

        expect(weekSuggestions(o, { today: TODAY })).toEqual([]);
    });

    it("suggests commits only for kept, undecided, uncommitted topics with a next step", () => {
        const held = agenda({
            id: "prev",
            weekStart: LAST_WEEK,
            status: "held",
            topics: [
                topic({ id: "yes", status: "kept", proposedNextStep: "Ship the SSO beta" }),
                topic({
                    id: "decided",
                    position: 1,
                    status: "kept",
                    proposedNextStep: "x",
                    decision: "Agreed",
                }),
                topic({
                    id: "committed",
                    position: 2,
                    status: "kept",
                    proposedNextStep: "x",
                    commitmentId: "c9",
                }),
                topic({ id: "blank", position: 3, status: "kept", proposedNextStep: "   " }),
                topic({ id: "suggested", position: 4, proposedNextStep: "x" }),
                topic({ id: "dismissed", position: 5, status: "dismissed", proposedNextStep: "x" }),
            ],
        });

        const items = group(
            weekSuggestions(overview({ previousAgenda: held }), { today: TODAY }),
            "follow-through"
        );

        expect(items.map(s => s.id)).toEqual(["commit:yes"]);
        expect(items[0]).toEqual(
            expect.objectContaining({ kind: "commit", agenda: held, topic: held.topics[0] })
        );
        expect(held.topics.map(readyToCommit)).toEqual([true, false, false, false, false, false]);
    });

    it("never suggests committing to a next step the founder wrote", () => {
        const step = { status: "kept" as const, proposedNextStep: "Call Acme" };
        const held = agenda({
            id: "prev",
            weekStart: LAST_WEEK,
            status: "held",
            topics: [
                topic({ id: "mine", origin: "founder", ...step }),
                topic({ id: "rules", position: 1, origin: "rules", ...step }),
                topic({ id: "ai", position: 2, origin: "ai", ...step }),
            ],
        });

        const items = group(
            weekSuggestions(overview({ previousAgenda: held }), { today: TODAY }),
            "follow-through"
        );

        expect(items.map(s => s.id)).toEqual(["commit:rules", "commit:ai"]);
        // Still ready to commit — the agenda row offers it, unmarked.
        expect(readyToCommit(held.topics[0]!)).toBe(true);
    });

    it("suggests commits only from held agendas, previous week first", () => {
        const step = { status: "kept" as const, proposedNextStep: "Do the thing" };
        const draftPrevious = agenda({
            id: "prev",
            weekStart: LAST_WEEK,
            status: "ready",
            topics: [topic({ id: "p", ...step })],
        });
        const draftCurrent = agenda({ topics: [topic({ id: "n", ...step })] });

        expect(
            weekSuggestions(overview({ previousAgenda: draftPrevious, agenda: draftCurrent }), {
                today: TODAY,
            }).flatMap(g => g.items.filter(s => s.kind === "commit"))
        ).toEqual([]);

        const groups = weekSuggestions(
            overview({
                previousAgenda: { ...draftPrevious, status: "held" },
                agenda: { ...draftCurrent, status: "held" },
            }),
            { today: TODAY }
        );
        expect(group(groups, "follow-through").map(s => s.id)).toEqual(["commit:p", "commit:n"]);
    });
});

describe("weekSuggestions — the record", () => {
    it("asks for numbers when metrics have none this week", () => {
        const o = overview({
            signals: signals({
                metricsWithoutData: [
                    { metricId: "m1", key: "mrr", name: "MRR" },
                    { metricId: "m2", key: "signups", name: "Signups" },
                ],
            }),
        });

        expect(group(weekSuggestions(o, { today: TODAY }), "record")).toEqual([
            {
                kind: "record-numbers",
                id: `numbers:${WEEK}`,
                metrics: [
                    { metricId: "m1", name: "MRR" },
                    { metricId: "m2", name: "Signups" },
                ],
            },
        ]);
    });

    it.each([
        [null, true],
        [8, true],
        [7, false],
        [3, false],
    ])("with %p days since the last entry, suggests logging evidence: %p", (days, expected) => {
        const record = group(
            weekSuggestions(overview({ daysSinceLastEntry: days }), { today: TODAY }),
            "record"
        );

        expect(record).toEqual(
            expected ? [{ kind: "log-evidence", id: `quiet:${WEEK}`, days }] : []
        );
    });
});

describe("weekSuggestions — groups", () => {
    const busy = () =>
        overview({
            agenda: agenda({ topics: [topic({ id: "t1" }), topic({ id: "t2", position: 1 })] }),
            checkIns: [commitment({ id: "c1", dueOn: "2026-10-01" })],
            signals: signals({ metricsWithoutData: [{ metricId: "m", key: "k", name: "MRR" }] }),
            daysSinceLastEntry: null,
        });

    it("orders meeting, follow-through, record while the meeting is ahead", () => {
        expect(shape(weekSuggestions(busy(), { today: TODAY }))).toEqual([
            ["meeting", ["topic:t1", "topic:t2"]],
            ["follow-through", ["check-in:c1"]],
            ["record", [`numbers:${WEEK}`, `quiet:${WEEK}`]],
        ]);
    });

    it("drops anything in `hidden`, by id", () => {
        const hidden = new Set(["topic:t2", "check-in:c1", `quiet:${WEEK}`]);

        expect(shape(weekSuggestions(busy(), { today: TODAY, hidden }))).toEqual([
            ["meeting", ["topic:t1"]],
            ["record", [`numbers:${WEEK}`]],
        ]);
    });

    it("moves following through first once this week's meeting is held", () => {
        const o = busy();
        o.agenda = agenda({
            status: "held",
            topics: [topic({ id: "k", status: "kept", proposedNextStep: "Call Acme" })],
        });

        expect(shape(weekSuggestions(o, { today: TODAY })).map(([id]) => id)).toEqual([
            "follow-through",
            "record",
        ]);
        expect(group(weekSuggestions(o, { today: TODAY }), "follow-through")[1]?.id).toBe(
            "commit:k"
        );
    });

    it("keeps the meeting first when last week was held but this week has a draft", () => {
        const o = busy();
        o.previousAgenda = agenda({ id: "prev", weekStart: LAST_WEEK, status: "held" });

        expect(shape(weekSuggestions(o, { today: TODAY }))[0]?.[0]).toBe("meeting");
    });

    it("drops empty groups, and returns nothing for a quiet week", () => {
        expect(weekSuggestions(overview(), { today: TODAY })).toEqual([]);
        expect(
            shape(weekSuggestions(overview({ daysSinceLastEntry: null }), { today: TODAY }))
        ).toEqual([["record", [`quiet:${WEEK}`]]]);
    });
});

describe("topicSources", () => {
    it("lists each cited source once, in first-seen order", () => {
        const t = topic({
            facts: [
                { text: "a", refs: [ref("e1"), ref("e2")] },
                { text: "b", refs: [ref("e2"), ref("e3")] },
                { text: "c", refs: [ref("e1")] },
            ],
        });

        expect(topicSources(t)).toEqual({
            refs: [ref("e1"), ref("e2"), ref("e3")],
            unsupported: false,
        });
    });

    it("flags a topic with any unsupported fact", () => {
        const t = topic({
            facts: [
                { text: "a", refs: [ref("e1")] },
                { text: "b", refs: [], unsupported: true },
            ],
        });

        expect(topicSources(t)).toEqual({ refs: [ref("e1")], unsupported: true });
        expect(topicSources(topic())).toEqual({ refs: [], unsupported: false });
    });
});

describe("topicReason", () => {
    const facts = [{ text: "  Signups fell 30%  ", refs: [] }];

    it("prefers why it matters, then the rationale, then the first fact", () => {
        expect(topicReason(topic({ whyItMatters: " Churn risk ", rationale: "r", facts }))).toBe(
            "Churn risk"
        );
        expect(topicReason(topic({ whyItMatters: "", rationale: " From the rules ", facts }))).toBe(
            "From the rules"
        );
        expect(topicReason(topic({ whyItMatters: "", rationale: null, facts }))).toBe(
            "Signups fell 30%"
        );
    });

    it("skips blank lines and falls back to nothing", () => {
        expect(topicReason(topic({ whyItMatters: "   ", rationale: "\n", facts }))).toBe(
            "Signups fell 30%"
        );
        expect(topicReason(topic({ whyItMatters: " ", rationale: " ", facts: [] }))).toBe("");
        expect(topicReason(topic({ whyItMatters: "", facts: [{ text: "   ", refs: [] }] }))).toBe(
            ""
        );
    });
});

describe("draftedWords and originWords", () => {
    const generatedAt = "2026-10-02T12:00:00.000Z";
    const nextDay = new Date("2026-10-03T12:00:00.000Z");

    it("says who drafted the agenda and when", () => {
        expect(draftedWords(agenda({ generatedAt, modelMetadata: { mode: "ai" } }), nextDay)).toBe(
            "drafted by AI yesterday"
        );
        expect(
            draftedWords(agenda({ generatedAt, modelMetadata: { mode: "rules" } }), nextDay)
        ).toBe("drafted from your records yesterday");
        expect(draftedWords(agenda({ generatedAt }), new Date("2026-10-02T15:00:00.000Z"))).toBe(
            "drafted 3 hours ago"
        );
    });

    it("says nothing for an agenda that was never generated", () => {
        expect(draftedWords(agenda({ generatedAt: null, modelMetadata: { mode: "ai" } }))).toBe(
            null
        );
    });

    it("names each origin in words that stay true", () => {
        expect(originWords("ai")).toBe("AI draft");
        expect(originWords("rules")).toBe("From your records");
        expect(originWords("founder")).toBe("Yours");
    });
});

describe("hasMaterial", () => {
    const none = { evidenceThisWindow: 0, openCommitments: 0, metricsWithData: 0 };

    it("is false with nothing on file", () => {
        expect(hasMaterial({ counts: none, checkIns: [] })).toBe(false);
    });

    it.each([
        ["evidence", { ...none, evidenceThisWindow: 1 }, []],
        ["a metric with data", { ...none, metricsWithData: 1 }, []],
        ["an open commitment", { ...none, openCommitments: 1 }, []],
        ["a check-in", none, [commitment()]],
    ])("is true with %s", (_what, counts, checkIns) => {
        expect(hasMaterial({ counts, checkIns })).toBe(true);
    });
});
