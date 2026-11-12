/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { FileEditor } from "../FileEditor";
import { hasUnsavedEdits } from "../unsavedEdits";

/**
 * The file editor: it loads what `/editable` hands it, saves HTML (or plain
 * text) with the base it was given, and uses the base each save returns for
 * the next one — so a save over a newer version is refused by the server,
 * and the editor says so instead of losing anyone's words.
 */

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toast } = require("sonner") as { toast: { success: jest.Mock; error: jest.Mock } };

const fetchMock = jest.fn();

function json(body: unknown, status = 200) {
    return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
    });
}

function editable(overrides: Record<string, unknown> = {}) {
    return {
        documentId: 7,
        title: "Plan",
        kind: "markdown",
        mode: "rich",
        html: "<h1>Plan</h1><p>First line</p>",
        text: "",
        base: "v:1",
        drive: null,
        notice: null,
        ...overrides,
    };
}

/** The bodies of every PUT, in order. */
function puts(): Array<Record<string, unknown>> {
    return fetchMock.mock.calls
        .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
        .map(
            ([, init]) =>
                JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
        );
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    // ProseMirror measures selections; jsdom has no layout.
    Range.prototype.getClientRects = () =>
        ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
    Range.prototype.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
    });
    document.elementFromPoint = () => null;
});

beforeEach(() => {
    fetchMock.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
});

async function loaded() {
    await waitFor(() => expect(screen.getByText("First line")).toBeInTheDocument());
}

/** Make an edit the way a person would reach for one: insert a table. */
async function edit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Insert table" }));
    await waitFor(() =>
        expect(screen.getByTestId("file-editor-status")).toHaveTextContent("Unsaved changes")
    );
}

