/** @jest-environment jsdom */
import type React from "react";
import * as mockReact from "react";
import { createHash, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import {
    buildSourceScope,
    SourceScopeEditor,
    type SourceChoice,
    type SourceInspection,
} from "~/app/employer/tools/vantage/_components/SourceScopeEditor";

jest.mock("~/components/ui/select", () => {
    const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => (
        <option value={value}>{children}</option>
    );
    return {
        Select: ({
            children,
            value,
            onValueChange,
            disabled,
        }: {
            children: React.ReactNode;
            value?: string;
            onValueChange: (value: string) => void;
            disabled?: boolean;
        }) => {
            const elements = mockReact.Children.toArray(children) as React.ReactElement<{
                id?: string;
                children?: React.ReactNode;
            }>[];
            return (
                <select
                    id={elements[0]?.props.id}
                    value={value ?? ""}
                    disabled={disabled}
                    onChange={event => onValueChange(event.target.value)}
                >
                    <option value="" />
                    {elements[1]?.props.children}
                </select>
            );
        },
        SelectTrigger: () => null,
        SelectValue: () => null,
        SelectContent: () => null,
        SelectItem,
    };
});

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const text = "alpha beta😀 gamma";
const preview = {
    version: "22",
    parentHash: hash(text),
    text,
    chunks: [{ id: "1", ordinal: 0, start: 0, end: text.length }],
    originalCompleteness: "unknown" as const,
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
    const advanced = screen.getByRole("button", { name: /Advanced:/ });
    if (advanced.getAttribute("aria-expanded") !== "true") fireEvent.click(advanced);
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

it("keeps advanced scope inspection closed until requested", () => {
    renderEditor();
    expect(screen.queryByLabelText("Source to inspect")).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
});

it("does not approve an unchanged persisted scope", async () => {
    read.mockResolvedValue(
        inspection({
            preview,
            pin: { status: "valid", scope: { ...scope, version: "22", qualification: "Reviewed" } },
        })
    );
    renderEditor();
    chooseSource();
    await screen.findByLabelText("Scope qualification");
    expect(screen.getByRole("button", { name: "Approve finite scope" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Scope qualification"), {
        target: { value: "New review" },
    });
    expect(screen.getByRole("button", { name: "Approve finite scope" })).toBeEnabled();
});
