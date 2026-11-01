/** @jest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { AgendaV1Dto, TopicV1Dto, VantageEvidenceRef } from "~/app/employer/tools/vantage/api";
import { agenda, topic, WEEK } from "../vantage/factories";

const mockNavigate = jest.fn();
const mockPatch = jest.fn();
const mockAgendas = jest.fn();
const mockReview = jest.fn();
const mockSource = jest.fn();
const mockEditor = jest.fn();
const mockDecision = jest.fn();
jest.mock("~/components/tool-app/nav", () => ({ useToolNav: () => ({ navigate: mockNavigate }) }));
jest.mock("~/components/tool-app/ToolLink", () => ({
    ToolLink: ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    ),
}));
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual("~/app/employer/tools/vantage/api"),
    vantageApi: {
        agendas: (...args: unknown[]) => mockAgendas(...args),
        patchTopic: (...args: unknown[]) => mockPatch(...args),
        reviewEnhancement: (...args: unknown[]) => mockReview(...args),
        commitments: async () => ({ commitments: [] }),
        metrics: async () => ({ definitions: [], observations: [] }),
    },
}));
jest.mock("~/app/employer/tools/vantage/_components/SourceDialog", () => ({
    ...jest.requireActual("~/app/employer/tools/vantage/_components/SourceDialog"),
    SourceDialog: ({ sourceRef }: { sourceRef: VantageEvidenceRef | null }) => {
        mockSource(sourceRef);
        return null;
    },
}));
jest.mock("~/app/employer/tools/vantage/_components/TopicDialogs", () => ({
    TopicDialog: ({ open, initial }: { open: boolean; initial: TopicV1Dto | null }) => {
        mockEditor(open, initial);
        return null;
    },
    DecisionDialog: ({ open, topic: value }: { open: boolean; topic: TopicV1Dto | null }) => {
        mockDecision(open, value);
        return null;
    },
}));
import { AgendaScreen } from "~/app/employer/tools/vantage/_screens/AgendaScreen";

const citation: VantageEvidenceRef = {
    ref: "ev:original-id",
    label: "Customer interview",
    date: "2026-10-01",
};
const nativeTopic: TopicV1Dto = {
    ...topic({
        title: "Resolve onboarding delays",
        origin: "rules",
        whyItMatters: "Pilot launch is blocked.",
        decisionQuestion: "Should we simplify signup?",
        proposedNextStep: "Review the signup flow",
        facts: [{ text: "Three customers could not sign up.", refs: [citation] }],
        unknowns: ["Impact is unknown"],
        rationale: "Customer evidence",
        decision: "Simplify signup",
        commitmentId: "real/action",
    }),
    contentVersion: 7,
};
let saved: AgendaV1Dto;
beforeEach(() => {
    jest.clearAllMocks();
    saved = {
        ...agenda(),
        topics: [{ ...nativeTopic }],
        version: 2,
        reportPeriod: null,
        execution: null,
        enhancements: [],
        summary: "Signup delays need a decision. The complete saved summary remains available.",
    };
    mockAgendas.mockImplementation(async (week: string) =>
        week === WEEK ? { week, agenda: saved, agendas: [] } : { week, agenda: null, agendas: [] }
    );
    mockPatch.mockResolvedValue({});
});
async function openTopic() {
    render(<AgendaScreen week={WEEK} />);
    const row = await screen.findByRole("button", { name: /Resolve onboarding delays/ });
    expect(screen.queryByText("Pilot launch is blocked.")).not.toBeInTheDocument();
    fireEvent.click(row);
    return screen.findByRole("dialog", { name: nativeTopic.title });
}

it("opens native details from a compact truthful row, preserves citations, and restores focus", async () => {
    const detail = await openTopic();
    expect(within(detail).getByText("Rules suggestion · suggested")).toBeInTheDocument();
    expect(within(detail).getByText("Pilot launch is blocked.")).toBeVisible();
    expect(within(detail).getByText("Should we simplify signup?")).toBeVisible();
    expect(within(detail).getByText("Review the signup flow")).toBeVisible();
    expect(within(detail).getByText("Three customers could not sign up.")).not.toBeVisible();
    fireEvent.click(within(detail).getByText("Evidence", { selector: "summary" }));
    expect(within(detail).getByText("Three customers could not sign up.")).toBeVisible();
    fireEvent.click(within(detail).getByRole("button", { name: /Customer interview/ }));
    expect(mockSource).toHaveBeenLastCalledWith(citation);
    fireEvent.click(within(detail).getByText("More details", { selector: "summary" }));
    expect(within(detail).getByText("Impact is unknown")).toBeVisible();
    expect(within(detail).getByText("Content version 7")).toBeVisible();
    fireEvent.click(within(detail).getByRole("button", { name: "Close" }));
    await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: nativeTopic.title })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Resolve onboarding delays/ })).toHaveFocus();
});

it("retains the actual linked action and existing edit and decision topic IDs", async () => {
    const detail = await openTopic();
    expect(within(detail).getByText("Simplify signup")).toBeVisible();
    fireEvent.click(within(detail).getByRole("button", { name: "View linked action" }));
    expect(mockNavigate).toHaveBeenCalledWith("/commitments?action=real%2Faction");
    fireEvent.click(within(detail).getByRole("button", { name: "Edit topic" }));
    expect(mockEditor).toHaveBeenLastCalledWith(true, saved.topics[0]);
    fireEvent.click(within(detail).getByRole("button", { name: "Edit decision" }));
    expect(mockDecision).toHaveBeenLastCalledWith(true, saved.topics[0]);
});

it.each([
    ["Keep topic", "kept"],
    ["Dismiss topic", "dismissed"],
])("%s submits the original ID/version and locks controls while saving", async (label, status) => {
    let finish!: () => void;
    mockPatch.mockImplementation(
        () =>
            new Promise<void>(resolve => {
                finish = resolve;
            })
    );
    const detail = await openTopic();
    fireEvent.click(within(detail).getByRole("button", { name: label }));
    expect(mockPatch).toHaveBeenCalledWith(nativeTopic.id, { status }, 7);
    expect(within(detail).getByRole("button", { name: "Edit topic" })).toBeDisabled();
    expect(within(detail).getByRole("button", { name: "Edit decision" })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() =>
        expect(within(detail).getByRole("button", { name: "Edit topic" })).toBeEnabled()
    );
});

it("keeps edits locked when a successful write cannot refresh the saved report", async () => {
    const detail = await openTopic();
    mockAgendas.mockRejectedValue(new Error("Read unavailable"));
    fireEvent.click(within(detail).getByRole("button", { name: "Keep topic" }));
    await screen.findByText("Your change was saved, but the refreshed report could not be loaded.");
    expect(within(detail).getByRole("button", { name: "Edit topic" })).toBeDisabled();
    expect(within(detail).getByRole("button", { name: "Edit decision" })).toBeDisabled();
});

it("preserves the stale enhancement version lock inside the detail sheet", async () => {
    saved.enhancements = [
        {
            id: "e-original",
            topicId: nativeTopic.id,
            baseTopicVersion: 6,
            kind: "evidence",
            text: "New source",
            rationale: "Additional context",
            refs: [citation],
            status: "suggested",
            createdAt: "2026-10-02T09:00:00.000Z",
        },
    ];
    const detail = await openTopic();
    expect(within(detail).getByRole("button", { name: "Accept addition" })).toBeDisabled();
    expect(within(detail).getByRole("button", { name: "Dismiss addition" })).toBeDisabled();
    expect(mockReview).not.toHaveBeenCalled();
});

it("records a first decision without inventing a linked action", async () => {
    saved.topics = [{ ...nativeTopic, origin: "founder", decision: null, commitmentId: null }];
    const detail = await openTopic();
    expect(within(detail).getByText("Human topic \u00b7 suggested")).toBeVisible();
    expect(
        within(detail).queryByRole("button", { name: "View linked action" })
    ).not.toBeInTheDocument();
    expect(within(detail).queryByText("Saved decision")).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "Record decision" }));
    expect(mockDecision).toHaveBeenLastCalledWith(true, saved.topics[0]);
});
