/** @jest-environment jsdom */

/**
 * This week's suggestion cards, wired the way OverviewScreen wires them:
 * `weekSuggestions` builds the groups, `useOneClick` answers each card. A
 * suggestion is taken or left with one click on its face — no menu, no
 * expanding — the card leaves at once, and the toast carries an Undo that
 * really undoes it. A failure puts the card back and says why.
 */
import React, { useCallback, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import type * as VantageApi from "~/app/employer/tools/vantage/api";
import type {
    CommitmentDto,
    OverviewDto,
    TopicDto,
    VantageAgendaStatus,
    WeeklySignals,
} from "~/app/employer/tools/vantage/api";

jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));

const mockApi = {
    patchTopic: jest.fn(),
    patchCommitment: jest.fn(),
    decide: jest.fn(),
    undoDecision: jest.fn(),
    setAgendaStatus: jest.fn(),
};
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof VantageApi>("~/app/employer/tools/vantage/api"),
    vantageApi: new Proxy(
        {},
        { get: (_target, name: string) => mockApi[name as keyof typeof mockApi] }
    ),
}));

import { WeekSuggestions } from "~/app/employer/tools/vantage/_components/WeekSuggestions";
import { useOneClick } from "~/app/employer/tools/vantage/_lib/actions";
import { addDaysIso, fmtDate, todayIso } from "~/app/employer/tools/vantage/_lib/format";
import { useHiddenSuggestions } from "~/app/employer/tools/vantage/_lib/hidden";
import { weekSuggestions } from "~/app/employer/tools/vantage/_lib/suggestions";

import {
    LAST_WEEK,
    WEEK,
    WEEK_END,
    agenda,
    commitment,
    overview,
    ref,
    signals,
    topic,
} from "../vantage/factories";

const mockToast = jest.mocked(toast);

const TODAY = todayIso();

const pricing = topic({
    id: "t-pricing",
    agendaId: "a-now",
    position: 0,
    title: "Pricing page converts at half last month's rate",
    whyItMatters: "Most trials now start from the pricing page.",
    facts: [{ text: "Conversion fell from 4% to 2%", refs: [ref("e1", "Mixpanel export")] }],
});
const sso = topic({
    id: "t-sso",
    agendaId: "a-now",
    position: 1,
    origin: "rules",
    title: "Two design partners asked for SSO",
    rationale: "Two interviews mention it.",
});
const ssoBeta = topic({
    id: "t-beta",
    agendaId: "a-prev",
    status: "kept",
    title: "SSO for design partners",
    proposedNextStep: "Ship the SSO beta to Acme",
    proposedOwner: "Dana",
    proposedDue: addDaysIso(TODAY, 5),
    shared: true,
});
const interviews = topic({
    id: "t-interviews",
    agendaId: "a-prev",
    position: 1,
    status: "kept",
    title: "Pricing interviews",
    proposedNextStep: "Run five pricing interviews",
    proposedOwner: "Sam",
});
const unowned = topic({
    id: "t-unowned",
    agendaId: "a-prev",
    position: 2,
    status: "kept",
    title: "Hiring",
    proposedNextStep: "Post the founding engineer role",
    proposedOwner: null,
});
const update = commitment({
    id: "c-update",
    title: "Send the investor update",
    owner: "Dana",
    dueOn: addDaysIso(TODAY, -2),
    outcome: "Half written",
});

/**
 * What the server holds. The API mocks write to it and `refresh` reads it,
 * so after a one-click answer the screen shows what the server would send
 * back — the card stays away only while the data says it should.
 */
const server = {
    topics: [] as TopicDto[],
    commitments: [] as CommitmentDto[],
    agendaStatus: "draft" as VantageAgendaStatus,
    metricsWithoutData: [] as WeeklySignals["metricsWithoutData"],
    daysSinceLastEntry: 2 as number | null,
};

function setTopic(id: string, change: Partial<TopicDto>): TopicDto {
    server.topics = server.topics.map(t => (t.id === id ? { ...t, ...change } : t));
    return server.topics.find(t => t.id === id)!;
}

