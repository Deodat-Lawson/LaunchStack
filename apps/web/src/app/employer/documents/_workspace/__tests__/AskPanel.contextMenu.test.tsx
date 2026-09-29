/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { ContextMenuProvider } from "~/components/context-menu";
import { resetActionsForTests, resetTargetsForTests } from "~/lib/context-menu";
import { AskPanel } from "../AskPanel";
import type { ThreadMessage, ThreadReference, WorkspaceSource } from "../types";

/**
 * Right-click in the chat: an answer, a citation, the composer and the pane
 * each get their own verbs. The session-level verbs (branch, ask again) are
 * the shell's and are covered by the resolver tests.
 */

jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({
        workspaces: [],
        activeCompanyId: null,
        switchingTo: null,
        onSwitch: jest.fn(),
    }),
}));
jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({ routes: [], loading: false, reasoningEnabled: false }),
}));

const SOURCES: WorkspaceSource[] = [
    {
        id: "d7",
        documentId: 7,
        title: "Q3 Retrieval Plan.pdf",
        type: "doc",
        size: "",
        added: "2h ago",
        folder: "Plans",
        tags: [],
        domain: "Technical",
    },
];

const CITATION: ThreadReference = {
    sourceId: "d7",
    snippet: "Recall improved substantially in Q3 after the reranker landed.",
    page: 4,
};

const THREAD: ThreadMessage[] = [
    { role: "user", text: "How did recall change?" },
    { role: "assistant", text: "Recall improved **after the reranker**.", citations: [CITATION] },
];

function Harness({
    onOpenCitation = jest.fn(),
    onNewChat = jest.fn(),
    thread = THREAD,
}: {
    onOpenCitation?: (c: ThreadReference) => void;
    onNewChat?: () => void;
    thread?: ThreadMessage[];
}) {
    const [selected, setSelected] = useState<string[]>([]);
    return (
        <ContextMenuProvider>
            <AskPanel
                sources={SOURCES}
                selected={selected}
                setSelected={setSelected}
                thread={thread}
                sendMessage={jest.fn()}
                isSending={false}
                onOpenCitation={onOpenCitation}
                onOpenAdd={jest.fn()}
                onNewChat={onNewChat}
                openPalette={jest.fn()}
                onStudioNavigate={jest.fn()}
                webSearch={false}
                onToggleWebSearch={jest.fn()}
                thinking={false}
                onToggleThinking={jest.fn()}
            />
        </ContextMenuProvider>
    );
}

describe("AskPanel context menus", () => {
    beforeEach(() => {
        resetActionsForTests();
        resetTargetsForTests();
    });

    it("quotes an answer into the composer from its menu", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        // The bold run alone: the citation's snippet repeats the phrase.
        fireEvent.contextMenu(screen.getByText("after the reranker"));
        expect(screen.getByTestId("context-menu")).toHaveAttribute("aria-label", "Answer actions");
        expect(screen.getByTestId("context-menu-item-copy")).toHaveTextContent("Copy answer");
        await user.click(screen.getByTestId("context-menu-item-quote"));
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Ask anything/)).toHaveValue(
                "> Recall improved after the reranker.\n\n"
            )
        );
    });

    it("puts a question back in the composer to edit", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        fireEvent.contextMenu(screen.getByText("How did recall change?"));
        await user.click(screen.getByTestId("context-menu-item-edit"));
        await waitFor(() =>
            expect(screen.getByPlaceholderText(/Ask anything/)).toHaveValue(
                "How did recall change?"
            )
        );
    });

    it("opens the cited passage and toggles the source's context from a citation", async () => {
        const user = userEvent.setup();
        const onOpenCitation = jest.fn();
        render(<Harness onOpenCitation={onOpenCitation} />);
        fireEvent.contextMenu(screen.getByText(CITATION.snippet));
        expect(screen.getByTestId("context-menu-item-context")).toHaveTextContent(
            "Add source to context"
        );
        await user.click(screen.getByTestId("context-menu-item-open"));
        expect(onOpenCitation).toHaveBeenCalledWith(CITATION);

        fireEvent.contextMenu(screen.getByText(CITATION.snippet));
        await user.click(screen.getByTestId("context-menu-item-context"));
        // The source is pinned now: it shows as a chip and the verb flips.
        expect(await screen.findByText("Context")).toBeInTheDocument();
        fireEvent.contextMenu(screen.getByText(CITATION.snippet));
        expect(screen.getByTestId("context-menu-item-context")).toHaveTextContent(
            "Leave out of the next answer"
        );
    });

    it("gives the composer its own menu even though it is a textarea", () => {
        render(<Harness />);
        fireEvent.contextMenu(screen.getByPlaceholderText(/Ask anything/));
        expect(screen.getByTestId("context-menu")).toHaveAttribute(
            "aria-label",
            "Composer actions"
        );
        expect(screen.getByTestId("context-menu-item-attach")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-paste")).toBeInTheDocument();
    });

    it("offers the pane's verbs on empty chat space", async () => {
        const user = userEvent.setup();
        const onNewChat = jest.fn();
        render(<Harness onNewChat={onNewChat} />);
        fireEvent.contextMenu(screen.getByText(/Grounded answers only/));
        expect(screen.getByTestId("context-menu")).toHaveAttribute("aria-label", "Chat actions");
        await user.click(screen.getByTestId("context-menu-item-new-chat"));
        expect(onNewChat).toHaveBeenCalled();
    });
});
