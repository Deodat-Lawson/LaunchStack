/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
jest.mock("next-intl", () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
jest.mock("~/app/employer/tools/vantage/_lib/weekly-review-errors", () => ({
    useWeeklyReviewErrorText: () => () => "Request failed",
}));
jest.mock("~/app/employer/tools/vantage/_lib/format", () => ({
    useVantageFormat: () => ({
        date: (value: string) => value,
        dateLong: (value: string) => value,
        dateTime: (value: string) => value,
        list: (values: string[]) => values.join(", "),
        number: (value: number) => String(value),
    }),
}));
jest.mock("~/components/tool-app/nav", () => ({ useOptionalToolNav: () => null }));

import { ThisWeekScreen } from "~/app/employer/tools/vantage/_screens/ThisWeekScreen";
import { useWeeklyReviewData } from "~/app/employer/tools/vantage/_lib/useWeeklyReviewData";
jest.mock("~/app/employer/tools/vantage/_lib/useWeeklyReviewData", () => ({
    useWeeklyReviewData: jest.fn(),
}));
jest.mock("~/app/employer/tools/vantage/api", () => ({
    weeklyReviewApi: { evidence: jest.fn() },
    vantageApi: { addCommitment: jest.fn() },
}));
jest.mock("~/components/ui/select", () => ({
    Select: ({ children, value, onValueChange }: any) => (
        <select
            aria-label="history"
            value={value ?? ""}
            onChange={event => onValueChange(event.target.value)}
        >
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
function report(id = "run-a") {
    return {
        id,
        decisions: [],
        evidence: {},
        report: {
            headline: `Report ${id}`,
            brief: "Brief",
            summary: "Summary",
            keyFigures: [],
            topics: [0, 1].map(index => ({
                id: `topic-${index}`,
                title: `Topic ${index}`,
                decisionQuestion: `Question ${index}`,
                recommendation: {
                    call: "Proposed call",
                    confidence: "low",
                    because: "Reason",
                    wouldChangeIf: "New evidence",
                    refs: [],
                },
                proposedNextStep: "Next step",
                proposedOwner: null,
                proposedDue: null,
                helpRequested: null,
                facts: [],
                conflicts: [],
                unknowns: [],
                whyItMatters: "Why",
                whyNow: "Now",
                rationale: "Reason",
            })),
        },
    };
}
let data: any;
beforeEach(() => {
    sessionStorage.clear();
    data = {
        enabled: true,
        loading: false,
        contextLoading: false,
        ready: true,
        review: report(),
        context: { policy: { architecture_document_id: "1" }, documents: [] },
        generation: {
            running: false,
            stage: null,
            failedStage: null,
            error: null,
            complete: false,
            startedAt: null,
            visitedStages: [],
        },
        runs: [
            { id: "run-a", status: "accepted", review_version: 1 },
            { id: "history", status: "accepted", review_version: 2 },
        ],
        generate: jest.fn(),
        reload: jest.fn(),
        reloadContext: jest.fn(),
        recordDecision: jest.fn().mockResolvedValue(true),
        selectReport: jest.fn(),
    };
    (useWeeklyReviewData as jest.Mock).mockImplementation(() => data);
});
test("starts with blank human drafts and normalizes the reporting week to Monday", () => {
    render(<ThisWeekScreen week="2026-11-18" />);
    expect(useWeeklyReviewData).toHaveBeenCalledWith("2026-11-16");
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("");
    expect(screen.getAllByRole("button", { name: "founder.recordDecision" })[0]).toBeDisabled();
});
test("saving clears only the submitted object and preserves newer and other-topic drafts", async () => {
    const save = deferred<boolean>();
    data.recordDecision.mockReturnValue(save.promise);
    render(<ThisWeekScreen week="2026-11-16" />);
    const fields = screen.getAllByRole("textbox");
    fireEvent.change(fields[0]!, { target: { value: "First decision" } });
    fireEvent.change(fields[1]!, { target: { value: "Other draft" } });
    fireEvent.click(screen.getAllByRole("button", { name: "founder.recordDecision" })[0]!);
    fireEvent.change(fields[0]!, { target: { value: "Newer draft" } });
    await act(async () => {
        save.resolve(true);
    });
    expect(fields[0]).toHaveValue("Newer draft");
    expect(fields[1]).toHaveValue("Other draft");
    expect(data.recordDecision).toHaveBeenCalledWith("topic-0", "First decision");
});
test("restores drafts when returning to a historical report and retains prior report on generation failure", () => {
    const view = render(<ThisWeekScreen week="2026-11-16" />);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Saved locally" } });
    data = { ...data, review: report("history") };
    view.rerender(<ThisWeekScreen week="2026-11-16" />);
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("");
    data = {
        ...data,
        review: report(),
        generation: { ...data.generation, error: "Generation failed", failedStage: "checking" },
    };
    view.rerender(<ThisWeekScreen week="2026-11-16" />);
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("Saved locally");
    expect(screen.getByText("Report run-a")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Request failed");
});
test("disabled feature has its own empty state", () => {
    data = { ...data, enabled: false };
    render(<ThisWeekScreen />);
    expect(screen.getByText("founder.disabledTitle")).toBeVisible();
    expect(screen.queryByText("Report run-a")).not.toBeInTheDocument();
});

test("successful save clears an unchanged draft and stale save preserves it", async () => {
    const save = deferred<boolean>();
    data.recordDecision.mockReturnValueOnce(save.promise);
    render(<ThisWeekScreen week="2026-11-16" />);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Confirmed" } });
    fireEvent.click(screen.getAllByRole("button", { name: "founder.recordDecision" })[0]!);
    await act(async () => {
        save.resolve(true);
    });
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("");
    data.recordDecision.mockResolvedValueOnce(false);
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Keep stale draft" } });
    fireEvent.click(screen.getAllByRole("button", { name: "founder.recordDecision" })[0]!);
    await waitFor(() =>
        expect(screen.getAllByRole("button", { name: "founder.recordDecision" })[0]).toBeEnabled()
    );
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("Keep stale draft");
});

test("a newer edit with the same text is retained by draft identity", async () => {
    const save = deferred<boolean>();
    data.recordDecision.mockReturnValueOnce(save.promise);
    render(<ThisWeekScreen week="2026-11-16" />);
    const field = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(field, { target: { value: "Decision A" } });
    fireEvent.click(screen.getAllByRole("button", { name: "founder.recordDecision" })[0]!);
    fireEvent.change(field, { target: { value: "Decision B" } });
    fireEvent.change(field, { target: { value: "Decision A" } });
    await act(async () => {
        save.resolve(true);
    });
    expect(field).toHaveValue("Decision A");
});
test("progress exposes only phases observed from the server", () => {
    data = {
        ...data,
        generation: {
            ...data.generation,
            running: true,
            startedAt: Date.now(),
            stage: "checking",
            visitedStages: ["gathering", "checking"],
        },
    };
    render(<ThisWeekScreen week="2026-11-16" />);
    expect(
        screen.getByRole("list", { name: "founder.generation.progressLabel" })
    ).toHaveTextContent("founder.generation.gathering");
    expect(screen.getByRole("status")).toHaveTextContent("founder.generation.checking");
    expect(document.querySelector('[data-stage="writing"]')).toHaveAttribute(
        "data-state",
        "pending"
    );
    expect(document.querySelector('[data-stage="saving"]')).toHaveAttribute(
        "data-state",
        "pending"
    );
    expect(document.querySelector('[data-stage="checking"]')).toHaveAttribute(
        "data-state",
        "active"
    );
});
