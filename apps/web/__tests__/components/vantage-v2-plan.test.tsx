/** @jest-environment jsdom */
import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { V2PlanPanel } from "~/app/employer/tools/vantage/_components/V2PlanPanel";
import { v2Api, type V2Plan } from "~/app/employer/tools/vantage/v2-api";
import { VantageApiError } from "~/app/employer/tools/vantage/api";

jest.mock("~/app/employer/tools/vantage/v2-api", () => ({
    v2Api: {
        settings: jest.fn(),
        plan: jest.fn(),
        approve: jest.fn(),
        create: jest.fn(),
        edit: jest.fn(),
        remove: jest.fn(),
        action: jest.fn(),
        saveSettings: jest.fn(),
    },
}));
const review: any = {
    id: "review-1",
    evidence: {},
    report: {
        topics: [{ id: "topic", title: "Choose an option", facts: [], conflicts: [] }],
        keyFigures: [],
    },
};
let plan: V2Plan;
beforeEach(() => {
    jest.resetAllMocks();
    plan = {
        id: "plan-1",
        reviewId: review.id,
        version: 3,
        hash: "hash-three",
        approvedVersion: null,
        approvedHash: null,
        discarded: [],
        tasks: [
            {
                id: "task",
                parentId: null,
                topicId: "topic",
                title: "Compare options",
                description: "Review the options",
                acceptanceCriterion: "Compare both options",
                priority: "medium",
                assigneeType: "owner",
                assigneeId: "me",
                status: "proposed",
                version: 2,
                refs: [],
                provenance: "proposal",
            },
        ],
    };
    jest.mocked(v2Api.settings).mockResolvedValue({
        goals: ["Reduce churn"],
        personaIds: [],
        personas: [],
    });
    jest.mocked(v2Api.plan).mockImplementation(async () => ({ plan }));
    jest.mocked(v2Api.approve).mockResolvedValue({});
    jest.mocked(v2Api.action).mockResolvedValue({});
});

