/** @jest-environment jsdom */
/** Synthetic API doubles exercise UI behavior; these are not provider or database tests. */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type * as DemoApi from "~/app/employer/tools/vantage/demo-api";
import type { DemoReport, DemoSource, DemoState } from "~/app/employer/tools/vantage/demo-contract";
import { resolveRoleSelectionV0 } from "@launchstack/pipelines/vantage/role-context-v0";
import type { DemoPersonalContextView } from "~/app/employer/tools/vantage/demo-personal-client";

const mockToast = jest.fn();
jest.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => mockToast(...args) } }));
const mockLoad = jest.fn();
const mockGenerate = jest.fn();
const mockReview = jest.fn();
const mockSource = jest.fn();
const mockNavigate = jest.fn();
let mockQuery = "";
const originalFetch = globalThis.fetch;
jest.mock("~/app/employer/tools/vantage/demo-api", () => ({
    ...jest.requireActual<typeof DemoApi>("~/app/employer/tools/vantage/demo-api"),
    vantageDemoApi: {
        state: (...args: unknown[]) => mockLoad(...args),
        generate: (...args: unknown[]) => mockGenerate(...args),
        review: (...args: unknown[]) => mockReview(...args),
        source: (...args: unknown[]) => mockSource(...args),
    },
}));
jest.mock("~/components/tool-app/nav", () => ({
    useToolNav: () => ({ searchParams: new URLSearchParams(mockQuery), navigate: mockNavigate }),
}));
jest.mock("~/components/tool-app/ToolLink", () => {
    const { createElement, forwardRef } = jest.requireActual<typeof React>("react");
    return {
        ToolLink: forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement>>(
            function ToolLink(props, ref) {
                return createElement("a", { ...props, ref });
            }
        ),
    };
});
jest.mock("~/app/employer/tools/vantage/_components/PendingQuestions", () => {
    const { createElement } = jest.requireActual<typeof React>("react");
    return {
        PendingQuestions: ({ agendaId }: { agendaId: string }) =>
            createElement(
                "section",
                { "aria-label": "Native pending queue" },
                `Native pending report ${agendaId}`
            ),
    };
});
jest.mock("~/app/employer/tools/vantage/_screens/AgendaScreen", () => {
    const { createElement } = jest.requireActual<typeof React>("react");
    return {
        AgendaScreen: ({ week }: { week?: string }) =>
            createElement(
                "div",
                { "data-testid": "native-week" },
                `Native week ${week ?? "wall-clock"}`
            ),
    };
});

import { DemoApiError } from "~/app/employer/tools/vantage/demo-api";
import {
    ContextDemoScreen,
    ContextNativeReview,
} from "~/app/employer/tools/vantage/_screens/ContextDemoScreen";

const company: DemoSource = {
    title: "Company Architecture",
    body: JSON.stringify({
        facts: [
            { label: "Name", value: "Synthetic Orbit" },
            { label: "Privacy review", value: "An engineering pass is not acceptance approval." },
        ],
        unknowns: [{ code: "decision_authority_unknown" }],
    }),
    source: { kind: "company", id: "company-metadata/42", version: "profile-v1" },
    sourceDate: "2026-10-16T16:00:00.000Z",
    contentHash: "company-content-sha",
    reviewState: "unreviewed",
    authority: "Unreviewed company context, not a current implementation claim.",
};
const qa: DemoSource = {
    title: "QA sample record",
    body: "QA reports three of three sampled accounts deleted, without privacy sign-off.",
    source: { kind: "doc", id: "workspace-document/12", version: "17" },
    sourceDate: "2026-10-16T16:00:00.000Z",
    contentHash: "qa-content-sha",
    authority: "Authorized exact version. Reported test success is not recorded approval.",
};
function report(): DemoReport {
    return {
        id: "native-report-12",
        weekStart: "2026-10-12",
        generatedAt: "2026-10-26T16:00:00.000Z",
        version: 2,
        summary: "A saved synthetic comparison needs a named review before acceptance is inferred.",
        topics: [
            {
                id: "context-topic",
                title: "Compare the recorded sample",
                facts: [{ text: qa.body, refs: [qa.source] }],
                conflicts: [],
                whyItMatters: "The sample and approval are separate observations.",
                decisionQuestion: "What shared sample should the reviewers compare?",
                proposedNextStep: "Compare account identifiers and record unmatched accounts.",
                unknowns: ["Whether the samples overlap."],
                rationale: "The sample mismatch is specific and testable.",
                status: "suggested",
            },
        ],
        execution: {
            mode: "ai",
            modelId: "synthetic-test-model",
            promptVersion: "synthetic-context-test/v1",
            attempts: 1,
            durationMs: 100,
            fallbackReason: null,
        },
        diagnostics: {
            sources: [company, qa].map(source => ({
                source: source.source,
                title: source.title,
                contentHash: source.contentHash,
            })),
            contextFingerprint: "synthetic-context-sha",
            persisted: true,
            historicalHumanDecisions: 1,
        },
    };
}
function state(overrides: Partial<DemoState> = {}): DemoState {
    return {
        weeks: [{ weekStart: "2026-10-05" }, { weekStart: "2026-10-12" }],
        selectedWeek: "2026-10-12",
        report: report(),
        nativeAgendaId: "native-report-12",
        companyArchitecture: company,
        ...overrides,
    };
}
beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = "";
    mockLoad.mockResolvedValue(state());
    mockGenerate.mockResolvedValue(state());
    mockReview.mockResolvedValue(state());
    mockSource.mockImplementation((_reportId: string, ref: DemoSource["source"]) =>
        Promise.resolve(ref.kind === "company" ? company : qa)
    );
});
afterEach(() => {
    globalThis.fetch = originalFetch;
});

