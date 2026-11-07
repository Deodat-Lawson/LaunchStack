/** @jest-environment jsdom */
/**
 * A sent message's sources in the transcript: a source the words mention is
 * its chip in the words, the rest of the scope sits under them, a source the
 * reader cannot open is an unavailable chip, and "asking over N sources"
 * opens the composer's picker (docs/design/inline-source-context.md §3.5).
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { AskPanel, type AskPanelProps } from "../AskPanel";
import type { ThreadMessage, WorkspaceSource } from "../types";

global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;
jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({ name: "Acme" }),
}));
jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({ routes: [], loading: false }),
}));
jest.mock("../AskStarters", () => ({ AskStarters: () => null }));

const source = (id: string, title: string): WorkspaceSource => ({
    id,
    documentId: Number(id.slice(1)),
    title,
    type: "doc",
    size: "1 KB",
    added: "Today",
    folder: "General",
    tags: [],
    domain: "General",
});
const SOURCES = [source("d1", "Retrieval Plan"), source("d2", "Handbook")];
/** As the server hands a reader the turn: the source they cannot open has lost its title. */
const THREAD: ThreadMessage[] = [
    {
        id: "q1",
        role: "user",
        text: "Compare [Source: Retrieval Plan](#launchstack-source-d1) with the handbook, not [Source: unavailable](#launchstack-source-d9)",
        refs: ["d1", "d2", "d9"],
        createdAt: "2026-10-04T12:00:00Z",
    },
    {
        id: "a1",
        role: "assistant",
        text: "They differ.",
        createdAt: "2026-10-04T12:00:01Z",
        status: "complete",
    },
];

beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
    })) as unknown as typeof fetch;
});

function mount(overrides: Partial<AskPanelProps> = {}) {
    const onOpenSource = jest.fn();
    const props: AskPanelProps = {
        sources: SOURCES,
        selected: [],
        setSelected: jest.fn(),
        composerEditor: "plain",
        thread: THREAD,
        sendMessage: jest.fn(),
        isSending: false,
        onOpenAdd: jest.fn(),
        onNewChat: jest.fn(),
        openPalette: jest.fn(),
        onStudioNavigate: jest.fn(),
        onOpenSource,
        ...overrides,
    };
    return { ...render(<AskPanel {...props} />), props, onOpenSource };
}

function question(): HTMLElement {
    const turn = screen.getByText(/with the handbook/).closest("[data-chat-message]");
    if (!(turn instanceof HTMLElement)) throw new Error("the question is not in the transcript");
    return turn;
}

describe("a sent message's sources", () => {
    it("draws a mentioned source as a chip in the words that opens it, and the carried scope under them", async () => {
        const { onOpenSource } = mount();
        const chips = within(question()).getAllByRole("button", { name: "Open Retrieval Plan" });
        // Once in the words; not again in the row under them.
        expect(chips).toHaveLength(1);
        expect(
            within(question()).getByRole("button", { name: "Open Handbook" })
        ).toBeInTheDocument();
        await userEvent.click(chips[0]!);
        expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    });

    it("shows a source the reader cannot open as an unavailable chip, never by the server's placeholder word", () => {
        mount();
        expect(within(question()).getByText("Unavailable source")).toBeInTheDocument();
        expect(within(question()).queryByText("unavailable")).toBeNull();
    });

    it("counts only the sources the reader can open, and opens the composer's picker from the count", async () => {
        mount();
        await userEvent.click(screen.getByRole("button", { name: /asking over 2 sources/ }));
        expect(await screen.findByLabelText("Search sources")).toBeInTheDocument();
    });

    it("gives a reader of a shared chat the count as text, not a button", () => {
        mount({ readOnly: { ownerAuthUserId: "owner-1", onContinue: jest.fn() } });
        expect(screen.queryByRole("button", { name: /asking over/ })).toBeNull();
        expect(screen.getByText(/asking over 2 sources/)).toBeInTheDocument();
    });
});