test("top-level proposals appear as editable tasks under the accepted decision topic", async () => {
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    expect(await screen.findByRole("heading", { name: "Choose an option" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue("Compare options");
    expect(screen.getByRole("button", { name: "Remove task" })).toBeEnabled();
});

test("approval binds exact displayed version/hash and stale approval refreshes without replay", async () => {
    jest.mocked(v2Api.approve).mockRejectedValueOnce(new VantageApiError("stale_plan", 409, null));
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    const approve = await screen.findByRole("button", { name: "Approve whole plan" });
    expect(v2Api.approve).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await screen.findByText(/This plan changed/);
    expect(v2Api.approve).toHaveBeenCalledTimes(1);
    expect(v2Api.approve).toHaveBeenCalledWith(
        expect.objectContaining({ version: 3, hash: "hash-three" })
    );
    expect(v2Api.plan).toHaveBeenCalledTimes(2);
});

test("unsaved edits block approval and uncited action has no citation chip", async () => {
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    const field = await screen.findByRole("textbox", { name: "Task title" });
    fireEvent.change(field, { target: { value: "New title" } });
    expect(screen.getByRole("button", { name: "Approve whole plan" })).toBeDisabled();
    expect(screen.getByText("Suggested action · no supporting citation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /source/i })).not.toBeInTheDocument();
});

test("manual completion requires notes and sends task version and result", async () => {
    plan = { ...plan, approvedVersion: 3, approvedHash: "hash-three" };
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    const complete = await screen.findByRole("button", { name: "Record manual completion" });
    expect(complete).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Completion notes" }), {
        target: { value: "Compared both options" },
    });
    fireEvent.click(complete);
    await waitFor(() =>
        expect(v2Api.action).toHaveBeenCalledWith(
            expect.objectContaining({ id: "task", version: 2 }),
            "complete",
            "Compared both options"
        )
    );
});

test("editing an approved acceptance criterion clears displayed consent after authoritative refresh", async () => {
    plan = { ...plan, approvedVersion: 3, approvedHash: "hash-three" };
    jest.mocked(v2Api.edit).mockImplementation(async () => {
        plan = {
            ...plan,
            version: 4,
            hash: "hash-four",
            approvedVersion: null,
            approvedHash: null,
            tasks: plan.tasks.map(task =>
                task.id === "task"
                    ? { ...task, version: 3, acceptanceCriterion: "Document the trade-offs" }
                    : task
            ),
        };
        return {};
    });
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    const criterion = await screen.findByRole("textbox", { name: "Acceptance criterion" });
    expect(criterion).toBeEnabled();
    fireEvent.change(criterion, { target: { value: "Document the trade-offs" } });
    expect(screen.getByRole("button", { name: "Record manual completion" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await screen.findByText("Plan version 4");
    expect(v2Api.edit).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2 }),
        expect.objectContaining({ acceptanceCriterion: "Document the trade-offs" })
    );
    expect(
        screen.queryByRole("button", { name: "Record manual completion" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve whole plan" })).toBeEnabled();
});

test("read-only access disables mutations and Chinese controls render", async () => {
    renderWithLocale(
        <V2PlanPanel review={review} canEdit={false} onInspect={jest.fn()} />,
        "zh-CN"
    );
    expect(await screen.findByRole("button", { name: "批准整个计划" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存目标与智能体" })).toBeDisabled();
});

test("saving one task preserves an unchanged sibling's unsaved draft", async () => {
    plan.tasks.push({ ...plan.tasks[0]!, id: "sibling", title: "Second task" });
    jest.mocked(v2Api.edit).mockImplementation(async () => {
        plan = {
            ...plan,
            version: 4,
            hash: "hash-four",
            tasks: plan.tasks.map(task =>
                task.id === "task" ? { ...task, version: 3, title: "Saved first task" } : task
            ),
        };
        return {};
    });
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    const titles = await screen.findAllByRole("textbox", { name: "Task title" });
    fireEvent.change(titles[0]!, { target: { value: "Saved first task" } });
    fireEvent.change(titles[1]!, { target: { value: "Unsaved sibling draft" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save task" })[0]!);
    await screen.findByText("Plan version 4");
    expect(screen.getByDisplayValue("Unsaved sibling draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve whole plan" })).toBeDisabled();
});

test("degraded brief and safe task failure remain visible with a manual Run control", async () => {
    plan = {
        ...plan,
        approvedVersion: 3,
        approvedHash: "hash-three",
        tasks: plan.tasks.map(task =>
            task.id === "task"
                ? {
                      ...task,
                      assigneeType: "persona",
                      assigneeId: "agent",
                      status: "failed",
                      reason: "task_provider_unavailable",
                      result: "Partial comparison",
                  }
                : task
        ),
    };
    renderWithLocale(
        <V2PlanPanel
            review={{
                ...review,
                evidence: { topicRetrieval: { degradation: { reason: "provider" } } },
            }}
            canEdit
            onInspect={jest.fn()}
        />,
        "en"
    );
    expect(
        await screen.findByText(
            "Latest reason: The agent provider is unavailable. Try again later."
        )
    ).toBeInTheDocument();
    expect(screen.getByText("Partial comparison")).toBeInTheDocument();
    expect(screen.getByText(/Some topic research was unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
        expect(v2Api.action).toHaveBeenCalledWith(
            expect.objectContaining({ id: "task", version: 2 }),
            "run",
            undefined
        )
    );
});

test("typed result renders findings with inspectable refs and questions, unknown reasons stay private", async () => {
    const inspect = jest.fn();
    plan = {
        ...plan,
        approvedVersion: 3,
        approvedHash: "hash-three",
        tasks: plan.tasks.map(task =>
            task.id === "task"
                ? {
                      ...task,
                      assigneeType: "persona",
                      status: "submitted",
                      reason: "unrecognized-internal-detail",
                      latestAttempt: {
                          id: "attempt-1",
                          number: 2,
                          status: "submitted",
                          leaseUntil: null,
                      },
                      structuredResult: {
                          summary: "A comparison draft",
                          claims: [{ text: "Vendor A supports SSO", refs: ["doc:1@v1"] }],
                          unknowns: ["What is the renewal price?"],
                          disposition: "ready_for_review",
                      },
                  }
                : task
        ),
    };
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={inspect} />, "en");
    expect(await screen.findByText("A comparison draft")).toBeInTheDocument();
    expect(screen.getByText("Vendor A supports SSO")).toBeInTheDocument();
    expect(screen.getByText("What is the renewal price?")).toBeInTheDocument();
    expect(screen.getByText("Latest attempt 2: Awaiting review")).toBeInTheDocument();
    expect(screen.queryByText(/unrecognized-internal-detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /doc:1@v1/ }));
    expect(inspect).toHaveBeenCalledWith("doc:1@v1");
});

test("an accepted result stays visible without asking the owner to review it again", async () => {
    plan = {
        ...plan,
        approvedVersion: 3,
        approvedHash: "hash-three",
        tasks: [
            {
                ...plan.tasks[0]!,
                assigneeType: "persona",
                status: "completed",
                structuredResult: {
                    summary: "A comparison the owner accepted",
                    claims: [],
                    unknowns: [],
                    disposition: "ready_for_review",
                },
            },
        ],
    };
    renderWithLocale(<V2PlanPanel review={review} canEdit onInspect={jest.fn()} />, "en");
    expect(await screen.findByText("A comparison the owner accepted")).toBeInTheDocument();
    expect(screen.queryByText("Agent draft awaiting your review.")).not.toBeInTheDocument();
});