describe("FileEditor", () => {
    it("opens the file's content and starts with nothing to save", async () => {
        fetchMock.mockImplementation(() => json(editable()));
        render(<FileEditor documentId={7} onExit={jest.fn()} />);

        await loaded();
        expect(fetchMock).toHaveBeenCalledWith("/api/documents/7/editable", expect.anything());
        expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
        expect(screen.getByTestId("file-editor-status")).toHaveTextContent("Saved");
        expect(screen.getByTestId("file-editor-save")).toBeDisabled();
    });

    it("saves the HTML with its base, then saves the next change on the base it got back", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
            if (init?.method !== "PUT") return json(editable());
            const n = puts().length;
            return json({
                success: true,
                versionId: 100 + n,
                versionNumber: 1 + n,
                base: `v:${1 + n}`,
            });
        });
        const onSaved = jest.fn();
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} onSaved={onSaved} />);
        await loaded();

        await edit(user);
        await user.click(screen.getByTestId("file-editor-save"));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

        const [first] = puts();
        expect(first!.base).toBe("v:1");
        expect(first!.html).toEqual(expect.stringContaining("First line"));
        expect(first!.html).toEqual(expect.stringContaining("<table"));
        expect(toast.success).toHaveBeenCalledWith("Saved as version 2");
        expect(screen.getByTestId("file-editor-status")).toHaveTextContent("Saved");

        await edit(user);
        await user.click(screen.getByTestId("file-editor-save"));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
        expect(puts()[1]!.base).toBe("v:2");
    });

    it("says the file changed since it was opened when the server refuses the save", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            init?.method === "PUT"
                ? json(
                      {
                          error: "changed_since_opened",
                          message: "Someone saved a newer version while you were editing.",
                      },
                      409
                  )
                : json(editable())
        );
        const onSaved = jest.fn();
        const onNewerVersion = jest.fn();
        const user = userEvent.setup();
        render(
            <FileEditor
                documentId={7}
                onExit={jest.fn()}
                onSaved={onSaved}
                onNewerVersion={onNewerVersion}
            />
        );
        await loaded();

        await edit(user);
        await user.click(screen.getByTestId("file-editor-save"));

        const alert = await screen.findByTestId("file-editor-conflict");
        // The rail re-reads its versions so it shows the newer one.
        expect(onNewerVersion).toHaveBeenCalled();
        expect(alert).toHaveTextContent("Changed since you opened it");
        expect(alert).toHaveTextContent("Someone saved a newer version while you were editing.");
        expect(screen.getByRole("button", { name: "Reload latest" })).toBeInTheDocument();
        // Nothing was saved, and the edit is still there to copy.
        expect(onSaved).not.toHaveBeenCalled();
        expect(screen.getByTestId("file-editor-status")).toHaveTextContent("Unsaved changes");
    });

    it("shows any other refusal as the server's sentence", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            init?.method === "PUT"
                ? json({ error: "too_large", message: "That file is too large to save." }, 413)
                : json(editable())
        );
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} />);
        await loaded();

        await edit(user);
        await user.click(screen.getByTestId("file-editor-save"));

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("That file is too large to save.")
        );
        expect(screen.queryByTestId("file-editor-conflict")).not.toBeInTheDocument();
    });

    it("edits a .txt as plain text and saves text, not HTML", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            init?.method === "PUT"
                ? json({ success: true, versionId: 9, versionNumber: 2, base: "v:2" })
                : json(editable({ kind: "text", mode: "plain", html: "", text: "line one" }))
        );
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} />);

        const area = await screen.findByTestId("file-editor-plain");
        expect(area).toHaveValue("line one");
        await user.type(area, "\nline two");
        await user.click(screen.getByTestId("file-editor-save"));

        await waitFor(() => expect(puts()).toHaveLength(1));
        expect(puts()[0]).toEqual({ base: "v:1", text: "line one\nline two" });
    });

    it("saves with ⌘S", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            init?.method === "PUT"
                ? json({ success: true, versionId: 9, versionNumber: 2, base: "v:2" })
                : json(editable({ kind: "text", mode: "plain", html: "", text: "a" }))
        );
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} />);

        const area = await screen.findByTestId("file-editor-plain");
        await user.type(area, "b");
        await user.keyboard("{Meta>}s{/Meta}");

        await waitFor(() => expect(puts()).toHaveLength(1));
    });

    it("does nothing on ⌘S when nothing changed — no empty version, no push into a Google Doc", async () => {
        fetchMock.mockImplementation(() =>
            json(
                editable({
                    kind: "docx",
                    drive: { url: "https://docs.google.com/d/1", native: true },
                })
            )
        );
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} />);
        await loaded();

        await user.click(screen.getByText("First line"));
        await user.keyboard("{Meta>}s{/Meta}");
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(puts()).toHaveLength(0);
    });

    it("tells the shell while it holds unsaved edits, and lets go once saved or closed", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            init?.method === "PUT"
                ? json({ success: true, versionId: 9, versionNumber: 2, base: "v:2" })
                : json(editable())
        );
        const user = userEvent.setup();
        const view = render(<FileEditor documentId={7} onExit={jest.fn()} />);
        await loaded();
        expect(hasUnsavedEdits(7)).toBe(false);

        await edit(user);
        expect(hasUnsavedEdits(7)).toBe(true);

        await user.click(screen.getByTestId("file-editor-save"));
        await waitFor(() => expect(hasUnsavedEdits(7)).toBe(false));

        await edit(user);
        expect(hasUnsavedEdits(7)).toBe(true);
        view.unmount();
        expect(hasUnsavedEdits(7)).toBe(false);
    });

    it("says a Drive save is waiting to come back, instead of naming an old version", async () => {
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            init?.method === "PUT"
                ? json({
                      success: true,
                      versionId: 9,
                      versionNumber: 4,
                      base: "drive:v13",
                      syncPending: true,
                  })
                : json(editable({ kind: "docx", drive: { url: null, native: true } }))
        );
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} />);
        await loaded();
        await edit(user);
        await user.click(screen.getByTestId("file-editor-save"));

        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith(
                "Saved to Google Docs. The copy here catches up in a few minutes."
            )
        );
    });

    it("offers row and column controls while the cursor is in a table", async () => {
        fetchMock.mockImplementation(() => json(editable()));
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={jest.fn()} />);
        await loaded();
        expect(screen.queryByRole("button", { name: "Add row below" })).not.toBeInTheDocument();

        await edit(user);
        for (const name of [
            "Add row below",
            "Add column to the right",
            "Delete row",
            "Delete column",
            "Delete table",
        ]) {
            expect(await screen.findByRole("button", { name })).toBeInTheDocument();
        }
        await user.click(screen.getByRole("button", { name: "Delete table" }));
        await waitFor(() =>
            expect(screen.queryByRole("button", { name: "Add row below" })).not.toBeInTheDocument()
        );
    });

    it("asks before Done throws away unsaved edits", async () => {
        fetchMock.mockImplementation(() =>
            json(editable({ kind: "text", mode: "plain", html: "", text: "a" }))
        );
        const onExit = jest.fn();
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={onExit} />);

        await user.type(await screen.findByTestId("file-editor-plain"), "b");
        await user.click(screen.getByTestId("file-editor-done"));

        expect(onExit).not.toHaveBeenCalled();
        expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Discard" }));
        expect(onExit).toHaveBeenCalled();
    });

    it("leaves straight away when nothing changed", async () => {
        fetchMock.mockImplementation(() => json(editable()));
        const onExit = jest.fn();
        const user = userEvent.setup();
        render(<FileEditor documentId={7} onExit={onExit} />);
        await loaded();

        await user.click(screen.getByTestId("file-editor-done"));
        expect(onExit).toHaveBeenCalled();
    });

    it("shows what a save keeps and drops, and links a Drive-linked Doc to Google Docs", async () => {
        fetchMock.mockImplementation(() =>
            json(
                editable({
                    kind: "docx",
                    drive: { url: "https://docs.google.com/document/d/abc/edit", native: true },
                    notice: "Saving replaces the Google Doc's text; its comments are not kept.",
                })
            )
        );
        render(<FileEditor documentId={7} onExit={jest.fn()} />);
        await loaded();

        expect(
            screen.getByText("Saving replaces the Google Doc's text; its comments are not kept.")
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Open in Google Docs/ })).toHaveAttribute(
            "href",
            "https://docs.google.com/document/d/abc/edit"
        );
    });

    it("says why when the file cannot be opened for editing", async () => {
        fetchMock.mockImplementation(() =>
            json({ error: "not_editable", message: "PDFs can't be edited here." }, 415)
        );
        render(<FileEditor documentId={7} onExit={jest.fn()} />);

        expect(await screen.findByText("PDFs can't be edited here.")).toBeInTheDocument();
        expect(screen.getByText("Couldn't open this file for editing")).toBeInTheDocument();
    });
});
