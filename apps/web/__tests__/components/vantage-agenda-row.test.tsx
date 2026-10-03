/** @jest-environment jsdom */

/**
 * A kept topic on the agenda, wired the way AgendaScreen wires it. Vantage's
 * proposed next step is a marked suggestion with Commit and Ignore; a next
 * step the founder wrote is theirs — unmarked, no Ignore. Ignoring
 * Vantage's step on a row hides it on this browser and offers a plain
 * decision, with a way to show the step again. A double-clicked Commit
 * opens one commitment.
 */
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

import { AgendaTopicRow } from "~/app/employer/tools/vantage/_components/TopicCard";
import {
    SET_ASIDE_DAYS,
    commitToNextStep,
    setAside,
    useOneClick,
} from "~/app/employer/tools/vantage/_lib/actions";
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

/**
 * One agenda row with AgendaScreen's wiring. `busyWhileAnswering` mirrors
 * the screen's `busy || gone.has("commit:…")`; without it only the
 * in-flight guard in `useOneClick` stands between a double click and two
 * commitments.
 */
function Row({ busyWhileAnswering = false }: { busyWhileAnswering?: boolean }) {
    const [t, setT] = useState(() => stored);
    const refresh = useCallback(async () => {
        await Promise.resolve();
        setT(stored);
    }, []);
    const { act: answer, gone } = useOneClick(refresh);
    const hidden = useHiddenSuggestions();
    const id = `commit:${t.id}`;
    return (
        <AgendaTopicRow
            topic={t}
            index={0}
            busy={busyWhileAnswering && gone.has(id)}
            onCommit={() => void answer(id, () => commitToNextStep(t))}
            nextStepHidden={hidden.has(id)}
            onIgnoreNextStep={() =>
                void answer(id, () =>
                    setAside(id, SET_ASIDE_DAYS.nextStep, "Ignored — decide it your own way")
                )
            }
            onShowNextStep={() => unhideSuggestion(id)}
            onDecide={() => onDecide(t)}
        />
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
        expect(within(r).getByRole("button", { name: "Commit" })).toBeVisible();
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
        expect(within(r).getByRole("button", { name: "Commit" })).toBeVisible();
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

    it("commits once however often Commit is clicked while the first is on its way", async () => {
        const answer = deferred<void>();
        mockDecide.mockImplementationOnce(async (id: string, input: { decision: string }) => {
            await answer.promise;
            stored = { ...stored, decision: input.decision, commitmentId: "c-new" };
            return { topic: stored };
        });
        render(<Row />);
        const commit = within(row(vantageStep.title)).getByRole("button", { name: "Commit" });

        fireEvent.click(commit);
        fireEvent.click(commit);
        fireEvent.click(commit);

        expect(commit).toBeEnabled();
        expect(mockDecide).toHaveBeenCalledTimes(1);

        await act(async () => answer.resolve());
        await settle();

        expect(mockDecide).toHaveBeenCalledTimes(1);
        expect(within(row(vantageStep.title)).getByText("Decided")).toBeInTheDocument();
        expect(
            within(row(vantageStep.title)).getByText("Agreed: Ship the SSO beta to Acme")
        ).toBeInTheDocument();
    });

    it("disables Commit while it is answered when the screen marks the row busy", () => {
        mockDecide.mockReturnValueOnce(new Promise(() => undefined));
        render(<Row busyWhileAnswering />);
        const commit = within(row(vantageStep.title)).getByRole("button", { name: "Commit" });

        fireEvent.click(commit);

        expect(commit).toBeDisabled();
        expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    it("Undo after a Commit takes the decision back and shows the next step again", async () => {
        render(<Row />);

        await act(async () => {
            fireEvent.click(within(row(vantageStep.title)).getByRole("button", { name: "Commit" }));
        });
        await settle();
        expect(within(row(vantageStep.title)).getByText("Decided")).toBeInTheDocument();

        const [, options] = mockToast.mock.calls.at(-1) as unknown as [
            string,
            { action: { label: string; onClick: () => void } },
        ];
        expect(options.action.label).toBe("Undo");
        act(() => options.action.onClick());
        await settle();

        expect(mockUndoDecision).toHaveBeenCalledWith("t-sso", "c-new");
        expect(within(row(vantageStep.title)).getByText("Suggested next step")).toBeInTheDocument();
    });

    it("asks for an owner instead of committing when none was proposed", () => {
        stored = { ...vantageStep, proposedOwner: null };
        render(<Row />);

        fireEvent.click(within(row(vantageStep.title)).getByRole("button", { name: "Commit…" }));

        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(mockDecide).not.toHaveBeenCalled();
    });
});
