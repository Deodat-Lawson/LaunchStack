/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { ThisWeekScreen } from "~/app/employer/tools/vantage/_screens/ThisWeekScreen";
import { useWeeklyReviewData } from "~/app/employer/tools/vantage/_lib/useWeeklyReviewData";
import { vantageApi } from "~/app/employer/tools/vantage/api";
jest.mock("~/components/tool-app/nav", () => ({ useOptionalToolNav: () => null }));
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
            aria-label="Report history"
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
const proposal = "Propose five customer calls before increasing paid spend";

test("V2 settings, approval and degradation controls stay hidden when the server flag is off", () => {
    data.context.v2Enabled = false;
    data.review.evidence = { topicRetrieval: { degradation: { reason: "provider" } } };
    renderWithLocale(<ThisWeekScreen />, "en");
    expect(screen.queryByRole("heading", { name: "Plan and progress" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve whole plan" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Some topic research was unavailable/)).not.toBeInTheDocument();
});
function report(id = "run-a") {
    return {
        id,
        version: 1,
        decisions: [],
        evidence: {},
        report: {
            headline: `Report ${id}`,
            brief: "A calm weekly brief",
            summary: "The longer summary",
            keyFigures: [],
            topics: [0, 1].map(index => ({
                id: `topic-${index}`,
                title: `Topic ${index}`,
                decisionQuestion: `Question ${index}`,
                recommendation: {
                    call: proposal,
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
const mockRecord = jest.fn();
function card(index = 0) {
    return within(screen.getByTestId(`review-topic-topic-${index}`));
}
function toggle(index = 0) {
    fireEvent.click(
        card(index).getByRole("button", { name: `Decision ${index + 1}: Question ${index}` })
    );
}
const field = (index = 0) => card(index).getByRole("textbox");
beforeEach(() => {
    sessionStorage.clear();
    mockRecord.mockReset().mockResolvedValue(false);
    data = {
        enabled: true,
        loading: false,
        contextLoading: false,
        ready: true,
        review: report(),
        context: { canConfigure: true, policy: { architecture_document_id: "1" }, documents: [] },
        generation: {
            running: false,
            stage: null,
            failedStage: null,
            error: null,
            complete: false,
            startedAt: null,
            visitedStages: [],
        },
        runs: [{ id: "run-a", status: "accepted", review_version: 1, created_at: "2026-11-16" }],
        generate: jest.fn(),
        reload: jest.fn(),
        reloadContext: jest.fn(),
        recordDecision: mockRecord,
        selectReport: jest.fn(),
    };
    (useWeeklyReviewData as jest.Mock).mockImplementation(() => data);
});

test("prefills only the undecided suggestion and does not save on mount, blur or collapsing", () => {
    renderWithLocale(<ThisWeekScreen week="2026-11-18" />, "en");
    expect(useWeeklyReviewData).toHaveBeenCalledWith("2026-11-16");
    expect(card().getByRole("textbox", { name: "Suggested decision" })).toHaveValue(proposal);
    expect(card().getByRole("button", { name: "Confirm and save" })).toBeEnabled();
    fireEvent.blur(field());
    toggle();
    toggle(1);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(mockRecord).not.toHaveBeenCalled();
    expect(
        screen.queryByText("Decide what matters this week, then choose what to commit to.")
    ).not.toBeInTheDocument();
});
test("Confirm and save sends the displayed suggestion unchanged only after the click", async () => {
    data.review.report.topics[0].recommendation.call = "  Keep this suggestion verbatim  ";
    renderWithLocale(<ThisWeekScreen />, "en");
    expect(mockRecord).not.toHaveBeenCalled();
    fireEvent.click(card().getByRole("button", { name: "Confirm and save" }));
    await waitFor(() =>
        expect(mockRecord).toHaveBeenCalledWith("topic-0", "  Keep this suggestion verbatim  ")
    );
});
test("an edit switches to Your decision and Reset restores suggestion without saving", () => {
    renderWithLocale(<ThisWeekScreen />, "en");
    fireEvent.change(field(), { target: { value: "My edited decision" } });
    expect(card().getByRole("textbox", { name: "Your decision" })).toHaveValue(
        "My edited decision"
    );
    expect(
        screen.getByTestId("review-topic-topic-0").querySelector('[data-suggested="false"]')
    ).not.toBeNull();
    fireEvent.click(card().getByRole("button", { name: "Reset to suggestion" }));
    expect(card().getByRole("textbox", { name: "Suggested decision" })).toHaveValue(proposal);
    expect(mockRecord).not.toHaveBeenCalled();
});
test("a deliberately cleared draft stays empty and disabled after folding and re-opening", () => {
    renderWithLocale(<ThisWeekScreen />, "en");
    fireEvent.change(field(), { target: { value: "" } });
    toggle(1);
    toggle();
    expect(card().getByRole("textbox", { name: "Your decision" })).toHaveValue("");
    expect(card().getByRole("button", { name: "Record decision" })).toBeDisabled();
    expect(card().getByRole("button", { name: "Reset to suggestion" })).toBeVisible();
    expect(mockRecord).not.toHaveBeenCalled();
});
test("topic drafts survive collapsing and report changes, including newer edits during a save", async () => {
    let finish!: (value: boolean) => void;
    mockRecord.mockReturnValue(
        new Promise<boolean>(resolve => {
            finish = resolve;
        })
    );
    const view = renderWithLocale(<ThisWeekScreen />, "en");
    fireEvent.change(field(), { target: { value: "Submitted" } });
    fireEvent.click(card().getByRole("button", { name: "Record decision" }));
    fireEvent.change(field(), { target: { value: "Newer" } });
    toggle(1);
    fireEvent.change(field(1), { target: { value: "Other topic" } });
    await act(async () => {
        finish(true);
    });
    toggle();
    expect(field()).toHaveValue("Newer");
    toggle(1);
    expect(field(1)).toHaveValue("Other topic");
    data.review = report("history");
    view.rerender(<ThisWeekScreen />);
    expect(field()).toHaveValue(proposal);
    data.review = report();
    view.rerender(<ThisWeekScreen />);
    expect(field(1)).toHaveValue("Other topic");
});
test("topics without recommendations start empty and use Record decision", () => {
    data.review.report.topics[0].recommendation = null;
    renderWithLocale(<ThisWeekScreen />, "en");
    expect(card().getByRole("textbox", { name: "Your decision" })).toHaveValue("");
    expect(card().getByRole("button", { name: "Record decision" })).toBeDisabled();
    expect(card().queryByRole("button", { name: "Reset to suggestion" })).not.toBeInTheDocument();
});
test("Change decision prefills the latest recorded text, then appends only on explicit save", async () => {
    data.review.decisions = [
        { topicId: "topic-0", decision: "Earlier", version: 2, recordedAt: "2026-11-16T10:00:00Z" },
        {
            topicId: "topic-0",
            decision: "Human decision\nSecond line",
            version: 3,
            recordedAt: "2026-11-16T11:00:00Z",
        },
    ];
    renderWithLocale(<ThisWeekScreen />, "en");
    expect(screen.getByTestId("review-topic-topic-1")).toHaveAttribute("data-state", "open");
    expect(card().getByRole("button", { name: "Decision 1: Question 0" })).toHaveTextContent(
        "Human decision"
    );
    toggle();
    fireEvent.click(card().getByRole("button", { name: "Change decision" }));
    expect(card().getByRole("textbox", { name: "Your decision" })).toHaveValue(
        "Human decision\nSecond line"
    );
    expect(mockRecord).not.toHaveBeenCalled();
    expect(card().queryByText("Earlier")).not.toBeInTheDocument();
    fireEvent.click(card().getByRole("button", { name: "Record decision" }));
    await waitFor(() =>
        expect(mockRecord).toHaveBeenCalledWith("topic-0", "Human decision\nSecond line")
    );
});
test("successful saves tint the decided row, advance once and update the segmented count", async () => {
    mockRecord.mockImplementation(async (topicId: string, text: string) => {
        data = {
            ...data,
            review: {
                ...data.review,
                decisions: [
                    ...data.review.decisions,
                    { topicId, decision: text, version: 2, recordedAt: "2026-11-16T10:00:00Z" },
                ],
            },
        };
        return true;
    });
    renderWithLocale(<ThisWeekScreen />, "en");
    fireEvent.click(card().getByRole("button", { name: "Confirm and save" }));
    await waitFor(() =>
        expect(screen.getByTestId("review-topic-topic-1")).toHaveAttribute("data-state", "open")
    );
    expect(screen.getByTestId("review-topic-topic-0")).toHaveAttribute("data-state", "closed");
    expect(screen.getByText("1 of 2 topics decided")).toBeVisible();
    expect(screen.getByRole("img", { name: "Decision 1: Decided" })).toHaveAttribute(
        "data-decided",
        "true"
    );
    fireEvent.click(card(1).getByRole("button", { name: "Confirm and save" }));
    await waitFor(() => expect(screen.getByText("2 of 2 topics decided")).toBeVisible());
    expect(screen.getByTestId("review-topic-topic-1")).toHaveAttribute("data-state", "closed");
});
test("week arrows replace the date input and the current report regenerates", () => {
    renderWithLocale(<ThisWeekScreen week="2026-11-16" />, "en");
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(useWeeklyReviewData).toHaveBeenLastCalledWith("2026-11-09");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(useWeeklyReviewData).toHaveBeenLastCalledWith("2026-11-16");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(data.generate).toHaveBeenCalledTimes(1);
});
test("summary is collapsed, caution omits zero and creation-off preserves history and disables generation", () => {
    data.review.report.topics[0].unknowns = ["Unknown"];
    const view = renderWithLocale(<ThisWeekScreen />, "en");
    expect(screen.queryByText("The longer summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read summary" }));
    expect(screen.getByText("The longer summary")).toBeVisible();
    expect(card().getByRole("button", { name: /Why and evidence/ })).toHaveTextContent("1 unknown");
    expect(card().getByRole("button", { name: /Why and evidence/ })).not.toHaveTextContent(
        "0 conflicts"
    );
    data = { ...data, enabled: false };
    view.rerender(<ThisWeekScreen />);
    expect(screen.getByText("Report run-a")).toBeVisible();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
});
test("progress exposes only server-observed phases", () => {
    data.generation = {
        ...data.generation,
        running: true,
        startedAt: Date.now(),
        stage: "checking",
        visitedStages: ["gathering", "checking"],
    };
    renderWithLocale(<ThisWeekScreen />, "en");
    expect(screen.getByTestId("review-generation-stage")).toHaveTextContent("Checking the report");
    expect(document.querySelector('[data-stage="writing"]')).toHaveAttribute(
        "data-state",
        "pending"
    );
    expect(document.querySelector('[data-stage="checking"]')).toHaveAttribute(
        "data-state",
        "active"
    );
});

test("review decisions expose no commitment bridge or persisted workflow markers", async () => {
    sessionStorage.setItem("vantage-review-commitments:run-a", '{"topic-0":true}');
    const readStorage = jest.spyOn(Storage.prototype, "getItem");
    const writeStorage = jest.spyOn(Storage.prototype, "setItem");
    try {
        renderWithLocale(<ThisWeekScreen />, "en");
        expect(
            screen.queryByRole("button", { name: "Add to commitments" })
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Added to commitments")).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(field()).toHaveValue(proposal);
        fireEvent.click(card().getByRole("button", { name: "Confirm and save" }));
        await waitFor(() => expect(mockRecord).toHaveBeenCalledWith("topic-0", proposal));
        expect(vantageApi.addCommitment).not.toHaveBeenCalled();
        expect(readStorage).not.toHaveBeenCalledWith("vantage-review-commitments:run-a");
        expect(writeStorage).not.toHaveBeenCalled();
    } finally {
        readStorage.mockRestore();
        writeStorage.mockRestore();
    }
});
