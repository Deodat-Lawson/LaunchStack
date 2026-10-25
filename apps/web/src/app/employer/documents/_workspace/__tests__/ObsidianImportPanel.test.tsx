/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { ObsidianImportPanel } from "../ObsidianImportPanel";

/**
 * The Obsidian tab reads a vault in the browser: notes only (Obsidian's own
 * folders and attachments stay behind), posted in batches, then one call
 * naming every note the vault still has so deleted notes are flagged.
 */

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const fetchMock = jest.fn();
const posted: { url: string; body: unknown }[] = [];

function respond(body: unknown, code = 200) {
    return Promise.resolve({
        ok: code < 400,
        status: code,
        json: () => Promise.resolve(body),
    });
}

function vaultFile(relativePath: string, text: string): File {
    const file = new File([text], relativePath.split("/").pop()!, { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    // jsdom's File has no text(); the browser's does.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    return file;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    posted.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") {
            return respond({
                data: { vaults: [{ vaultName: "Work", notes: 4, lastImportedAt: null }] },
            });
        }
        posted.push({ url, body: JSON.parse(init.body as string) });
        if (url.endsWith("/finish")) return respond({ data: { missing: 1 } });
        return respond({
            data: { folder: "Obsidian/Work", stored: 2, unchanged: 0, skipped: [], failed: [] },
        });
    });
});

function pickFolder(container: HTMLElement, files: File[]) {
    const input = container.querySelector('input[type="file"][multiple]')!;
    fireEvent.change(input, { target: { files } });
}

describe("ObsidianImportPanel", () => {
    it("lists vaults imported before", async () => {
        render(<ObsidianImportPanel onImported={jest.fn()} />);
        expect(await screen.findByText("Work")).toBeInTheDocument();
        expect(screen.getByText(/keep the same vault name/i)).toBeInTheDocument();
    });

    it("imports the vault's notes and leaves Obsidian's own files out", async () => {
        const onImported = jest.fn();
        const { container } = render(<ObsidianImportPanel onImported={onImported} />);

        pickFolder(container, [
            vaultFile("Work/Inbox.md", "First thought"),
            vaultFile("Work/Projects/Plan.md", "Do it"),
            vaultFile("Work/.obsidian/workspace.md", "settings"),
            vaultFile("Work/Attachments/diagram.png", "png"),
        ]);

        expect(await screen.findByText("2 notes found")).toBeInTheDocument();
        expect(screen.getByText(/Obsidian vault · 2 other files left out/)).toBeInTheDocument();
        expect(screen.getByLabelText(/vault name/i)).toHaveValue("Work");

        await userEvent.click(screen.getByRole("button", { name: /import notes/i }));

        await waitFor(() => expect(onImported).toHaveBeenCalled());
        const [batch, finish] = posted;
        expect(batch).toEqual({
            url: "/api/connectors/obsidian/import",
            body: {
                vault: "Work",
                notes: [
                    expect.objectContaining({ path: "Inbox.md", text: "First thought" }),
                    expect.objectContaining({ path: "Projects/Plan.md", text: "Do it" }),
                ],
            },
        });
        expect(finish).toEqual({
            url: "/api/connectors/obsidian/import/finish",
            body: { vault: "Work", paths: ["Inbox.md", "Projects/Plan.md"] },
        });
        expect(
            await screen.findByText(
                /2 imported · 0 unchanged · 1 no longer in the vault — in Obsidian\/Work/
            )
        ).toBeInTheDocument();
    });

    it("says so when the pick has no notes", async () => {
        const { container } = render(<ObsidianImportPanel onImported={jest.fn()} />);

        pickFolder(container, [vaultFile("Pics/photo.jpg", "jpg")]);

        expect(await screen.findByText(/no markdown notes found/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /import notes/i })).toBeDisabled();
    });

    it("does not claim success when checking for deleted notes fails", async () => {
        const { toast } = jest.requireMock<{ toast: { success: jest.Mock } }>("sonner");
        toast.success.mockClear();
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            if (!init?.method || init.method === "GET") return respond({ data: { vaults: [] } });
            if (url.endsWith("/finish")) return respond({ message: "Too many requests" }, 429);
            return respond({
                data: { folder: "Obsidian/Work", stored: 1, unchanged: 0, skipped: [], failed: [] },
            });
        });
        const onImported = jest.fn();
        const { container } = render(<ObsidianImportPanel onImported={onImported} />);

        pickFolder(container, [vaultFile("Work/Inbox.md", "First thought")]);
        await userEvent.click(await screen.findByRole("button", { name: /import notes/i }));

        expect(await screen.findByText("Too many requests")).toBeInTheDocument();
        expect(screen.getByText(/1 imported/)).toBeInTheDocument();
        expect(toast.success).not.toHaveBeenCalled();
        expect(onImported).not.toHaveBeenCalled();
    });

    it("shows the server's reason when a batch is refused", async () => {
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            if (!init?.method || init.method === "GET") return respond({ data: { vaults: [] } });
            return respond({ message: "Importing notes needs permission to add documents." }, 403);
        });
        const { container } = render(<ObsidianImportPanel onImported={jest.fn()} />);

        pickFolder(container, [vaultFile("Work/Inbox.md", "First thought")]);
        await userEvent.click(await screen.findByRole("button", { name: /import notes/i }));

        expect(await screen.findByText(/needs permission to add documents/i)).toBeInTheDocument();
    });
});