async function openPersonalContext() {
    const existing = screen.queryByRole("dialog", { name: "My context" });
    if (existing) return existing;
    fireEvent.click(await screen.findByRole("button", { name: /^My context/ }));
    return screen.getByRole("dialog", { name: "My context" });
}

async function companyInspection() {
    const sheet = await openPersonalContext();
    return within(sheet).getByRole("button", { name: "Inspect profile" });
}

async function savedSummary(text: string) {
    const summary = await screen.findByText(/^Read full brief/);
    const details = summary.closest("details")!;
    if (!details.open) fireEvent.click(summary);
    return within(details).findByText(text);
}

async function reportDetailsForEmptyReport() {
    const summary = await screen.findByText("Sources & report details");
    if (!summary.closest("details")!.open) fireEvent.click(summary);
    return summary.closest("details")!;
}

async function reportDetails() {
    const outer = await screen.findByText("Sources & report details");
    if (!outer.closest("details")!.open) fireEvent.click(outer);
    const summary = within(outer.closest("details")!).getByText(/^Saved report details/);
    if (!summary.closest("details")!.open) fireEvent.click(summary);
    return summary.closest("details")!;
}

async function openTopic() {
    const context = screen.queryByRole("dialog", { name: "My context" });
    if (context) fireEvent.click(within(context).getByRole("button", { name: "Done" }));
    const row = await screen.findByRole("article", { name: "Compare the recorded sample" });
    fireEvent.click(within(row).getByRole("button"));
    return screen.getByRole("dialog", { name: "Compare the recorded sample" });
}

async function openTopicEvidence() {
    const detail = await openTopic();
    return within(detail).getByRole("region", { name: "Source evidence" });
}

it("loads saved context and native pending questions without automatically calling a model", async () => {
    render(<ContextDemoScreen />);
    expect(await savedSummary(report().summary)).toBeVisible();
    expect(screen.getByRole("region", { name: "Native pending queue" })).toHaveTextContent(
        "native-report-12"
    );
    expect(screen.getByRole("link", { name: "Alternative saved report" })).toHaveAttribute(
        "href",
        "/agenda?week=2026-10-12&report=rules"
    );
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockReview).not.toHaveBeenCalled();
});

