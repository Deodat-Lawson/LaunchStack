/** @jest-environment jsdom */

/** Agenda proposals open explicit human review. Recording requires a decision,
 * owner, deadline and test; busy submissions cannot duplicate actions. */
import React, { useCallback, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { toast } from "sonner";

import type * as VantageApi from "~/app/employer/tools/vantage/api";
import type { TopicDto } from "~/app/employer/tools/vantage/api";

jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));

const mockDecide = jest.fn();
const mockUndoDecision = jest.fn();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof VantageApi>("~/app/employer/tools/vantage/api"),
    vantageApi: {
        decide: (...args: unknown[]) => mockDecide(...args),
        undoDecision: (...args: unknown[]) => mockUndoDecision(...args),
    },
}));

import { DecisionDialog } from "~/app/employer/tools/vantage/_components/TopicDialogs";
import { AgendaTopicRow } from "~/app/employer/tools/vantage/_components/TopicCard";
import { SET_ASIDE_DAYS, setAside, useOneClick } from "~/app/employer/tools/vantage/_lib/actions";
import { addDaysIso, todayIso } from "~/app/employer/tools/vantage/_lib/format";
import { unhideSuggestion, useHiddenSuggestions } from "~/app/employer/tools/vantage/_lib/hidden";

import { topic } from "../vantage/factories";

const mockToast = jest.mocked(toast);

const vantageStep = topic({
    id: "t-sso",
    status: "kept",
    origin: "ai",
    title: "SSO for design partners",
    decisionQuestion: "Do we build SSO before the pilot?",
    proposedNextStep: "Ship the SSO beta to Acme",
    proposedOwner: "Dana",
    proposedDue: "2026-10-09",
});
const founderStep = topic({
    ...vantageStep,
    id: "t-mine",
    origin: "founder",
    title: "Hire a founding engineer",
    proposedNextStep: "Post the role on Friday",
});

/** The topic as the server has it; `decide` and `undoDecision` write to it. */
let stored: TopicDto;
const onDecide = jest.fn();

/** Mirrors AgendaScreen's row callbacks and mounts its real DecisionDialog. */
function Row({ busyWhileAnswering = false }: { busyWhileAnswering?: boolean }) {
    const [t, setT] = useState(() => stored);
    const refresh = useCallback(async () => {
        await Promise.resolve();
        setT(stored);
    }, []);
    const { act: answer } = useOneClick(refresh);
    const [decisionOpen, setDecisionOpen] = useState(false);
    const decide = () => {
        onDecide(t);
        setDecisionOpen(true);
    };
    const hidden = useHiddenSuggestions();
    const id = `commit:${t.id}`;
    return (
        <>
            <AgendaTopicRow
                topic={t}
                index={0}
                busy={busyWhileAnswering}
                onCommit={decide}
                nextStepHidden={hidden.has(id)}
                onIgnoreNextStep={() =>
                    void answer(id, () =>
                        setAside(id, SET_ASIDE_DAYS.nextStep, "Ignored — decide it your own way")
                    )
                }
                onShowNextStep={() => unhideSuggestion(id)}
                onDecide={decide}
            />
            <DecisionDialog
                open={decisionOpen}
                onOpenChange={setDecisionOpen}
                topic={t}
                onSaved={setT}
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

const settle = () => act(() => new Promise<void>(r => setTimeout(r, 0)));
const row = (title: string) => screen.getByRole("article", { name: title });
const hiddenStore = () =>
    JSON.parse(window.localStorage.getItem("vantage:hidden:v1") ?? "{}") as Record<string, string>;

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    stored = vantageStep;
    mockDecide.mockImplementation((id: string, input: { decision: string }) => {
        stored = { ...stored, decision: input.decision, commitmentId: "c-new" };
        return Promise.resolve({ topic: stored });
    });
    mockUndoDecision.mockImplementation(() => {
        stored = { ...stored, decision: null, commitmentId: null };
        return Promise.resolve({ topic: stored });
    });
});