function view(): OverviewDto {
    const on = (agendaId: string) => server.topics.filter(t => t.agendaId === agendaId);
    return overview({
        today: TODAY,
        agenda: agenda({ id: "a-now", status: server.agendaStatus, topics: on("a-now") }),
        previousAgenda: agenda({
            id: "a-prev",
            weekStart: LAST_WEEK,
            status: "held",
            topics: on("a-prev"),
        }),
        // The overview carries open commitments only.
        checkIns: server.commitments.filter(c => c.status === "open"),
        signals: signals({ metricsWithoutData: server.metricsWithoutData }),
        daysSinceLastEntry: server.daysSinceLastEntry,
    });
}

const refreshed = jest.fn();
const onDecide = jest.fn();
const onLogEvidence = jest.fn();
const onRecordNumbers = jest.fn();

function Harness() {
    const [data, setData] = useState(view);
    const refresh = useCallback(async () => {
        refreshed();
        await Promise.resolve();
        setData(view());
    }, []);
    const hidden = useHiddenSuggestions();
    const { act: answer, gone } = useOneClick(refresh);
    const groups = weekSuggestions(data, { today: TODAY, hidden });
    return (
        <>
            <button type="button" onClick={() => void refresh()}>
                Reload
            </button>
            <WeekSuggestions
                groups={groups}
                act={answer}
                gone={gone}
                meetingWeek={{ start: WEEK, end: WEEK_END }}
                onDecide={onDecide}
                onLogEvidence={onLogEvidence}
                onRecordNumbers={onRecordNumbers}
            />
        </>
    );
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

function renderCards() {
    return render(<Harness />);
}

async function reload() {
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    });
}

const card = (name: string) => screen.getByRole("article", { name });
const queryCard = (name: string) => screen.queryByRole("article", { name });

/** The options the last plain toast was shown with. */
function lastToast() {
    const call = mockToast.mock.calls.at(-1);
    if (!call) throw new Error("no toast was shown");
    const [message, options] = call as unknown as [
        string,
        { action?: { label: string; onClick: () => void } },
    ];
    return { message, options };
}

/** Let every pending promise chain run (Undo re-reads through a window event). */
const settle = () => act(() => new Promise<void>(r => setTimeout(r, 0)));

async function clickUndo() {
    const { options } = lastToast();
    expect(options.action?.label).toBe("Undo");
    const reads = refreshed.mock.calls.length;
    act(() => options.action?.onClick());
    await settle();
    // The screen re-read because the Undo landed, not because the card asked.
    expect(refreshed.mock.calls.length).toBe(reads + 1);
}

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    server.topics = [pricing, sso, ssoBeta, interviews, unowned];
    server.commitments = [update];
    server.agendaStatus = "draft";
    server.metricsWithoutData = [];
    server.daysSinceLastEntry = 2;
    mockApi.patchTopic.mockImplementation((id: string, patch: Partial<TopicDto>) =>
        Promise.resolve({ topic: setTopic(id, patch) })
    );
    mockApi.patchCommitment.mockImplementation((id: string, patch: Partial<CommitmentDto>) => {
        server.commitments = server.commitments.map(c => (c.id === id ? { ...c, ...patch } : c));
        return Promise.resolve({ commitment: server.commitments.find(c => c.id === id) });
    });
    mockApi.decide.mockImplementation((id: string, input: { decision: string }) =>
        Promise.resolve({
            topic: setTopic(id, { decision: input.decision, commitmentId: "c-new" }),
        })
    );
    mockApi.undoDecision.mockImplementation((id: string) =>
        Promise.resolve({ topic: setTopic(id, { decision: null, commitmentId: null }) })
    );
    mockApi.setAgendaStatus.mockImplementation((id: string, status: VantageAgendaStatus) => {
        server.agendaStatus = status;
        return Promise.resolve({ agenda: agenda({ id, status }) });
    });
});

