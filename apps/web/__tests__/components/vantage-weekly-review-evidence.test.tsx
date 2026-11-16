/** @jest-environment jsdom */
import React from "react";
import { createHash, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { WeeklyReviewEntry } from "~/app/employer/tools/vantage/_screens/WeeklyReviewEntry";
import {
    buildSourceScope,
    EvidenceInspector,
    SourceScopeEditor,
    type SourceChoice,
    type SourceInspection,
} from "~/app/employer/tools/vantage/_screens/WeeklyReviewEvidence";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const text = "alpha beta😀 gamma";
const preview = {
    version: "22",
    parentHash: hash(text),
    text,
    chunks: [{ id: "1", ordinal: 0, start: 0, end: text.length }],
    offsetEncoding: "utf16_half_open" as const,
};
const scope = {
    version: "11",
    expectedParentHash: "a".repeat(64),
    qualification: "Old approval",
    requiredUnits: [{ id: "pricing", start: 0, end: 5, excerptHash: hash("alpha") }],
};
const source: SourceChoice = {
    id: "101",
    title: "Architecture",
    purpose: "company-architecture",
    configurationVersion: 3,
};
function inspection(changes: Partial<SourceInspection> = {}): SourceInspection {
    return {
        document: { id: "101", title: "Architecture" },
        purpose: "company-architecture",
        configurationVersion: 3,
        pin: { status: "missing_version", scope },
        versions: [{ version: "22", createdAt: "2026-11-01T00:00:00Z" }],
        preview: null,
        ...changes,
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
const read = jest.fn();
const save = jest.fn();
function renderEditor(sources = [source], scopedEnabled = true) {
    return renderWithLocale(
        <SourceScopeEditor
            sources={sources}
            read={read}
            disabled={false}
            scopedEnabled={scopedEnabled}
            onSave={save}
        />,
        "en"
    );
}
function chooseSource(value = "company-architecture:101") {
    fireEvent.change(screen.getByLabelText("Source to inspect"), { target: { value } });
}
function fillScope() {
    fireEvent.change(screen.getByLabelText("Scope qualification"), {
        target: { value: "Pricing spans reviewed" },
    });
    fireEvent.change(screen.getByLabelText("Unit ID 1"), { target: { value: "pricing" } });
    fireEvent.change(screen.getByLabelText("Start offset 1"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("End offset 1"), { target: { value: "5" } });
}
beforeAll(() => {
    Object.defineProperty(globalThis.crypto, "subtle", {
        configurable: true,
        value: webcrypto.subtle,
    });
    Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
});
beforeEach(() => {
    read.mockReset();
    save.mockReset().mockResolvedValue(undefined);
});

it("requests exact frozen evidence and displays its text, identities and unknown completeness", async () => {
    read.mockResolvedValue({
        ref: "unit:one",
        title: "Frozen source",
        text: "frozen excerpt",
        version: "11",
        hash: "frozen-hash",
        purpose: "workspace-required",
        scope: {
            start: 2,
            end: 16,
            parentHash: "parent-hash",
            scopeHash: "scope-hash",
            anchors: [{ chunkId: "9" }],
            coverage: { qualification: "Approved finite evidence" },
            offsetEncoding: "utf16_half_open",
        },
    });
    renderWithLocale(
        <EvidenceInspector
            reportId="report-A"
            reference="unit:one"
            read={read}
            onClose={jest.fn()}
        />,
        "en"
    );
    expect(await screen.findByText("frozen excerpt")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith("/report-A/evidence?ref=unit%3Aone");
    expect(screen.getByText("Version 11")).toBeInTheDocument();
    expect(screen.getByText("Evidence SHA-256 frozen-hash")).toBeInTheDocument();
    expect(screen.getByText("UTF-16 range [2, 16)")).toBeInTheDocument();
    expect(
        screen.getByText("Completeness of the original PDF or OCR extraction is unknown.")
    ).toBeInTheDocument();
});

it("shows an actionable denied exact-evidence state", async () => {
    read.mockRejectedValue(Error("source_access_denied"));
    renderWithLocale(
        <EvidenceInspector
            reportId="report-A"
            reference="unit:one"
            read={read}
            onClose={jest.fn()}
        />,
        "en"
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("current access was denied");
    expect(read).toHaveBeenCalledTimes(1);
});

it("ignores an older citation response after the reference changes", async () => {
    const older = deferred<unknown>();
    read.mockImplementation((path: string) =>
        path.includes("old")
            ? older.promise
            : Promise.resolve({
                  ref: "new",
                  title: "New evidence",
                  text: "new exact text",
                  version: "22",
                  hash: "hash",
                  purpose: "retrieved",
                  scope: null,
              })
    );
    const rendered = renderWithLocale(
        <EvidenceInspector reportId="report-A" reference="old" read={read} onClose={jest.fn()} />,
        "en"
    );
    rendered.rerender(
        <EvidenceInspector reportId="report-A" reference="new" read={read} onClose={jest.fn()} />
    );
    await screen.findByText("new exact text");
    await act(async () => {
        older.resolve({ text: "old exact text" });
    });
    expect(screen.queryByText("old exact text")).not.toBeInTheDocument();
});

it("shows a missing pin without selecting a newer version, and can clear it", async () => {
    read.mockResolvedValue(inspection());
    renderEditor();
    chooseSource();
    expect(await screen.findByText(/Pinned version is missing/)).toBeInTheDocument();
    expect(screen.getByLabelText("Source version")).toHaveValue("");
    expect(screen.queryByLabelText("Canonical indexed text")).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(
        "/context/source?documentId=101&purpose=company-architecture"
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear pinned scope" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(source, null, 3));
});

it("previews an explicitly chosen version and approves exact range and parent hashes", async () => {
    read.mockImplementation((path: string) =>
        Promise.resolve(inspection(path.includes("version=22") ? { preview } : {}))
    );
    renderEditor();
    chooseSource();
    await screen.findByLabelText("Source version");
    fireEvent.change(screen.getByLabelText("Source version"), { target: { value: "22" } });
    expect(await screen.findByLabelText("Canonical indexed text")).toHaveValue(text);
    fillScope();
    fireEvent.click(screen.getByRole("button", { name: "Approve finite scope" }));
    await waitFor(() =>
        expect(save).toHaveBeenCalledWith(
            source,
            {
                version: "22",
                expectedParentHash: hash(text),
                qualification: "Pricing spans reviewed",
                requiredUnits: [{ id: "pricing", start: 0, end: 5, excerptHash: hash("alpha") }],
            },
            3
        )
    );
});

it("rejects invalid numeric boundaries before sending an approval", async () => {
    read.mockResolvedValue(inspection({ preview }));
    renderEditor();
    chooseSource();
    await screen.findByLabelText("Scope qualification");
    fillScope();
    fireEvent.change(screen.getByLabelText("End offset 1"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve finite scope" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
        "valid, non-overlapping integer ranges"
    );
    expect(save).not.toHaveBeenCalled();
});

it.each([
    { id: "one", start: "-1", end: "2" },
    { id: "one", start: "0", end: "99" },
    { id: "one", start: "2", end: "2" },
    { id: "one", start: "0", end: "1.5" },
    { id: "one", start: "11", end: "12" },
    { id: "one", start: "0", end: "11" },
])("rejects unsafe range $start to $end", async unit => {
    await expect(buildSourceScope(preview, "Qualification", [unit])).rejects.toThrow(
        "invalidScope"
    );
});

it("rejects overlapping ranges, duplicate IDs, blank qualification and oversized units", async () => {
    const units = [
        { id: "one", start: "0", end: "5" },
        { id: "two", start: "4", end: "8" },
    ];
    await expect(buildSourceScope(preview, "Qualification", units)).rejects.toThrow("invalidScope");
    await expect(
        buildSourceScope(preview, "Qualification", [
            { ...units[0]! },
            { id: "one", start: "6", end: "8" },
        ])
    ).rejects.toThrow("invalidScope");
    await expect(buildSourceScope(preview, " ", [units[0]!])).rejects.toThrow("invalidScope");
    await expect(
        buildSourceScope({ ...preview, text: "a".repeat(6001) }, "Qualification", [
            { id: "one", start: "0", end: "6001" },
        ])
    ).rejects.toThrow("invalidScope");
});

it("ignores a preview response from a previously selected source", async () => {
    const older = deferred<SourceInspection>();
    read.mockImplementation((path: string) =>
        path.includes("documentId=101")
            ? older.promise
            : Promise.resolve(
                  inspection({
                      document: { id: "202", title: "Other source" },
                      preview: { ...preview, text: "Current source" },
                  })
              )
    );
    renderEditor([source, { ...source, id: "202", title: "Other source" }]);
    chooseSource();
    chooseSource("company-architecture:202");
    expect(await screen.findByLabelText("Canonical indexed text")).toHaveValue("Current source");
    await act(async () => {
        older.resolve(inspection({ preview }));
    });
    expect(screen.getByLabelText("Canonical indexed text")).toHaveValue("Current source");
});

it.each([
    {
        source: { ...source, hasHiddenSources: true },
        value: inspection({ preview }),
        message: "Some configured sources are currently inaccessible",
    },
    {
        source,
        value: inspection({ configurationVersion: 4, preview }),
        message: "Source configuration changed",
    },
])("blocks clear and approve for unsafe configuration snapshots", async item => {
    read.mockResolvedValue(item.value);
    renderEditor([item.source]);
    chooseSource();
    expect(await screen.findByRole("alert")).toHaveTextContent(item.message);
    expect(screen.getByRole("button", { name: "Clear pinned scope" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve finite scope" })).toBeDisabled();
});

it("keeps finite approval disabled while still permitting exact preview with the flag off", async () => {
    read.mockResolvedValue(inspection({ preview }));
    renderEditor([source], false);
    chooseSource();
    expect(await screen.findByLabelText("Canonical indexed text")).toHaveValue(text);
    expect(screen.getByRole("button", { name: "Approve finite scope" })).toBeDisabled();
});

it("allows retry after an unavailable explicit version without choosing a latest version", async () => {
    read.mockRejectedValueOnce(Error("source_access_denied")).mockResolvedValue(inspection());
    renderEditor();
    chooseSource();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Inspect source again" }));
    await screen.findByLabelText("Source version");
    expect(screen.getByLabelText("Source version")).toHaveValue("");
    expect(read.mock.calls.every(([path]) => !path.includes("version="))).toBe(true);
});

// The screen tests exercise the ordinary POST/PATCH entry points with complete scope maps.
jest.mock("~/app/employer/tools/vantage/_screens/AgendaScreen", () => ({
    AgendaScreen: () => <p>Legacy agenda</p>,
}));
const mockFetch = jest.fn();
const context = {
    canConfigure: true,
    scopedEvidenceEnabled: true,
    documents: [
        { id: "101", title: "Architecture" },
        { id: "202", title: "Required context" },
        { id: "303", title: "Personal source" },
        { id: "404", title: "Other star" },
    ],
    policy: {
        version: 3,
        architecture_document_id: "101",
        required_document_ids: ["202"],
        required_source_scopes: {
            "101": scope,
            "202": { ...scope, qualification: "Other required scope" },
        },
        hasHiddenSources: false,
    },
    preferences: {
        version: 4,
        star_document_ids: ["303", "404"],
        star_source_scopes: {
            "303": scope,
            "404": { ...scope, qualification: "Other personal scope" },
        },
        hasHiddenSources: false,
    },
};
const savedReport = {
    id: "A",
    version: 1,
    decisions: [],
    evidence: {},
    report: {
        headline: "Accepted report",
        brief: "Brief",
        summary: "Summary",
        keyFigures: [
            {
                label: "Revenue",
                value: "1",
                refs: ["figure:one"],
                derivation: { op: "sum", inputs: [{ value: 1, ref: "figure:one" }] },
            },
        ],
        topics: [
            {
                id: "topic-0",
                title: "Pricing",
                facts: [{ text: "Fact", refs: ["fact:one"] }],
                conflicts: [{ text: "Conflict", refs: ["conflict:one"] }],
                whyItMatters: "Why",
                whyNow: "Now",
                decisionQuestion: "Question",
                rationale: "Rationale",
                proposedNextStep: "Next",
                unknowns: [],
                recommendation: {
                    call: "Proceed",
                    confidence: "low",
                    because: "Because",
                    wouldChangeIf: "Signal",
                    refs: ["recommendation:one"],
                },
            },
        ],
    },
};
function configureScreen(changes: Partial<typeof context> = {}, failSave = false) {
    global.fetch = mockFetch;
    mockFetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
        let value: unknown;
        if (url.includes("?weekStart="))
            value = {
                enabled: true,
                activeId: "A",
                runs: [
                    {
                        id: "A",
                        status: "accepted",
                        week_start: "2026-11-09",
                        created_at: "2026-11-09",
                    },
                ],
            };
        else if (url.includes("/context/source?")) {
            const query = new URLSearchParams(url.split("?")[1]);
            const personal = query.get("purpose") === "personal-star";
            value = inspection({
                purpose: personal ? "personal-star" : "company-architecture",
                configurationVersion: personal ? 4 : 3,
                preview: query.has("version") ? preview : null,
                document: { id: query.get("documentId")!, title: "Selected source" },
            });
        } else if (url.endsWith("/context")) {
            if (options?.method === "POST" || options?.method === "PATCH")
                return {
                    ok: !failSave,
                    json: async () =>
                        failSave ? { error: "source_context_unavailable" } : { version: 5 },
                };
            value = { ...context, ...changes };
        } else if (url.includes("/evidence?"))
            value = {
                ref: "fact:one",
                title: "Frozen fact source",
                text: "Exact frozen fact",
                version: "11",
                hash: "frozen-hash",
                purpose: "workspace-required",
                scope: null,
            };
        else value = savedReport;
        return { ok: true, json: async () => value };
    });
}

it("makes figure, derivation, fact, conflict and recommendation citations inspectable in the screen", async () => {
    configureScreen();
    renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
    await screen.findByText("Accepted report");
    expect(screen.getAllByRole("button", { name: "Inspect citation figure:one" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Inspect citation conflict:one" })).toBeEnabled();
    expect(
        screen.getByRole("button", { name: "Inspect citation recommendation:one" })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Inspect citation fact:one" }));
    expect(await screen.findByText("Exact frozen fact")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
        "/api/vantage/reviews/A/evidence?ref=fact%3Aone",
        expect.anything()
    );
});

it("clears one company pin through the normal POST while preserving other scopes and all IDs", async () => {
    configureScreen();
    renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
    await screen.findByLabelText("Source to inspect");
    chooseSource();
    await screen.findByRole("button", { name: "Clear pinned scope" });
    fireEvent.click(screen.getByRole("button", { name: "Clear pinned scope" }));
    await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
            "/api/vantage/reviews/context",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    expectedVersion: 3,
                    architectureDocumentId: "101",
                    requiredDocumentIds: ["202"],
                    requiredSourceScopes: { "202": context.policy.required_source_scopes["202"] },
                }),
            })
        )
    );
});

it("reapproves one personal pin through normal PATCH and preserves other stars and scope entries", async () => {
    configureScreen();
    renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
    await screen.findByLabelText("Source to inspect");
    chooseSource("personal-star:303");
    await screen.findByLabelText("Source version");
    fireEvent.change(screen.getByLabelText("Source version"), { target: { value: "22" } });
    await screen.findByLabelText("Canonical indexed text");
    fillScope();
    fireEvent.click(screen.getByRole("button", { name: "Approve finite scope" }));
    const approved = {
        version: "22",
        expectedParentHash: hash(text),
        qualification: "Pricing spans reviewed",
        requiredUnits: [{ id: "pricing", start: 0, end: 5, excerptHash: hash("alpha") }],
    };
    await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
            "/api/vantage/reviews/context",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedVersion: 4,
                    starDocumentIds: ["303", "404"],
                    starSourceScopes: {
                        "303": approved,
                        "404": context.preferences.star_source_scopes["404"],
                    },
                }),
            })
        )
    );
});

it("disables both full-configuration saves when their source sets are partially visible", async () => {
    configureScreen({
        policy: { ...context.policy, hasHiddenSources: true },
        preferences: { ...context.preferences, hasHiddenSources: true },
    });
    renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
    await screen.findByLabelText("Source to inspect");
    expect(screen.getByText("Save required context")).toBeDisabled();
    expect(screen.getByText("Save personal stars")).toBeDisabled();
    chooseSource("personal-star:303");
    await screen.findByRole("button", { name: "Clear pinned scope" });
    expect(screen.getByRole("button", { name: "Clear pinned scope" })).toBeDisabled();
});

it("keeps a failed clear actionable when whole-document context cannot be admitted", async () => {
    configureScreen({}, true);
    renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
    await screen.findByLabelText("Source to inspect");
    chooseSource();
    await screen.findByRole("button", { name: "Clear pinned scope" });
    fireEvent.click(screen.getByRole("button", { name: "Clear pinned scope" }));
    await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Choose an explicit available version and approve a bounded scope"
        )
    );
    expect(screen.getByRole("button", { name: "Clear pinned scope" })).toBeEnabled();
});
