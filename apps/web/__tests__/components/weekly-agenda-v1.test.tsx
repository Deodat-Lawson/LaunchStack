/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import fixtures from "../../../../docs/design/examples/weekly-decision-agenda-v1.json";
import type { AgendaV1Dto, CommitmentDto } from "~/app/employer/tools/vantage/api";
import type * as ApiModule from "~/app/employer/tools/vantage/api";

const mockNavigate = jest.fn();
const mockAgendas = jest.fn();
const mockPrepare = jest.fn();
const mockReview = jest.fn();
const mockDecide = jest.fn();
const mockPatchTopic = jest.fn();
const mockAgendaById = jest.fn();
const mockEvidence = jest.fn();
const mockEvidenceById = jest.fn();
const mockObservationById = jest.fn();
const mockCommitmentById = jest.fn();
const mockPatchCommitment = jest.fn();
const mockCommitments = jest.fn();
const mockMetrics = jest.fn();
const mockImportMetrics = jest.fn();
jest.mock("~/components/tool-app/nav", () => ({
    useToolNav: () => ({ navigate: mockNavigate, linkFor: (href: string) => href }),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof ApiModule>("~/app/employer/tools/vantage/api"),
    vantageApi: {
        agendas: (...args: unknown[]) => mockAgendas(...args),
        prepare: (...args: unknown[]) => mockPrepare(...args),
        reviewEnhancement: (...args: unknown[]) => mockReview(...args),
        decide: (...args: unknown[]) => mockDecide(...args),
        patchTopic: (...args: unknown[]) => mockPatchTopic(...args),
        agenda: (...args: unknown[]) => mockAgendaById(...args),
        evidence: (...args: unknown[]) => mockEvidence(...args),
        evidenceById: (...args: unknown[]) => mockEvidenceById(...args),
        observationById: (...args: unknown[]) => mockObservationById(...args),
        commitmentById: (...args: unknown[]) => mockCommitmentById(...args),
        patchCommitment: (...args: unknown[]) => mockPatchCommitment(...args),
        commitments: (...args: unknown[]) => mockCommitments(...args),
        metrics: (...args: unknown[]) => mockMetrics(...args),
        overview: () => Promise.resolve(null),
        importMetrics: (...args: unknown[]) => mockImportMetrics(...args),
    },
}));
import { AgendaScreen } from "~/app/employer/tools/vantage/_screens/AgendaScreen";
import { MetricsScreen } from "~/app/employer/tools/vantage/_screens/MetricsScreen";
import { CommitmentsScreen } from "~/app/employer/tools/vantage/_screens/CommitmentsScreen";
import { CheckInRow } from "~/app/employer/tools/vantage/_components/CheckInRow";
import { DecisionDialog, TopicDialog } from "~/app/employer/tools/vantage/_components/TopicDialogs";
import { VantageApiError } from "~/app/employer/tools/vantage/api";
let agenda: AgendaV1Dto;
beforeEach(() => {
    jest.clearAllMocks();
    agenda = JSON.parse(
        JSON.stringify(
            fixtures.http.find(item => item.name === "Generate AI agenda")!.response.body.agenda
        )
    ) as AgendaV1Dto;
    agenda.topics[0]!.status = "kept";
    agenda.topics[0]!.contentVersion = 2;
    agenda.enhancements = [
        {
            ...fixtures.internal.enrichment.enhancements[0]!,
            kind: "question",
            id: "addition",
            status: "suggested",
            createdAt: fixtures.clock,
        },
    ];
    mockAgendas.mockImplementation(() =>
        Promise.resolve({
            week: agenda.weekStart,
            agenda: JSON.parse(JSON.stringify(agenda)),
            agendas: [],
        })
    );
    mockPrepare.mockResolvedValue({ agenda });
    mockEvidence.mockResolvedValue({ evidence: fixtures.internal.input.data.currentEvidence });
    mockEvidenceById.mockResolvedValue({
        evidence: fixtures.internal.input.data.currentEvidence[0],
    });
});