it("allows exact authorized Company Architecture inspection before a contextual report exists", async () => {
    mockLoad.mockResolvedValue(state({ report: null }));
    render(<ContextDemoScreen />);
    fireEvent.click(await companyInspection());
    const dialog = await screen.findByRole("dialog", { name: "Company Architecture" });
    expect(await within(dialog).findByText("Synthetic Orbit")).toBeVisible();
    expect(within(dialog).getByText("unreviewed")).toBeVisible();
    expect(within(dialog).getByText("decision authority unknown")).toBeVisible();
    expect(mockSource.mock.calls[0]!.slice(0, 2)).toEqual(["native-report-12", company.source]);
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("attributes every same-labeled architecture responsibility to its supplied subject and basis", async () => {
    const rich = {
        ...company,
        body: JSON.stringify({
            facts: [
                {
                    label: "Responsibilities",
                    subject: "Engineering",
                    value: "Supply deletion traces for the identified sample.",
                    basis: "source-extracted-unreviewed",
                },
                {
                    label: "Responsibilities",
                    subject: "Operations",
                    value: "Reconcile QA and audit account identifiers.",
                    basis: "human-entered-unreviewed",
                },
                {
                    label: "Responsibilities",
                    subject: "Privacy reviewer",
                    value: "Assess the acceptance evidence; no approval is recorded here.",
                    basis: "source-extracted-unreviewed",
                },
            ],
            unknowns: [{ code: "reviewer_identity_unknown" }],
        }),
    };
    mockLoad.mockResolvedValue(state({ report: null, companyArchitecture: rich }));
    mockSource.mockResolvedValue(rich);
    render(<ContextDemoScreen />);
    fireEvent.click(await companyInspection());
    const dialog = await screen.findByRole("dialog", { name: "Company Architecture" });
    expect(await within(dialog).findByText("Responsibilities · Engineering")).toBeVisible();
    expect(within(dialog).getByText("Responsibilities · Operations")).toBeVisible();
    expect(within(dialog).getByText("Responsibilities · Privacy reviewer")).toBeVisible();
    expect(
        within(dialog).getByText("Supply deletion traces for the identified sample.")
    ).toBeVisible();
    expect(within(dialog).getByText("Reconcile QA and audit account identifiers.")).toBeVisible();
    expect(
        within(dialog).getByText("Assess the acceptance evidence; no approval is recorded here.")
    ).toBeVisible();
    expect(within(dialog).getAllByText("Source fact · unreviewed")).toHaveLength(2);
    expect(within(dialog).getByText("Human-entered fact · unreviewed")).toBeVisible();
    expect(within(dialog).getByText("reviewer identity unknown")).toBeVisible();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("does not infer a per-fact basis from the profile-level review state", async () => {
    const unclassified = {
        ...company,
        body: JSON.stringify({
            facts: [
                {
                    label: "Responsibilities",
                    subject: "Engineering",
                    value: "The source does not classify this fact's basis.",
                },
            ],
        }),
    };
    mockLoad.mockResolvedValue(state({ report: null, companyArchitecture: unclassified }));
    mockSource.mockResolvedValue(unclassified);
    render(<ContextDemoScreen />);
    fireEvent.click(await companyInspection());
    const dialog = await screen.findByRole("dialog", { name: "Company Architecture" });
    expect(await within(dialog).findByText("Responsibilities · Engineering")).toBeVisible();
    expect(within(dialog).getByText("unreviewed")).toBeVisible();
    expect(within(dialog).queryByText("Source fact · unreviewed")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Human-entered fact · unreviewed")).not.toBeInTheDocument();
});

it("names exact market, service and project paths without changing their captured labels or values", async () => {
    const facts = [
        {
            path: "markets.primary.0",
            label: "0",
            value: "Pilot operator teams",
            basis: "source-extracted-unreviewed",
        },
        {
            path: "services.0.name",
            label: "Name",
            value: "Pilot workspace lifecycle",
            basis: "source-extracted-unreviewed",
        },
        {
            path: "projects.0.name",
            label: "Name",
            subject: "Run-17",
            value: "Deletion evidence reconciliation",
            basis: "source-extracted-unreviewed",
        },
    ];
    const capturedBody = JSON.stringify({ facts });
    const rich = { ...company, body: capturedBody };
    mockLoad.mockResolvedValue(state({ report: null, companyArchitecture: rich }));
    mockSource.mockResolvedValue(rich);
    render(<ContextDemoScreen />);
    fireEvent.click(await companyInspection());
    const dialog = await screen.findByRole("dialog", { name: "Company Architecture" });
    expect(await within(dialog).findByText("Target customers")).toBeVisible();
    expect(within(dialog).getByText("Product or service")).toBeVisible();
    expect(within(dialog).getByText("Project · Run-17")).toBeVisible();
    for (const fact of facts) expect(within(dialog).getByText(fact.value)).toBeVisible();
    expect(within(dialog).queryByText("0", { selector: "dt" })).not.toBeInTheDocument();
    const original = within(dialog).getByText(/"path": "markets.primary.0"/);
    expect(original).toHaveTextContent('"label": "0"');
    expect(rich.body).toBe(capturedBody);
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("generates only after an explicit click and displays the returned saved report", async () => {
    const next = state();
    next.report!.summary = "Fresh contextual report returned after validated save.";
    mockGenerate.mockResolvedValue(next);
    render(<ContextDemoScreen />);
    await savedSummary(report().summary);
    await reportDetails();
    fireEvent.click(screen.getByRole("button", { name: "Prepare a new report" }));
    expect(await savedSummary(next.report!.summary)).toBeVisible();
    expect(mockGenerate).toHaveBeenCalledWith(
        "2026-10-12",
        expect.objectContaining({ aborted: false })
    );
    expect(mockToast).toHaveBeenCalledWith(
        "Report saved. Earlier reports, decisions and actions are preserved.",
        { duration: 2500 }
    );
    expect(mockReview).not.toHaveBeenCalled();
});

function recordedReplay(): DemoReport {
    const recorded = report();
    recorded.execution = {
        mode: "replay",
        modelId: "gpt-6-luna",
        promptVersion: "synthetic-context-test/v1",
        attempts: 0,
        durationMs: 0,
        fallbackReason: null,
        replay: {
            fixtureId: "synthetic-recorded-report/v1",
            recordedAt: "2026-10-26T19:12:55.000Z",
            originalModelId: "gpt-6-luna-2026-09-22",
        },
    };
    return recorded;
}

it("offers explicitly labeled offline replay before any contextual report exists", async () => {
    mockLoad.mockResolvedValue(state({ report: null, generationMode: "replay" }));
    const saved = state({ report: recordedReplay(), generationMode: "replay" });
    mockGenerate.mockResolvedValue(saved);
    render(<ContextDemoScreen />);
    await reportDetailsForEmptyReport();
    const buttons = await screen.findAllByRole("button", { name: "Replay sample report" });
    expect(buttons).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Prepare a new report" })).not.toBeInTheDocument();
    expect(
        screen.getByText("Sample report \u00b7 recorded replay \u00b7 no live AI call")
    ).toBeVisible();
    expect(screen.queryByText(/ready to call the configured model/)).not.toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
    fireEvent.click(buttons[0]!);
    expect(await savedSummary(saved.report!.summary)).toBeVisible();
    await reportDetails();
    expect(screen.getByText("Recorded replay · no model call")).toBeVisible();
    expect(mockGenerate).toHaveBeenCalledWith(
        "2026-10-12",
        expect.objectContaining({ aborted: false })
    );
    expect(mockReview).not.toHaveBeenCalled();
});

it("shows recorded model provenance without presenting replay timing as a fresh provider attempt", async () => {
    mockLoad.mockResolvedValue(state({ report: recordedReplay(), generationMode: "replay" }));
    render(<ContextDemoScreen />);
    await reportDetails();
    expect(screen.getByText("Recorded replay · no model call")).toBeVisible();
    expect(screen.getByText(/gpt-6-luna-2026-09-22/)).toHaveTextContent("2026-10-26T19:12:55.000Z");

    expect(screen.getByText("Recorded replay · no model call")).toBeVisible();
    expect(screen.queryByText(/AI · 0 attempts/)).not.toBeInTheDocument();
    expect(screen.queryByText("Context-aware · AI")).not.toBeInTheDocument();
    expect(await companyInspection()).toBeEnabled();
    fireEvent.click(
        within(screen.getByRole("dialog", { name: "My context" })).getByRole("button", {
            name: "Done",
        })
    );
    expect(screen.getByRole("region", { name: "Native pending queue" })).toBeVisible();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("keeps a saved actual AI report distinct from a currently selected replay generation mode", async () => {
    mockLoad.mockResolvedValue(state({ generationMode: "replay" }));
    render(<ContextDemoScreen />);
    expect(await savedSummary(report().summary)).toBeVisible();
    expect(screen.getByRole("button", { name: "Replay sample report" })).toBeEnabled();
    await reportDetails();
    expect(screen.getByText(/AI · 1 attempt/)).toBeVisible();
    expect(screen.queryByText("Recorded AI replay · no fresh model call")).not.toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("opens a fact's exact canonical version instead of manufacturing a native evidence ID", async () => {
    render(<ContextDemoScreen />);
    const topic = await openTopicEvidence();
    fireEvent.click(within(topic).getByRole("button", { name: /QA sample record/ }));
    const dialog = await screen.findByRole("dialog", { name: qa.title });
    expect(await within(dialog).findByText(qa.body)).toBeVisible();
    expect(within(dialog).getByText("doc:workspace-document/12@17")).toBeVisible();
    expect(mockSource.mock.calls[0]!.slice(0, 2)).toEqual(["native-report-12", qa.source]);
});

it.each(["kept", "dismissed"] as const)(
    "persists %s with the exact sidecar revision",
    async status => {
        const next = state();
        next.report!.version = 3;
        next.report!.topics[0]!.status = status;
        mockReview.mockResolvedValue(next);
        render(<ContextDemoScreen />);
        const detail = await openTopic();
        fireEvent.click(
            within(detail).getByRole("button", {
                name: status === "kept" ? "Keep for later" : "Dismiss topic",
            })
        );
        await waitFor(() =>
            expect(mockReview).toHaveBeenCalledWith({
                reportId: "native-report-12",
                topicId: "context-topic",
                expectedVersion: 2,
                status,
            })
        );
        expect(mockToast).toHaveBeenCalledWith("Review saved.", { duration: 2500 });
        const row = screen.getByRole("article", {
            name: "Compare the recorded sample",
            hidden: true,
        });
        expect(
            within(row).getByText(status === "kept" ? "Kept for review" : "Dismissed")
        ).toBeInTheDocument();
        expect(mockReview).toHaveBeenCalledTimes(1);
        expect(mockReview.mock.calls[0]![0]).not.toHaveProperty("decision");
        expect(mockGenerate).not.toHaveBeenCalled();
    }
);

it.each(["go", "no-go", "needs-more-evidence"] as const)(
    "records human %s without automatic commitments or historical-question closure",
    async value => {
        render(<ContextDemoScreen />);
        const detail = await openTopic();
        const labels = { go: "Go", "no-go": "No-go", "needs-more-evidence": "Needs more evidence" };
        fireEvent.click(within(detail).getByRole("button", { name: labels[value] }));
        const dialog = screen.getByRole("dialog", { name: "Record your decision" });
        expect(within(dialog).getByRole("radio", { name: labels[value] })).toBeChecked();
        expect(mockReview).not.toHaveBeenCalled();
        fireEvent.change(
            within(dialog).getByRole("textbox", { name: "Decision note (optional)" }),
            { target: { value: "Compare the full shared sample first." } }
        );
        expect(dialog).toHaveTextContent("does not create a commitment");
        expect(dialog).toHaveTextContent("or close a pending historical question");
        fireEvent.click(within(dialog).getByRole("button", { name: "Save decision" }));
        await waitFor(() =>
            expect(mockReview).toHaveBeenCalledWith({
                reportId: "native-report-12",
                topicId: "context-topic",
                expectedVersion: 2,
                decision: { value, text: "Compare the full shared sample first." },
            })
        );
        expect(mockGenerate).not.toHaveBeenCalled();
    }
);

it("withholds old sidecar text when reload cannot verify current evidence or access", async () => {
    mockLoad
        .mockResolvedValueOnce(state())
        .mockRejectedValueOnce(new DemoApiError("Unavailable", 503));
    render(<ContextDemoScreen />);
    await savedSummary(report().summary);
    fireEvent.click(screen.getByRole("button", { name: "Refresh saved weekly review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reload");
    expect(screen.queryByText(report().summary)).not.toBeInTheDocument();
    expect(screen.getByText("Saved content is withheld")).toBeVisible();
    expect(screen.queryByText(/has been loaded/)).not.toBeInTheDocument();
});

it("does not claim a successful reload after a version conflict and failed readback", async () => {
    mockReview.mockRejectedValue(new DemoApiError("Changed", 409));
    mockLoad.mockResolvedValueOnce(state()).mockRejectedValueOnce(new DemoApiError("Offline", 503));
    render(<ContextDemoScreen />);
    await openTopic();
    fireEvent.click(screen.getByRole("button", { name: "Keep for later" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reload");
    expect(screen.queryByText(report().summary)).not.toBeInTheDocument();
    expect(screen.queryByText(/has been loaded/)).not.toBeInTheDocument();
});

it("withholds a report when the source resolver reports changed authorization", async () => {
    mockSource.mockRejectedValue(new DemoApiError("Source was revoked", 403));
    render(<ContextDemoScreen />);
    const topic = await openTopicEvidence();
    fireEvent.click(within(topic).getByRole("button", { name: /QA sample record/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("source or its access changed");
    expect(screen.queryByText(report().summary)).not.toBeInTheDocument();
    expect(
        screen.queryByRole("dialog", { name: "Compare the recorded sample" })
    ).not.toBeInTheDocument();
});

it("direct native review resolves the configured synthetic week instead of the wall clock", async () => {
    render(<ContextNativeReview />);
    expect(await screen.findByTestId("native-week")).toHaveTextContent("2026-10-12");
    expect(screen.getByTestId("native-week")).not.toHaveTextContent("wall-clock");
});

it("week selection navigates to the explicitly chosen context week", async () => {
    mockLoad.mockResolvedValue(
        state({
            weeks: [
                { weekStart: "2026-10-05", label: "Backfilled synthetic week" },
                { weekStart: "2026-10-12", label: "Backfilled synthetic week" },
            ],
        })
    );
    render(<ContextDemoScreen />);
    await reportDetails();
    fireEvent.change(screen.getByRole("combobox", { name: "Reporting week" }), {
        target: { value: "2026-10-05" },
    });
    expect(mockNavigate).toHaveBeenCalledWith("/?week=2026-10-05");
    const options = screen.getAllByRole("option");
    expect(options[0]!.textContent).not.toBe(options[1]!.textContent);
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("shows captured retrieval, research and selection diagnostics without assuming complete status", async () => {
    const saved = state();
    saved.report!.diagnostics.context = {
        retrievalStatus: "partial",
        manifestStatus: "partial",
        researchMode: "STOP",
        researchStatus: "stopped",
        roleIds: ["founder", "engineering"],
        personalStarCount: 2,
        selectedCount: 2,
        missingCount: 1,
        omittedCount: 2,
        optionalUnavailableCount: 3,
        missingRefs: [{ kind: "doc", id: "workspace-document/20", version: "25" }],
        omittedRefs: [{ kind: "doc", id: "workspace-document/13", version: "18" }],
    };
    mockLoad.mockResolvedValue(saved);
    render(<ContextDemoScreen />);
    const details = await reportDetails();
    expect(within(details).getByText("Sophia retrieval")).toBeVisible();
    expect(within(details).getAllByText("partial")).toHaveLength(2);
    expect(within(details).getByText("STOP · stopped")).toBeVisible();
    expect(details).toHaveTextContent("founder, engineering · synthetic resolver");
    expect(details).toHaveTextContent("2 · synthetic resolver");
    expect(details).toHaveTextContent("2 selected · 1 missing refs · 2 omission events");
    expect(details).toHaveTextContent("3 records; unavailable identities are withheld");
    expect(within(details).getByText("doc:workspace-document/13@18")).toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("labels uncaptured old-report diagnostics instead of inventing retrieval success", async () => {
    render(<ContextDemoScreen />);
    await reportDetails();
    expect(
        screen.getByText("Context selection diagnostics were not captured for this saved report.")
    ).toBeVisible();
    expect(screen.queryByText("Sophia retrieval")).not.toBeInTheDocument();
});

function personalView(): DemoPersonalContextView {
    return {
        state: {
            version: "joseph-personal-context-v0",
            companyId: "42",
            principalRef: "synthetic-actor",
            module: "vantage",
            revision: 0,
            roles: null,
            stars: [],
        },
        roles: resolveRoleSelectionV0({
            principalRef: "synthetic-actor",
            values: ["founder", "engineering"],
            confirmed: false,
        }),
        documents: [
            {
                id: qa.source.id,
                title: qa.title,
                version: qa.source.version,
                sourceDate: qa.sourceDate!,
            },
        ],
        diagnostics: {
            coverage: {
                checked: [company.source],
                used: [],
                missing: [],
                revoked: [],
                omitted: [],
            },
            sources: [
                {
                    lane: "company",
                    companyId: "42",
                    principalRef: "synthetic-actor",
                    module: "vantage",
                    source: company.source,
                    status: "unavailable",
                    checkedAt: "2026-10-26T20:00:00.000Z",
                    reason: "Company Architecture is unreviewed; no approval has been inferred.",
                },
            ],
        },
        ready: false,
        blocker: "Company Architecture is unreviewed; no approval has been inferred.",
        persistence: "server-process-memory",
    };
}

it("keeps the saved contextual report and citations visible while Joseph required context blocks fresh generation", async () => {
    mockLoad.mockResolvedValue(state({ personalContextAvailable: true }));
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => personalView() });
    render(<ContextDemoScreen />);
    expect(await savedSummary(report().summary)).toBeVisible();
    await reportDetails();
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "Prepare a new report" })).toBeDisabled()
    );
    const details = await openPersonalContext();
    expect(await within(details).findByRole("heading", { name: "Your roles" })).toBeVisible();
    expect(await within(details).findByText("Some context needs attention.")).toBeVisible();
    expect(details).toHaveTextContent("saved reports keep their original context");
    expect(details).not.toHaveTextContent(/Joseph|process.memory|PostgreSQL/);
    expect(await savedSummary(report().summary)).toBeVisible();
    expect(await companyInspection()).toBeEnabled();
    const topic = await openTopicEvidence();
    expect(within(topic).getByRole("button", { name: /QA sample record/ })).toBeEnabled();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("uses Joseph multi-role, primary and star controls through the authenticated client with exact current versions", async () => {
    mockLoad.mockResolvedValue(state({ personalContextAvailable: true }));
    const remote = personalView();
    const fetch = jest.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === "PATCH") {
            if (typeof init.body !== "string") throw new Error("Expected synthetic JSON request.");
            const change = JSON.parse(init.body);
            remote.state.revision++;
            if (change.operation === "roles") {
                remote.roles = resolveRoleSelectionV0({
                    principalRef: "synthetic-actor",
                    values: change.roleIds,
                    primaryRoleId: change.primaryRoleId,
                    confirmed: true,
                });
                remote.state.roles = {
                    roleIds: change.roleIds,
                    primaryRoleId: change.primaryRoleId,
                    confirmedAt: "2026-10-26T20:00:00.000Z",
                };
            } else if (change.starred) {
                remote.state.stars = [
                    {
                        documentId: qa.source.id,
                        lastKnownRef: qa.source,
                        starredAt: "2026-10-26T20:00:00.000Z",
                        updatedAt: "2026-10-26T20:00:00.000Z",
                    },
                ];
                remote.documents[0]!.version = "18";
                remote.diagnostics.sources.push({
                    lane: "star",
                    companyId: "42",
                    principalRef: "synthetic-actor",
                    module: "vantage",
                    source: { ...qa.source, version: "18" },
                    status: "used",
                    checkedAt: "2026-10-26T20:00:00.000Z",
                });
            }
        }
        return { ok: true, json: async () => JSON.parse(JSON.stringify(remote)) } as Response;
    });
    globalThis.fetch = fetch;
    render(<ContextDemoScreen />);
    await savedSummary(report().summary);
    const details = await openPersonalContext();
    fireEvent.click(
        await within(details).findByRole("button", { name: /Make primary.*Engineering/ })
    );
    fireEvent.click(within(details).getByRole("button", { name: "Save roles" }));
    await within(details).findByRole("button", { name: /Primary perspective.*Engineering/ });
    await waitFor(() =>
        expect(within(details).getByRole("button", { name: "Save roles" })).toBeEnabled()
    );
    const roleWrite = fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    const roleBody = roleWrite[1]!.body;
    if (typeof roleBody !== "string") throw new Error("Expected synthetic JSON request.");
    expect(JSON.parse(roleBody)).toEqual({
        operation: "roles",
        roleIds: ["founder", "engineering"],
        primaryRoleId: "engineering",
        expectedRevision: 0,
    });
    fireEvent.click(within(details).getByRole("button", { name: "Star QA sample record" }));
    await within(details).findByRole("button", { name: "Unstar QA sample record" });
    expect(within(details).getByText("Version 18 · Updated 2026-10-16")).toBeVisible();
    fireEvent.click(within(details).getByText("Context details"));
    expect(within(details).getByText("Source workspace-document/12 · Version 18")).toBeVisible();
    fireEvent.click(within(details).getByRole("button", { name: "Done" }));
    await reportDetails();
    expect(screen.getByRole("button", { name: "Prepare a new report" })).toBeDisabled();
    expect(await savedSummary(report().summary)).toBeVisible();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("fails closed on personal-context access errors without hiding the independently authorized saved report", async () => {
    mockLoad.mockResolvedValue(state({ personalContextAvailable: true }));
    globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "PRIVATE_SOURCE_DETAIL" }),
    });
    render(<ContextDemoScreen />);
    await savedSummary(report().summary);
    await reportDetails();
    await waitFor(() =>
        expect(screen.getByRole("button", { name: "Prepare a new report" })).toBeDisabled()
    );
    const details = await openPersonalContext();
    expect(await within(details).findByRole("alert")).toHaveTextContent(
        "Context could not be loaded"
    );
    expect(screen.queryByText("PRIVATE_SOURCE_DETAIL")).not.toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: "Done" }));
    expect(await savedSummary(report().summary)).toBeVisible();
    expect(screen.getByRole("region", { name: "Native pending queue" })).toBeVisible();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("keeps the row compact and opens exact evidence in a keyboard-dismissable sheet", async () => {
    const saved = state();
    const before = JSON.stringify(saved);
    mockLoad.mockResolvedValue(saved);
    render(<ContextDemoScreen />);
    const row = await screen.findByRole("article", { name: "Compare the recorded sample" });
    expect(within(row).queryByText("AI suggested")).not.toBeInTheDocument();
    expect(within(row).getByText("1 source")).toBeVisible();
    expect(within(row).getByText("1 unknown")).toBeVisible();
    expect(within(row).queryByText("Reported differences")).not.toBeInTheDocument();
    expect(within(row).getByText(report().topics[0]!.decisionQuestion)).toBeVisible();
    expect(within(row).queryByRole("button", { name: "Keep for later" })).not.toBeInTheDocument();
    const trigger = within(row).getByRole("button");
    trigger.focus();
    fireEvent.click(trigger);
    const detail = screen.getByRole("dialog", { name: "Compare the recorded sample" });
    expect(within(row).queryByText(qa.body)).not.toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "The decision" })).toBeVisible();
    expect(within(detail).queryByText("Owner")).not.toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "Suggested next step" })).toBeVisible();
    expect(within(detail).getByText("Whether the samples overlap.")).toBeVisible();
    const evidence = within(detail).getByRole("region", { name: "Source evidence" });
    expect(within(evidence).getByRole("button", { name: /QA sample record/ })).toBeVisible();
    expect(within(evidence).getByText(qa.body)).toBeVisible();
    const reasoning = within(detail).getByText("Reasoning and original report").closest("details")!;
    expect(reasoning).not.toHaveAttribute("open");
    expect(within(reasoning).getByText(report().topics[0]!.rationale)).not.toBeVisible();
    fireEvent.click(reasoning.querySelector("summary")!);
    expect(within(reasoning).getByText(report().topics[0]!.proposedNextStep)).toBeVisible();
    expect(within(reasoning).getByText(report().topics[0]!.rationale)).toBeVisible();
    fireEvent.keyDown(document.activeElement ?? detail, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(JSON.stringify(saved)).toBe(before);
    expect(mockReview).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("keeps context settings and technical generation metadata secondary on initial load", async () => {
    render(<ContextDemoScreen />);
    expect(await screen.findByRole("button", { name: /^My context/ })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "My context" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "THIS WEEK'S BRIEF" })).toBeVisible();
    expect(
        screen.queryByRole("heading", { name: "Compare the recorded sample" })
    ).not.toBeInTheDocument();
    const fullBrief = screen.getByText(/^Read full brief/).closest("details")!;
    expect(fullBrief).not.toHaveAttribute("open");
    const metadata = screen.getByText("Sources & report details").closest("details")!;
    expect(metadata).not.toHaveAttribute("open");
    expect(within(metadata).getByText(report().execution.modelId)).not.toBeVisible();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("labels thirteen supplied profile facts without claiming extraction or profile approval", async () => {
    const thirteen = {
        ...company,
        body: JSON.stringify({
            facts: Array.from({ length: 13 }, (_, index) => ({
                label: `Supplied fact ${index + 1}`,
                value: `Synthetic supplied value ${index + 1}`,
            })),
            unknowns: [{ code: "hierarchy_unknown" }],
        }),
    };
    mockLoad.mockResolvedValue(
        state({ companyArchitecture: thirteen, personalContextAvailable: true })
    );
    mockSource.mockResolvedValue(thirteen);
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => personalView() });
    render(<ContextDemoScreen />);
    const context = await openPersonalContext();
    expect(within(context).getByText("Company profile isn't reviewed yet")).toBeVisible();
    expect(within(context).getByText("Supplied company facts: 13.")).toBeVisible();
    expect(context).not.toHaveTextContent(
        /AI.extracted|13 facts were extracted|won.t prepare a fresh report|Joseph|process.memory|fixture|ACL/
    );
    expect(
        within(context).queryByRole("button", { name: /Review profile|Approve profile|Save$/ })
    ).not.toBeInTheDocument();
    expect(mockSource).not.toHaveBeenCalled();
    expect(mockReview).not.toHaveBeenCalled();
    fireEvent.click(within(context).getByRole("button", { name: "Inspect profile" }));
    const source = await screen.findByRole("dialog", { name: company.title });
    expect(await within(source).findByText("hierarchy unknown")).toBeVisible();
    expect(within(source).getByText("unreviewed")).toBeVisible();
    expect(mockSource.mock.calls[0]!.slice(0, 2)).toEqual(["native-report-12", company.source]);
    expect(mockReview).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("reports source differences and unreviewed context only from matching report evidence", async () => {
    const saved = state();
    const topic = saved.report!.topics[0]!;
    topic.facts.push({
        text: "The supplied company profile is unreviewed.",
        refs: [company.source],
    });
    topic.conflicts.push({
        text: "The reports use different sample descriptions; the cause is unknown.",
        refs: [qa.source, company.source],
    });
    saved.report!.diagnostics.sources[0]!.reviewState = "unreviewed";
    mockLoad.mockResolvedValue(saved);
    render(<ContextDemoScreen />);
    const row = await screen.findByRole("article", { name: topic.title });
    expect(within(row).getByText("2 sources")).toBeVisible();
    expect(within(row).getByText("Results differ")).toBeVisible();
    expect(within(row).getByText("Unreviewed context")).toBeVisible();
    expect(row).not.toHaveTextContent(/definitive contradiction|AI suggested/);
    const detail = await openTopic();
    const comparison = within(detail).getByText("Comparison & limitations").closest("details")!;
    expect(comparison).not.toHaveAttribute("open");
    expect(within(comparison).getByText(topic.conflicts[0]!.text)).not.toBeVisible();
    fireEvent.click(comparison.querySelector("summary")!);
    expect(within(comparison).getByText(topic.conflicts[0]!.text)).toBeVisible();
    expect(mockReview).not.toHaveBeenCalled();
});

it("reloads saved reports while fresh preparation is blocked and uses a short-lived toast", async () => {
    const context = personalView();
    context.ready = false;
    mockLoad.mockResolvedValue(state({ personalContextAvailable: true }));
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => context });
    render(<ContextDemoScreen />);
    await screen.findByText(/Required context needs attention before a fresh report/);
    const refresh = screen.getByRole("button", { name: "Refresh saved weekly review" });
    expect(refresh).toBeEnabled();
    expect(
        screen.getByText(/Your saved report is still available; Refresh reloads it/)
    ).toBeVisible();
    fireEvent.click(refresh);
    await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith("Reloaded the current saved review.", {
            duration: 2500,
        })
    );
    expect(screen.queryByText("Reloaded the current saved review.")).not.toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
});

it("has no selected recommendation outcome before the reviewer explicitly chooses", async () => {
    render(<ContextDemoScreen />);
    const detail = await openTopic();
    for (const label of ["Go", "No-go", "Needs more evidence"]) {
        const button = within(detail).getByRole("button", { name: label });
        expect(button).not.toHaveAttribute("aria-pressed", "true");
        expect(button).not.toHaveAttribute("data-state", "checked");
    }
    expect(mockReview).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Record your decision" })).not.toBeInTheDocument();
});