describe("topic suggestions", () => {
    it("show what they are and both answers on the card's face", () => {
        renderCards();

        for (const t of [pricing, sso]) {
            const c = card(t.title);
            expect(within(c).getByText("Suggested for the agenda")).toBeInTheDocument();
            expect(within(c).getByText(t.title)).toBeInTheDocument();
            expect(within(c).getByRole("button", { name: "Add to agenda" })).toBeVisible();
            expect(within(c).getByRole("button", { name: "Ignore" })).toBeVisible();
            expect(within(c).queryByRole("button", { name: /more for/i })).toBeNull();
        }
        // The answers are a group named by what they answer.
        expect(
            within(screen.getByRole("group", { name: pricing.title })).getByRole("button", {
                name: "Add to agenda",
            })
        ).toBeInTheDocument();
        expect(within(card(pricing.title)).getByText(pricing.whyItMatters)).toBeInTheDocument();
        expect(within(card(pricing.title)).getByText("Mixpanel export")).toBeInTheDocument();
    });

    it("Add to agenda keeps the topic in one call, takes the card away at once, and Undo puts it back", async () => {
        const answer = deferred<void>();
        mockApi.patchTopic.mockImplementationOnce(async (id: string, patch: Partial<TopicDto>) => {
            await answer.promise;
            return { topic: setTopic(id, patch) };
        });
        renderCards();

        fireEvent.click(within(card(pricing.title)).getByRole("button", { name: "Add to agenda" }));

        // Gone before the server has answered.
        expect(queryCard(pricing.title)).toBeNull();
        expect(mockApi.patchTopic).toHaveBeenCalledTimes(1);
        expect(mockApi.patchTopic).toHaveBeenCalledWith(pricing.id, { status: "kept" });

        await act(async () => answer.resolve());

        expect(refreshed).toHaveBeenCalledTimes(1);
        expect(lastToast().message).toBe("Added to the agenda");
        // Still gone once the fresh data says it is kept.
        expect(queryCard(pricing.title)).toBeNull();

        await clickUndo();

        expect(mockApi.patchTopic).toHaveBeenLastCalledWith(pricing.id, { status: "suggested" });
        expect(mockApi.patchTopic).toHaveBeenCalledTimes(2);
        expect(card(pricing.title)).toBeInTheDocument();
    });

    it("Ignore dismisses the topic, and Undo suggests it again", async () => {
        renderCards();

        fireEvent.click(within(card(sso.title)).getByRole("button", { name: "Ignore" }));
        expect(queryCard(sso.title)).toBeNull();
        await act(async () => {});

        expect(mockApi.patchTopic).toHaveBeenCalledWith(sso.id, { status: "dismissed" });
        expect(queryCard(sso.title)).toBeNull();
        expect(lastToast().message).toBe("Ignored");

        await clickUndo();

        expect(mockApi.patchTopic).toHaveBeenLastCalledWith(sso.id, { status: "suggested" });
        expect(card(sso.title)).toBeInTheDocument();
    });

    it("shows an ignored topic again once fresh data has it suggested (restored elsewhere)", async () => {
        renderCards();

        await act(async () => {
            fireEvent.click(within(card(sso.title)).getByRole("button", { name: "Ignore" }));
        });
        expect(queryCard(sso.title)).toBeNull();

        // Restored from the agenda's ignored list, not through this card's Undo.
        setTopic(sso.id, { status: "suggested" });
        await reload();

        expect(card(sso.title)).toBeInTheDocument();
    });

    it("puts the card back and says why when keeping it fails", async () => {
        mockApi.patchTopic.mockRejectedValueOnce(new Error("Network down"));
        renderCards();

        await act(async () => {
            fireEvent.click(
                within(card(pricing.title)).getByRole("button", { name: "Add to agenda" })
            );
        });

        expect(card(pricing.title)).toBeInTheDocument();
        expect(mockToast.error).toHaveBeenCalledWith("Network down");
        expect(mockToast).not.toHaveBeenCalled();
        expect(refreshed).not.toHaveBeenCalled();
    });
});

describe("check-in suggestions", () => {
    const name = `Check in: ${update.title}`;

    it("Done marks the promise done, and Undo reopens it with its old outcome", async () => {
        renderCards();
        expect(within(card(name)).getByText("2 days late")).toBeInTheDocument();

        fireEvent.click(within(card(name)).getByRole("button", { name: "Done" }));
        expect(queryCard(name)).toBeNull();
        await act(async () => {});

        expect(mockApi.patchCommitment).toHaveBeenCalledWith(update.id, { status: "done" });
        expect(queryCard(name)).toBeNull();
        expect(lastToast().message).toBe("Marked done");

        await clickUndo();

        expect(mockApi.patchCommitment).toHaveBeenLastCalledWith(update.id, {
            status: "open",
            outcome: "Half written",
        });
        expect(card(name)).toBeInTheDocument();
    });

    it("Missed marks the promise missed", async () => {
        renderCards();

        await act(async () => {
            fireEvent.click(within(card(name)).getByRole("button", { name: "Missed" }));
        });

        expect(mockApi.patchCommitment).toHaveBeenCalledWith(update.id, { status: "missed" });
    });

    it("Not yet sets it aside in this browser without asking the server", async () => {
        renderCards();

        fireEvent.click(within(card(name)).getByRole("button", { name: "Not yet" }));
        expect(queryCard(name)).toBeNull();
        await act(async () => {});

        // Still away after the refresh: the browser's hidden set keeps it there.
        expect(refreshed).toHaveBeenCalledTimes(1);
        expect(queryCard(name)).toBeNull();
        for (const call of Object.values(mockApi)) expect(call).not.toHaveBeenCalled();
        const stored = JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}");
        expect(stored).toEqual({ [`check-in:${update.id}`]: addDaysIso(TODAY, 1) });
        expect(lastToast().message).toBe("Asking again tomorrow");

        await clickUndo();

        expect(card(name)).toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}")).toEqual({});
    });
});

