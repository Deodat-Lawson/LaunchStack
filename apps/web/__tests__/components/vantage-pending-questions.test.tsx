/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type * as VantageApi from "~/app/employer/tools/vantage/api";
import type { PendingHistoricalQuestionsViewV1 } from "~/app/employer/tools/vantage/api";

const mockLoad = jest.fn();
const mockReview = jest.fn();
const mockCommitment = jest.fn();
const mockTopic = jest.fn();
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof VantageApi>("~/app/employer/tools/vantage/api"),
    vantageApi: {
        pendingQuestions: (...args: unknown[]) => mockLoad(...args),
        reviewPendingQuestion: (...args: unknown[]) => mockReview(...args),
        addCommitment: (...args: unknown[]) => mockCommitment(...args),
        patchTopic: (...args: unknown[]) => mockTopic(...args),
    },
}));
jest.mock("~/components/tool-app/ToolLink", () => {
    const { forwardRef } = jest.requireActual<typeof React>("react");
    return {
        ToolLink: forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
            function ToolLink(props, ref) {
                return <a ref={ref} {...props} />;
            }
        ),
    };
});

import { VantageApiError } from "~/app/employer/tools/vantage/api";
import { PendingQuestions } from "~/app/employer/tools/vantage/_components/PendingQuestions";

function view(): PendingHistoricalQuestionsViewV1 {
    return {
        contractVersion: "pending-historical-questions/v1",
        agendaId: "current-report",
        version: 7,
        questions: [
            {
                questionId: "original-topic",
                originReportId: "original-report",
                originTopicId: "original-topic",
                originWeekStart: "2026-10-05",
                originGeneratedAt: "2026-10-12T16:00:00.000Z",
                origin: "ai",
                title: "Deletion acceptance review",
                question: "Has the deletion dry run met the acceptance checklist?",
                humanReview: {
                    kind: "recorded-decision",
                    contentVersion: 2,
                    status: "kept",
                    decision: "Review the dry-run result before enabling access.",
                    decidedAt: "2026-10-12T16:00:00.000Z",
                },
                suggestedDue: "2026-10-09",
                sourceRefs: [],
            },
        ],
        unavailableCount: 0,
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockLoad.mockResolvedValue(view());
    mockReview.mockResolvedValue({ ...view(), version: 8, questions: [] });
});

it("separates the original question, week and past human decision from current truth", async () => {
    render(<PendingQuestions agendaId="current-report" />);
    const region = screen.getByRole("region", { name: "Pending Questions from Previous Reviews" });
    const card = await within(region).findByRole("article", {
        name: view().questions[0]!.question,
    });
    expect(mockLoad).toHaveBeenCalledWith("current-report");
    expect(within(card).getByText("Historical · current status unverified")).toBeVisible();
    expect(within(card).getByRole("link").getAttribute("href")).toContain("week=2026-10-05");
    expect(within(card).getByText("Past human decision:")).toBeVisible();
    expect(card).toHaveTextContent("Review the dry-run result before enabling access.");
    expect(card).toHaveTextContent("Original suggested date:");
    expect(card).toHaveTextContent("Its current relevance is unverified.");
    expect(card).not.toHaveTextContent(/overdue|failed|completed/i);
    expect(region).toHaveTextContent("does not mean the issue is still open");
});

it.each(["Dismiss", "Confirm addressed"])(
    "%s reviews the original identity using CAS only",
    async label => {
        const count = jest.fn();
        render(<PendingQuestions agendaId="current-report" onPendingCount={count} />);
        const card = await screen.findByRole("article", { name: view().questions[0]!.question });
        fireEvent.click(within(card).getByRole("button", { name: label }));
        await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
        expect(mockReview).toHaveBeenCalledWith(
            "current-report",
            "original-topic",
            label === "Dismiss" ? "dismissed" : "addressed",
            7
        );
        expect(mockCommitment).not.toHaveBeenCalled();
        expect(mockTopic).not.toHaveBeenCalled();
        expect(count).toHaveBeenLastCalledWith(0);
    }
);

it("does not hide a question or submit competing writes while review is pending", async () => {
    const save = deferred<PendingHistoricalQuestionsViewV1>();
    mockReview.mockReturnValue(save.promise);
    render(<PendingQuestions agendaId="current-report" />);
    const card = await screen.findByRole("article", { name: view().questions[0]!.question });
    fireEvent.click(within(card).getByRole("button", { name: "Confirm addressed" }));
    expect(within(card).getByRole("button", { name: "Dismiss" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Confirm addressed" })).toBeDisabled();
    expect(card).toBeInTheDocument();
    await act(async () => save.resolve({ ...view(), version: 8, questions: [] }));
    expect(mockReview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("article")).toBeNull();
});

it("loads the latest version after a conflict and requires another explicit review", async () => {
    const newer = { ...view(), version: 9 };
    mockLoad.mockResolvedValueOnce(view()).mockResolvedValue(newer);
    mockReview.mockRejectedValueOnce(
        new VantageApiError("Stale", 409, { code: "version_conflict" })
    );
    render(<PendingQuestions agendaId="current-report" />);
    const card = await screen.findByRole("article", { name: view().questions[0]!.question });
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This review changed");
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
    expect(mockReview).toHaveBeenCalledTimes(1);
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "Confirm addressed" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm addressed" }));
    await waitFor(() => expect(mockReview).toHaveBeenCalledTimes(2));
    expect(mockReview).toHaveBeenLastCalledWith("current-report", "original-topic", "addressed", 9);
});

it("shows unavailable history only as a count and keeps the week from being called caught up", async () => {
    const count = jest.fn();
    mockLoad.mockResolvedValue({ ...view(), questions: [], unavailableCount: 2 });
    render(<PendingQuestions agendaId="current-report" onPendingCount={count} />);
    expect(
        await screen.findByText(/2 historical questions unavailable with your current access/)
    ).toBeVisible();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm addressed" })).toBeNull();
    expect(count).toHaveBeenLastCalledWith(2);
});

it("hides stale question text after access is denied on refresh", async () => {
    mockReview.mockRejectedValueOnce(new VantageApiError("Access denied", 403, {}));
    mockLoad
        .mockResolvedValueOnce(view())
        .mockRejectedValue(new VantageApiError("Access denied", 403, {}));
    render(<PendingQuestions agendaId="current-report" />);
    const card = await screen.findByRole("article", { name: view().questions[0]!.question });
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
    expect(
        screen.getByRole("region", { name: "Pending Questions from Previous Reviews" })
    ).not.toHaveTextContent(view().questions[0]!.question);
});

it("does not show a late response from a previously selected report", async () => {
    const old = deferred<PendingHistoricalQuestionsViewV1>();
    mockLoad.mockImplementation((id: string) =>
        id === "old" ? old.promise : Promise.resolve({ ...view(), agendaId: "new", questions: [] })
    );
    const mounted = render(<PendingQuestions key="old" agendaId="old" />);
    mounted.rerender(<PendingQuestions key="new" agendaId="new" />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalledWith("new"));
    await act(async () => old.resolve({ ...view(), agendaId: "old" }));
    expect(screen.queryByRole("article")).toBeNull();
});