describe("AgendaTopicRow next step", () => {
    it("marks Vantage's next step as a suggestion, with Commit, Ignore and another decision", () => {
        render(<Row />);
        const r = row(vantageStep.title);

        expect(within(r).getByText("Suggested next step")).toBeInTheDocument();
        expect(within(r).getByText("Ship the SSO beta to Acme")).toBeInTheDocument();
        expect(within(r).getByRole("button", { name: "Commit\u2026" })).toBeVisible();
        expect(within(r).getByRole("button", { name: "Ignore" })).toBeVisible();
        expect(within(r).getByRole("button", { name: "Decide something else…" })).toBeVisible();
    });

    it("leaves a next step the founder wrote unmarked, with no Ignore", () => {
        stored = founderStep;
        const { container } = render(<Row />);
        const r = row(founderStep.title);

        expect(within(r).getByText("Your next step")).toBeInTheDocument();
        expect(within(r).queryByText("Suggested next step")).toBeNull();
        expect(container.querySelector(".lucide-sparkles")).toBeNull();
        expect(within(r).queryByRole("button", { name: "Ignore" })).toBeNull();
        expect(within(r).getByRole("button", { name: "Commit\u2026" })).toBeVisible();
        expect(within(r).getByRole("button", { name: "Decide something else…" })).toBeVisible();
    });

    it("Ignore hides Vantage's step on this browser, and Show brings it back", async () => {
        render(<Row />);

        await act(async () => {
            fireEvent.click(within(row(vantageStep.title)).getByRole("button", { name: "Ignore" }));
        });

        const r = row(vantageStep.title);
        expect(hiddenStore()).toEqual({ "commit:t-sso": addDaysIso(todayIso(), 60) });
        expect(within(r).queryByText("Suggested next step")).toBeNull();
        expect(within(r).getByRole("button", { name: "Record a decision" })).toBeVisible();
        expect(mockDecide).not.toHaveBeenCalled();

        act(() => {
            fireEvent.click(within(r).getByRole("button", { name: "Show Vantage's next step" }));
        });

        expect(hiddenStore()).toEqual({});
        expect(within(row(vantageStep.title)).getByText("Suggested next step")).toBeInTheDocument();
        expect(
            within(row(vantageStep.title)).queryByRole("button", {
                name: "Show Vantage's next step",
            })
        ).toBeNull();
    });

    it("opens one explicit decision dialog and submits once with the observed version and human test", async () => {
        const answer = deferred<void>();
        mockDecide.mockImplementationOnce(async (_id: string, input: { decision: string }) => {
            await answer.promise;
            stored = {
                ...stored,
                decision: input.decision,
                commitmentId: "c-new",
                contentVersion: stored.contentVersion + 1,
            };
            return { topic: stored };
        });
        render(<Row />);
        fireEvent.click(
            within(row(vantageStep.title)).getByRole("button", { name: "Commit\u2026" })
        );
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        expect(mockDecide).not.toHaveBeenCalled();
        const dialog = screen.getByRole("dialog");
        const record = within(dialog).getByRole("button", { name: "Record" });
        expect(record).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText("What was decided"), {
            target: { value: "Ship the pilot beta" },
        });
        expect(record).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText("The test"), {
            target: { value: "Acme completes an SSO login" },
        });
        fireEvent.click(record);
        fireEvent.click(record);
        expect(record).toBeDisabled();
        expect(mockDecide).toHaveBeenCalledTimes(1);
        expect(mockDecide).toHaveBeenCalledWith(vantageStep.id, {
            expectedContentVersion: vantageStep.contentVersion,
            decision: "Ship the pilot beta",
            commitment: {
                title: vantageStep.proposedNextStep,
                owner: "Dana",
                dueOn: vantageStep.proposedDue,
                test: "Acme completes an SSO login",
                shared: vantageStep.shared,
            },
        });
        await act(async () => answer.resolve());
        await settle();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(within(row(vantageStep.title)).getByText("Ship the pilot beta")).toBeInTheDocument();
        expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    it("disables starting a decision while the screen marks the row busy", () => {
        render(<Row busyWhileAnswering />);
        const commit = within(row(vantageStep.title)).getByRole("button", { name: "Commit\u2026" });
        expect(commit).toBeDisabled();
        fireEvent.click(commit);
        expect(onDecide).not.toHaveBeenCalled();
        expect(mockDecide).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("cancelling explicit review preserves the proposal and offers no destructive Undo", () => {
        render(<Row />);
        fireEvent.click(
            within(row(vantageStep.title)).getByRole("button", { name: "Commit\u2026" })
        );
        fireEvent.change(screen.getByLabelText("What was decided"), {
            target: { value: "Unsubmitted human draft" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(stored).toEqual(vantageStep);
        expect(within(row(vantageStep.title)).getByText("Suggested next step")).toBeInTheDocument();
        expect(mockDecide).not.toHaveBeenCalled();
        expect(mockUndoDecision).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
    });

    it("asks for an owner instead of committing when none was proposed", () => {
        stored = { ...vantageStep, proposedOwner: null };
        render(<Row />);

        fireEvent.click(within(row(vantageStep.title)).getByRole("button", { name: "Commit…" }));

        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(mockDecide).not.toHaveBeenCalled();
    });
});