describe("commit suggestions", () => {
    it("Commit agrees to the proposed step with its owner and date, and Undo takes both back", async () => {
        renderCards();
        const name = `Commit: ${ssoBeta.proposedNextStep}`;
        const button = within(card(name)).getByRole("button", { name: "Commit" });

        fireEvent.click(button);
        expect(queryCard(name)).toBeNull();
        await act(async () => {});

        expect(mockApi.decide).toHaveBeenCalledTimes(1);
        expect(mockApi.decide).toHaveBeenCalledWith(ssoBeta.id, {
            decision: "Agreed: Ship the SSO beta to Acme",
            commitment: {
                title: "Ship the SSO beta to Acme",
                owner: "Dana",
                dueOn: ssoBeta.proposedDue,
                test: null,
                shared: true,
            },
        });
        expect(queryCard(name)).toBeNull();
        expect(onDecide).not.toHaveBeenCalled();
        expect(lastToast().message).toBe(`Committed — Dana, due ${fmtDate(ssoBeta.proposedDue)}`);

        await clickUndo();

        expect(mockApi.undoDecision).toHaveBeenCalledWith(ssoBeta.id, "c-new");
        expect(card(name)).toBeInTheDocument();
    });

    it("dates the commitment a week out when no date was proposed", async () => {
        renderCards();

        await act(async () => {
            fireEvent.click(
                within(card(`Commit: ${interviews.proposedNextStep}`)).getByRole("button", {
                    name: "Commit",
                })
            );
        });

        expect(mockApi.decide).toHaveBeenCalledWith(interviews.id, {
            decision: "Agreed: Run five pricing interviews",
            commitment: {
                title: "Run five pricing interviews",
                owner: "Sam",
                dueOn: addDaysIso(TODAY, 7),
                test: null,
                shared: false,
            },
        });
    });

    it("offers Try again when the Undo fails, and the retry brings the card back", async () => {
        mockApi.undoDecision.mockRejectedValueOnce(new Error("Network down"));
        renderCards();
        const name = `Commit: ${ssoBeta.proposedNextStep}`;

        await act(async () => {
            fireEvent.click(within(card(name)).getByRole("button", { name: "Commit" }));
        });
        act(() => lastToast().options.action?.onClick());
        await settle();

        expect(queryCard(name)).toBeNull();
        const failed = mockToast.error.mock.calls.at(-1) as unknown as [
            string,
            { action: { label: string; onClick: () => void } },
        ];
        expect(failed[0]).toBe("Network down");
        expect(failed[1].action.label).toBe("Try again");

        act(() => failed[1].action.onClick());
        await settle();

        expect(mockApi.undoDecision).toHaveBeenCalledTimes(2);
        expect(card(name)).toBeInTheDocument();
    });

    it("are not offered for a next step the founder wrote", () => {
        server.topics = server.topics.map(t =>
            t.id === ssoBeta.id ? { ...t, origin: "founder" as const } : t
        );
        renderCards();

        expect(queryCard(`Commit: ${ssoBeta.proposedNextStep}`)).toBeNull();
        expect(card(`Commit: ${interviews.proposedNextStep}`)).toBeInTheDocument();
    });

    it("asks for an owner instead of committing when none was proposed", () => {
        renderCards();
        const c = card(`Commit: ${unowned.proposedNextStep}`);

        expect(within(c).queryByRole("button", { name: "Commit" })).toBeNull();
        fireEvent.click(within(c).getByRole("button", { name: "Commit…" }));

        expect(onDecide).toHaveBeenCalledWith(unowned);
        expect(mockApi.decide).not.toHaveBeenCalled();
        expect(card(`Commit: ${unowned.proposedNextStep}`)).toBeInTheDocument();
    });
});