it("renders persisted period and execution metadata without automatic generation", async () => {
    render(<AgendaScreen />);
    expect(await screen.findByText("AI generated")).toBeInTheDocument();
    expect(screen.getByText(/Captured/)).toHaveTextContent("Oct 17, 2026");
    expect(mockPrepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(mockNavigate).toHaveBeenCalledWith("/agenda?week=2026-10-05");
    expect(mockPrepare).not.toHaveBeenCalled();
});
it("shows an absent week separately from an empty generated report", async () => {
    mockAgendas.mockResolvedValue({ week: "2026-10-05", agenda: null, agendas: [] });
    render(<AgendaScreen week="2026-10-05" />);
    expect(await screen.findByText("No saved report for this week")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
    await waitFor(() =>
        expect(mockPrepare).toHaveBeenCalledWith(
            "2026-10-05",
            "configured-model",
            expect.any(AbortSignal)
        )
    );
});
it("opens the actual cited evidence in a source dialog", async () => {
    render(<AgendaScreen />);
    const links = await screen.findAllByRole("button", { name: /Synthetic onboarding interview/ });
    fireEvent.click(links[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(mockEvidenceById).toHaveBeenCalledWith("ev-demo-1");
    expect(
        await within(dialog).findByText("The tester could not find the create-project action.")
    ).toBeInTheDocument();
});
it("requires explicit enhancement acceptance and leaves original content intact", async () => {
    mockReview.mockImplementation(() => {
        agenda.enhancements[0]!.status = "accepted";
        agenda.version++;
        return Promise.resolve({
            enhancement: agenda.enhancements[0],
            agendaVersion: agenda.version,
        });
    });
    render(<AgendaScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept addition" }));
    await waitFor(() =>
        expect(mockReview).toHaveBeenCalledWith("topic-demo-1", "addition", "accepted", 2)
    );
    expect(await screen.findByRole("heading", { name: "Approved addition" })).toBeInTheDocument();
    expect(
        screen.getByText("One synthetic tester could not find the create-project action.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss addition" })).not.toBeInTheDocument();
});
it("prevents accepting an addition based on an older topic version", async () => {
    agenda.topics[0]!.contentVersion = 3;
    render(<AgendaScreen />);
    expect(await screen.findByRole("button", { name: "Accept addition" })).toBeDisabled();
    expect(mockReview).not.toHaveBeenCalled();
});
it("keeps the report visible after a 503 and explains the disconnected adapter", async () => {
    mockPrepare.mockRejectedValue(
        new VantageApiError("Unavailable", 503, { code: "generation_unavailable" })
    );
    render(<AgendaScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("adapter has not been connected");
    expect(screen.getByRole("button", { name: "Regenerate report" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload saved report" })).toBeEnabled();
    expect(
        screen.getByRole("heading", { name: "Clarify the onboarding next step" })
    ).toBeInTheDocument();
});
it("does not invent metadata for legacy reports", async () => {
    agenda.reportPeriod = null;
    agenda.execution = null;
    render(<AgendaScreen />);
    expect(await screen.findByText("Legacy report")).toBeInTheDocument();
    expect(screen.getByText("Generation details unavailable")).toBeInTheDocument();
    expect(screen.queryByText("AI generated")).not.toBeInTheDocument();
});

it("holds a topic conflict for comparison and only reapplies after an explicit choice", async () => {
    const initial = agenda.topics[0]!;
    const latest = {
        ...initial,
        title: "Latest saved title",
        facts: initial.facts.map(fact => ({ ...fact, unsupported: !fact.unsupported })),
        contentVersion: 3,
    };
    mockPatchTopic
        .mockRejectedValueOnce(new VantageApiError("stale", 409, { code: "topic_stale" }))
        .mockResolvedValueOnce({ topic: latest });
    mockAgendaById.mockResolvedValue({ agenda: { ...agenda, topics: [latest] } });
    const onOpenChange = jest.fn();
    render(
        <TopicDialog
            open
            onOpenChange={onOpenChange}
            agendaId={initial.agendaId}
            initial={initial}
            onSaved={jest.fn()}
        />
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My local edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
        await screen.findByRole("region", { name: "Topic conflict comparison" })
    ).toBeInTheDocument();
    expect(screen.getByText("Latest saved title")).toBeInTheDocument();
    expect(mockPatchTopic).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reapply my edits" }));
    await waitFor(() =>
        expect(mockPatchTopic).toHaveBeenLastCalledWith(
            initial.id,
            expect.objectContaining({ title: "My local edit", facts: latest.facts }),
            3
        )
    );
});

it("loads the compared version as a new base before saving a deliberate edit", async () => {
    const initial = agenda.topics[0]!;
    const latest = { ...initial, title: "Latest saved title", contentVersion: 4 };
    mockPatchTopic
        .mockRejectedValueOnce(new VantageApiError("stale", 409, { code: "topic_stale" }))
        .mockResolvedValueOnce({ topic: { ...latest, title: "Edited latest" } });
    mockAgendaById.mockResolvedValue({ agenda: { ...agenda, topics: [latest] } });
    render(
        <TopicDialog
            open
            onOpenChange={jest.fn()}
            agendaId={initial.agendaId}
            initial={initial}
            onSaved={jest.fn()}
        />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load latest version" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited latest" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
        expect(mockPatchTopic).toHaveBeenLastCalledWith(
            initial.id,
            expect.objectContaining({ title: "Edited latest" }),
            4
        )
    );
});

it("requires an action test, freezes an uncertain payload and retries it unchanged", async () => {
    mockDecide
        .mockRejectedValueOnce(new TypeError("Network error"))
        .mockResolvedValueOnce({ topic: agenda.topics[0] });
    render(
        <DecisionDialog
            open
            onOpenChange={jest.fn()}
            topic={agenda.topics[0]!}
            onSaved={jest.fn()}
        />
    );
    fireEvent.change(screen.getByLabelText("What was decided"), {
        target: { value: "Test navigation" },
    });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Founder" } });
    expect(screen.getByRole("button", { name: "Save Decision" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("The test"), {
        target: { value: "Four of five succeed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
    const retry = await screen.findByRole("button", { name: "Retry unchanged submission" });
    expect(screen.getByLabelText("What was decided")).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(mockDecide).toHaveBeenCalledTimes(2));
    expect(mockDecide.mock.calls[1]).toEqual(mockDecide.mock.calls[0]);
});
it("keeps an existing primary action on a decision-only update", () => {
    agenda.topics[0]!.commitmentId = "existing";
    render(
        <DecisionDialog
            open
            onOpenChange={jest.fn()}
            topic={agenda.topics[0]!}
            onSaved={jest.fn()}
        />
    );
    expect(screen.getByRole("switch", { name: "Create action" })).toBeDisabled();
    expect(screen.queryByLabelText("The test")).not.toBeInTheDocument();
});

it.each(["Done", "Missed", "Dropped"])(
    "requires a recorded outcome before marking an action %s",
    async status => {
        const commitment = {
            id: "action-outcome-test",
            title: "Try clearer navigation",
            owner: "Test operator",
            dueOn: "2026-10-24",
            test: "Four of five testers succeed",
            status: "open",
            outcome: null,
            shared: false,
            topicId: null,
            topicTitle: null,
        } as CommitmentDto;
        mockPatchCommitment.mockResolvedValue({
            commitment: { ...commitment, status: status.toLowerCase() },
        });
        const onChange = jest.fn();
        render(<CheckInRow commitment={commitment} onChange={onChange} />);
        fireEvent.click(screen.getByRole("button", { name: "Check in" }));
        fireEvent.click(screen.getByRole("button", { name: status }));
        expect(screen.getByRole("button", { name: "Save check-in" })).toBeDisabled();
        expect(mockPatchCommitment).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText("What was learned"), {
            target: { value: "  Four testers completed the task.  " },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save check-in" }));
        await waitFor(() =>
            expect(mockPatchCommitment).toHaveBeenCalledWith(commitment.id, {
                status: status.toLowerCase(),
                outcome: "Four testers completed the task.",
            })
        );
        expect(onChange).toHaveBeenCalledTimes(1);
    }
);

it("shows a resolved linked action without hiding it under the open-action filter", async () => {
    mockCommitments.mockResolvedValue({
        commitments: [
            {
                id: "resolved-action",
                title: "Completed navigation test",
                owner: "Test operator",
                dueOn: "2026-10-24",
                test: "Four testers succeed",
                status: "done",
                outcome: "Four completed it",
                shared: false,
            },
        ],
    });
    render(<CommitmentsScreen actionId="resolved-action" />);
    expect(await screen.findByText("Completed navigation test")).toBeInTheDocument();
    expect(screen.getByText("Learned: Four completed it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all actions" }));
    expect(mockNavigate).toHaveBeenCalledWith("/commitments");
});

it("shows every CSV problem alongside the successfully imported row count", async () => {
    mockMetrics.mockResolvedValue({ definitions: [], observations: [] });
    mockImportMetrics.mockResolvedValue({
        imported: 1,
        createdMetrics: [],
        problems: Array.from({ length: 10 }, (_, i) => ({
            line: i + 3,
            message: `Invalid date in row ${i + 3}`,
        })),
    });
    render(<MetricsScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Import CSV" })[0]!);
    fireEvent.change(screen.getByLabelText("CSV"), {
        target: { value: "metric,value,period_start,period_end\nsignups,1,2026-10-12,2026-10-17" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    expect(await screen.findByText("1 number imported.")).toBeInTheDocument();
    expect(
        within(screen.getByRole("list", { name: "Import problems" })).getAllByRole("listitem")
    ).toHaveLength(10);
    expect(screen.getByText("Line 12: Invalid date in row 12")).toBeInTheDocument();
});

it("does not present a partial week against a full week as a comparable metric trend", async () => {
    mockMetrics.mockResolvedValue({
        definitions: fixtures.internal.input.data.metricDefinitions,
        observations: [
            ...fixtures.internal.input.data.currentObservations,
            {
                ...fixtures.internal.input.data.comparisonObservations[0],
                periodStart: "2026-10-05",
                periodEnd: "2026-10-11",
                value: 60,
            },
        ],
    });
    render(<MetricsScreen />);
    expect(await screen.findByText("No trend: reporting periods differ.")).toBeInTheDocument();
    expect(screen.queryByText("+100%")).not.toBeInTheDocument();
});

it("returns keyboard focus to the topic editor's opener after Escape", async () => {
    render(<AgendaScreen />);
    const opener = await screen.findByRole("button", { name: "Edit topic" });
    opener.focus();
    fireEvent.click(opener);
    const title = await screen.findByLabelText("Title");
    await waitFor(() => expect(title).toHaveFocus());
    fireEvent.keyDown(title, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
});
