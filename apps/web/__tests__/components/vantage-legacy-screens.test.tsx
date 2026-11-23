/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type * as VantageApi from "~/app/employer/tools/vantage/api";

const mockApi = {
    addEvidence: jest.fn(),
    commitments: jest.fn(),
    evidence: jest.fn(),
    overview: jest.fn(),
};
jest.mock("~/app/employer/tools/vantage/api", () => ({
    ...jest.requireActual<typeof VantageApi>("~/app/employer/tools/vantage/api"),
    vantageApi: new Proxy(
        {},
        { get: (_target, name: string) => mockApi[name as keyof typeof mockApi] }
    ),
}));
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({ can: (permission: string) => permission === "documents.edit" }),
}));

import { EvidenceDialog } from "~/app/employer/tools/vantage/_components/EvidenceDialog";
import { CommitmentsScreen } from "~/app/employer/tools/vantage/_screens/CommitmentsScreen";
import { EvidenceScreen } from "~/app/employer/tools/vantage/_screens/EvidenceScreen";
import { agenda, commitment, overview, topic } from "../vantage/factories";

beforeEach(() => {
    jest.clearAllMocks();
    mockApi.overview.mockResolvedValue(overview());
});

beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined;
});

it("shows shared evidence but only renders mutation actions for its creator", async () => {
    const base = {
        kind: "note",
        body: "Evidence text",
        observedAt: "2026-11-20",
        createdAt: "2026-11-20T12:00:00.000Z",
        visibility: "shared",
    };
    mockApi.evidence.mockResolvedValue({
        evidence: [
            { ...base, id: "shared", title: "Shared team note", canEdit: false },
            { ...base, id: "owned", title: "My note", canEdit: true },
        ],
    });
    render(<EvidenceScreen />);
    expect(await screen.findByRole("button", { name: /Shared team note/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Shared team note" })).toBeNull();
    expect(screen.getByRole("button", { name: "Actions for My note" })).toBeInTheDocument();
});

it("keeps text-file attachment as manual note capture and omits document kind", async () => {
    mockApi.addEvidence.mockResolvedValue({ evidence: { id: "saved" } });
    render(<EvidenceDialog open onOpenChange={jest.fn()} onSaved={jest.fn()} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Kind" }), { key: "ArrowDown" });
    expect(await screen.findByRole("option", { name: "Note" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Document" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    const file = new File(["Draft"], "customer-notes.md", { type: "text/markdown" });
    Object.defineProperty(file, "text", { value: async () => "Notes from the call" });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() =>
        expect(within(dialog).getByLabelText("What happened")).toHaveValue("Notes from the call")
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add evidence" }));
    await waitFor(() =>
        expect(mockApi.addEvidence).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "note",
                title: "customer-notes",
                body: "Notes from the call",
            })
        )
    );
});

it("keeps a manual shared commitment readable without offering retired or noncreator writes", async () => {
    mockApi.overview.mockResolvedValue(
        overview({
            previousAgenda: agenda({
                status: "held",
                topics: [
                    topic({
                        status: "kept",
                        proposedNextStep: "Legacy meeting decision",
                        proposedOwner: "Founder",
                        origin: "ai",
                    }),
                ],
            }),
        })
    );
    mockApi.commitments.mockResolvedValue({
        commitments: [
            commitment({ title: "Shared action", shared: true, canEdit: false }),
            commitment({ id: "owned", title: "My action", canEdit: true }),
        ],
    });
    render(<CommitmentsScreen />);
    expect(await screen.findByText("Shared action")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Check in" })).toHaveLength(1);
    expect(screen.queryByText("Legacy meeting decision")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Commit/ })).toBeNull();
});