describe("nudges", () => {
    const readyToMark = () => {
        // Every suggestion on this week's draft answered, two topics kept.
        server.topics = server.topics.map(t =>
            t.agendaId === "a-now" ? { ...t, status: "kept" as const } : t
        );
    };

    it("Mark ready marks the draft ready, and Undo puts it back to draft", async () => {
        readyToMark();
        renderCards();
        const nudge = card("Mark the agenda ready");
        expect(nudge).toHaveTextContent("2 topics are on the agenda");

        fireEvent.click(within(nudge).getByRole("button", { name: "Mark ready" }));
        expect(queryCard("Mark the agenda ready")).toBeNull();
        await settle();

        expect(mockApi.setAgendaStatus).toHaveBeenCalledWith("a-now", "ready");
        expect(lastToast().message).toBe("Agenda marked ready for the meeting");
        expect(queryCard("Mark the agenda ready")).toBeNull();

        await clickUndo();

        expect(mockApi.setAgendaStatus).toHaveBeenLastCalledWith("a-now", "draft");
        expect(card("Mark the agenda ready")).toBeInTheDocument();
    });

    it("Not yet on Mark ready hides it until tomorrow without asking the server", async () => {
        readyToMark();
        renderCards();

        await act(async () => {
            fireEvent.click(
                within(card("Mark the agenda ready")).getByRole("button", { name: "Not yet" })
            );
        });

        expect(queryCard("Mark the agenda ready")).toBeNull();
        expect(mockApi.setAgendaStatus).not.toHaveBeenCalled();
        expect(JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}")).toEqual({
            "ready:a-now": addDaysIso(TODAY, 1),
        });
    });

    it("Enter numbers opens the numbers, and Ignore hides the nudge for the week", async () => {
        server.metricsWithoutData = [
            { metricId: "m1", key: "mrr", name: "MRR" },
            { metricId: "m2", key: "signups", name: "Signups" },
            { metricId: "m3", key: "churn", name: "Churn" },
        ];
        renderCards();
        const nudge = card("Record this week's numbers");
        expect(nudge).toHaveTextContent("No numbers yet this week for MRR, Signups and 1 more.");
        expect(
            within(
                screen.getByRole("group", {
                    name: "No numbers yet this week for MRR, Signups and 1 more.",
                })
            ).getByRole("button", { name: "Enter numbers" })
        ).toBeInTheDocument();

        fireEvent.click(within(nudge).getByRole("button", { name: "Enter numbers" }));
        expect(onRecordNumbers).toHaveBeenCalledTimes(1);
        expect(card("Record this week's numbers")).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(within(nudge).getByRole("button", { name: "Ignore" }));
        });

        expect(queryCard("Record this week's numbers")).toBeNull();
        expect(JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}")).toEqual({
            [`numbers:${WEEK}`]: addDaysIso(TODAY, 7),
        });
        expect(lastToast().message).toBe("Hidden for the rest of the week");
        for (const call of Object.values(mockApi)) expect(call).not.toHaveBeenCalled();
    });

    it("Log a conversation opens the log, and Ignore hides the nudge for the week", async () => {
        server.daysSinceLastEntry = 9;
        renderCards();
        const nudge = card("Log a conversation");
        expect(nudge).toHaveTextContent("Nothing logged for 9 days.");

        fireEvent.click(within(nudge).getByRole("button", { name: "Log a conversation" }));
        expect(onLogEvidence).toHaveBeenCalledTimes(1);

        await act(async () => {
            fireEvent.click(within(nudge).getByRole("button", { name: "Ignore" }));
        });

        expect(queryCard("Log a conversation")).toBeNull();
        expect(JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}")).toEqual({
            [`quiet:${WEEK}`]: addDaysIso(TODAY, 7),
        });

        await clickUndo();
        expect(card("Log a conversation")).toBeInTheDocument();
    });
});

describe("grouping on the page", () => {
    it("shows the meeting first while it is ahead, with its week in the heading", () => {
        renderCards();

        const sections = screen.getAllByRole("region").map(s => s.getAttribute("aria-label"));
        expect(sections).toEqual(["For the meeting", "Follow through"]);
        expect(screen.getByText("2 topics to review")).toBeInTheDocument();
    });
});
