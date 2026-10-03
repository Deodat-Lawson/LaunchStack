import { describe, expect, it } from "vitest";

import type { AgendaDto, CommitmentDto, TopicDto } from "./types";
import { renderWeeklyUpdate } from "./update";

function topic(over: Partial<TopicDto>): TopicDto {
    return {
        id: "t",
        agendaId: "a",
        position: 0,
        status: "kept",
        origin: "ai",
        title: "Topic",
        facts: [],
        whyItMatters: "",
        decisionQuestion: "",
        proposedNextStep: "",
        proposedOwner: null,
        proposedDue: null,
        helpRequested: null,
        unknowns: [],
        conflicts: [],
        rationale: null,
        shared: false,
        decision: null,
        decidedAt: null,
        commitmentId: null,
        ...over,
    };
}

const agenda: AgendaDto = {
    id: "a",
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    status: "held",
    summary: null,
    signals: null,
    modelMetadata: null,
    generatedAt: null,
    heldAt: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    topics: [
        topic({
            id: "shared",
            position: 1,
            title: "Onboarding drop-off",
            shared: true,
            facts: [
                {
                    text: "40 signed up; 6 finished onboarding.",
                    refs: [{ ref: "obs:1", label: "Signups: 40", date: "2026-09-27" }],
                },
                { text: "Everyone loved the demo.", refs: [], unsupported: true },
            ],
            decision: "Fix onboarding first.",
            helpRequested: "An intro to someone who has run activation experiments.",
        }),
        topic({
            id: "private",
            position: 0,
            title: "Runway",
            shared: false,
            decisionQuestion: "Raise now?",
        }),
        topic({ id: "dismissed", position: 2, title: "Old", shared: true, status: "dismissed" }),
    ],
};

const commitments: CommitmentDto[] = [
    {
        id: "c1",
        agendaId: "a",
        topicId: "shared",
        topicTitle: "Onboarding drop-off",
        title: "Ship the shorter onboarding",
        owner: "Dana",
        dueOn: "2026-10-09",
        test: null,
        status: "open",
        outcome: null,
        shared: true,
        resolvedAt: null,
        createdAt: "2026-10-05T00:00:00.000Z",
    },
    {
        id: "c2",
        agendaId: "a",
        topicId: null,
        topicTitle: null,
        title: "Secret plan",
        owner: "Me",
        dueOn: "2026-10-09",
        test: null,
        status: "open",
        outcome: null,
        shared: false,
        resolvedAt: null,
        createdAt: "2026-10-05T00:00:00.000Z",
    },
];

describe("weekly update", () => {
    it("includes only shared, undismissed topics and shared commitments by default", () => {
        const md = renderWeeklyUpdate({ agenda, commitments });
        expect(md).toContain("# Week of");
        expect(md).toContain("### Onboarding drop-off");
        expect(md).not.toContain("Runway");
        expect(md).not.toContain("### Old");
        expect(md).toContain("- [ ] Ship the shorter onboarding — Dana, due 2026-10-09");
        expect(md).not.toContain("Secret plan");
        expect(md).toContain("**Decision:** Fix onboarding first.");
        expect(md).toContain("## Where help would unblock us");
    });

    it("cites each fact and marks the one without a source as unverified", () => {
        const md = renderWeeklyUpdate({ agenda, commitments });
        expect(md).toContain("40 signed up; 6 finished onboarding. — _Signups: 40 (2026-09-27)_");
        expect(md).toContain("Everyone loved the demo. _(unverified — no source)_");
    });

    it("withholds a shared topic's facts that rest on private notes, but not in the founder's copy", () => {
        const withPrivate: AgendaDto = {
            ...agenda,
            topics: [
                topic({
                    id: "t",
                    title: "Pricing signal",
                    shared: true,
                    facts: [
                        {
                            text: "Priya has no budget until Q1.",
                            refs: [
                                { ref: "ev:priya", label: "Interview: Priya", date: "2026-09-26" },
                            ],
                        },
                        {
                            text: "Dana would probably pay.",
                            refs: [
                                { ref: "ev:dana", label: "Interview: Dana", date: "2026-09-25" },
                            ],
                        },
                    ],
                    conflicts: [
                        {
                            text: "Priya said the opposite last month.",
                            refs: [
                                { ref: "ev:priya", label: "Interview: Priya", date: "2026-08-20" },
                            ],
                        },
                    ],
                }),
            ],
        };
        const privateRefs = new Set(["ev:priya"]);
        const shared = renderWeeklyUpdate({ agenda: withPrivate, commitments: [], privateRefs });
        expect(shared).not.toContain("Priya");
        expect(shared).toContain("Dana would probably pay.");
        expect(shared.match(/withheld/g)).toHaveLength(2);
        const mine = renderWeeklyUpdate({
            agenda: withPrivate,
            commitments: [],
            privateRefs,
            includePrivate: true,
        });
        expect(mine).toContain("Priya has no budget until Q1.");
        expect(mine).not.toContain("withheld");
    });

    it("can render the founder's private copy in agenda order", () => {
        const md = renderWeeklyUpdate({ agenda, commitments, includePrivate: true });
        expect(md.indexOf("### Runway")).toBeLessThan(md.indexOf("### Onboarding drop-off"));
        expect(md).toContain("**Open decision:** Raise now?");
        expect(md).toContain("Secret plan");
    });
});
