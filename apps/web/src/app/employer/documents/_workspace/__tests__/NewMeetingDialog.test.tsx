/** @jest-environment jsdom */

/**
 * Starting a meeting: a plain "New meeting" opens on a real workflow, every
 * setting is on screen without a disclosure, re-picking the workflow already
 * applied keeps the person's edits, a moderated room always has a chair who
 * is in it, and Start says what is missing before it posts the plan.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { MEETING_WORKFLOWS, meetingWorkflow } from "~/lib/agents/meeting-workflows";
import type { AgentPersonaRecord, AgentsResponse } from "../collab/types";

function persona(id: string, displayName: string, role: string): AgentPersonaRecord {
    return {
        id,
        displayName,
        role,
        dbId: `db-${id}`,
        systemPrompt: "",
        archived: false,
        description: "",
        mode: "all",
        tools: null,
        style: null,
        builtin: true,
        accent: null,
        avatarUrl: null,
        nodeId: null,
    };
}

const mockAgents: AgentsResponse = {
    personas: [
        persona("facilitator", "Ada", "Facilitator"),
        persona("analyst", "Ravi", "Analyst"),
        persona("finance", "Dana", "Finance partner"),
        persona("engineer", "Sam", "Engineering lead"),
        persona("critic", "Vera", "Devil's advocate"),
        persona("sales", "Noor", "Sales lead"),
    ],
    nodes: [],
    network: { enabled: false, hubId: null, hubPath: "" },
    slack: { canPost: false, canReceive: false, missing: ["SLACK_BOT_TOKEN"] },
};

jest.mock("../collab/useMeetings", () => ({
    useAgents: () => ({ data: mockAgents, loading: false, error: null, refresh: jest.fn() }),
}));

import { NewMeetingDialog } from "../collab/NewMeetingDialog";

// Radix's radio group and switch measure themselves; jsdom has no ResizeObserver.
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const mockFetch = jest.fn<
    Promise<{ ok: boolean; json: () => Promise<unknown> }>,
    [string, RequestInit]
>();

beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ meeting: { id: "m-1" } }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;
});

function renderDialog(initialWorkflowKey: string | null = null) {
    const onCreated = jest.fn();
    render(
        <NewMeetingDialog
            open
            onClose={jest.fn()}
            onCreated={onCreated}
            initialWorkflowKey={initialWorkflowKey}
        />
    );
    return { onCreated, user: userEvent.setup() };
}

describe("NewMeetingDialog", () => {
    it("opens a plain New meeting on the first workflow in the list, not a blank room", () => {
        renderDialog();
        const first = MEETING_WORKFLOWS[0]!;
        expect(screen.getByLabelText("Title")).toHaveValue(first.title);
        expect(screen.getByLabelText("Objective")).toHaveValue(first.objectiveTemplate);
        expect(screen.getByRole("button", { name: new RegExp(`^${first.title}`) })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
    });

    it("shows how the meeting runs without a disclosure", () => {
        renderDialog("daci-decision");
        expect(screen.getByRole("radiogroup", { name: "Who speaks next" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Chair" })).toHaveTextContent("Ada");
        // The four DACI phases add up to ten turns.
        expect(screen.getByLabelText("Turn limit")).toHaveValue(10);
        expect(screen.getByLabelText("Agenda")).toBeInTheDocument();
        // No bot token: the channel field is there, and says why it is off.
        expect(screen.getByLabelText("Slack mirror")).toBeDisabled();
        expect(screen.getByText(/Set SLACK_BOT_TOKEN to enable mirroring/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /show agenda/i })).not.toBeInTheDocument();
    });

    it("keeps edits when the applied workflow is picked again, and re-plans on another", async () => {
        const { user } = renderDialog("daci-decision");
        const objective = screen.getByLabelText("Objective");
        await user.clear(objective);
        await user.type(objective, "Pick the Q4 launch date");

        await user.click(screen.getByRole("button", { name: /^DACI decision/ }));
        expect(objective).toHaveValue("Pick the Q4 launch date");

        await user.click(screen.getByRole("button", { name: /^Pre-mortem/ }));
        expect(objective).toHaveValue(meetingWorkflow("premortem")!.objectiveTemplate);
        expect(screen.getByLabelText("Title")).toHaveValue("Pre-mortem");
        expect(screen.getByRole("button", { name: /^Noor/ })).toHaveAttribute(
            "aria-pressed",
            "true"
        );
    });

    it("hands the chair to someone still in the room when the chair is unseated", async () => {
        const { user } = renderDialog("daci-decision");
        const chair = screen.getByRole("combobox", { name: "Chair" });
        expect(chair).toHaveTextContent("Ada");

        await user.click(screen.getByRole("button", { name: /^Ada/ }));
        expect(screen.getByRole("button", { name: /^Ada/ })).toHaveAttribute(
            "aria-pressed",
            "false"
        );
        await waitFor(() => expect(chair).toHaveTextContent("Ravi"));
    });

    it("says what is missing before Start enables, then posts the plan", async () => {
        const { user, onCreated } = renderDialog("daci-decision");
        const start = screen.getByRole("button", { name: "Start meeting" });
        const title = screen.getByLabelText("Title");

        await user.clear(title);
        expect(start).toBeDisabled();
        expect(screen.getByText("Add a title to start.")).toBeInTheDocument();

        await user.type(title, "Q4 launch date");
        expect(start).toBeEnabled();
        await user.click(start);
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith("m-1"));

        const [url, init] = mockFetch.mock.calls[0]!;
        expect(url).toBe("/api/collab/meetings");
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).toMatchObject({
            title: "Q4 launch date",
            workflowKey: "daci-decision",
            turnPolicy: "moderated",
            moderatorKey: "facilitator",
            participantKeys: ["facilitator", "analyst", "finance", "engineer", "critic"],
            maxTurns: 10,
            slackMirrorEnabled: false,
            autoStart: true,
        });
        expect((body.phases as { id: string }[]).map(phase => phase.id)).toEqual([
            "frame",
            "contribute",
            "challenge",
            "recommend",
        ]);
    });
});
