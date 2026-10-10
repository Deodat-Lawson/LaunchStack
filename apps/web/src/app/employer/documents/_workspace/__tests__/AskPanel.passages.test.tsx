/** @jest-environment jsdom */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AskPanel } from "../AskPanel";
import type { ThreadMessage, ThreadReference, WorkspaceSource } from "../types";

/**
 * A question asked about a selected passage shows the passage as an excerpt
 * card above it — and clicking the card's title jumps to the passage in its
 * document. Chats saved before passages travelled beside the question still
 * carry the passage as a pasted quote with a machine link; that link must
 * never show.
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
    useChatRoutes: () => ({ routes: [], loading: false }),
}));

const SOURCES: WorkspaceSource[] = [
    {
        id: "d7",
        documentId: 7,
        title: "Dense X Retrieval.pdf",
        type: "doc",
        size: "",
        added: "2h ago",
        folder: "Papers",
        tags: [],
        domain: "Technical",
    },
];

const PASSAGE = {
    sourceId: "d7",
    documentId: 7,
    title: "Dense X Retrieval.pdf",
    page: 1,
    text: "we introduce a novel retrieval unit, proposition, for dense retrieval.",
};

function renderPanel(thread: ThreadMessage[], onOpenCitation = jest.fn()) {
    render(
        <AskPanel
            sources={SOURCES}
            selected={[]}
            setSelected={jest.fn()}
            thread={thread}
            sendMessage={jest.fn()}
            isSending={false}
            onOpenCitation={onOpenCitation}
            onOpenAdd={jest.fn()}
            onNewChat={jest.fn()}
            openPalette={jest.fn()}
            onStudioNavigate={jest.fn()}
        />
    );
    return onOpenCitation;
}

describe("a question asked about a passage", () => {
    it("shows the passage card above the question and jumps to it in the document", async () => {
        const user = userEvent.setup();
        const onOpenCitation = renderPanel([
            {
                role: "user",
                text: "What is the novel retrieval unit?",
                refs: ["d7"],
                send: {
                    text: "What is the novel retrieval unit?",
                    refs: ["d7"],
                    attachments: [],
                    webSearch: true,
                    thinking: true,
                    agentKey: null,
                    passages: [PASSAGE],
                },
            },
        ]);
        const passages = screen.getByTestId("question-passages");
        expect(within(passages).getByText(PASSAGE.text)).toBeInTheDocument();
        expect(within(passages).getByText("p. 1")).toBeInTheDocument();
        expect(screen.getByText("What is the novel retrieval unit?")).toBeInTheDocument();
        await user.click(within(passages).getByRole("button", { name: "Dense X Retrieval.pdf" }));
        expect(onOpenCitation).toHaveBeenCalledWith({
            sourceId: "d7",
            snippet: PASSAGE.text,
            page: 1,
        } satisfies ThreadReference);
    });

    it("renders an old pasted-quote turn without its machine link", () => {
        renderPanel([
            {
                role: "user",
                text: "> sentence. We discover that the retrieval unit\n> choice significantly impacts\n\n[Quoted context](#launchstack-quoted-context)\n\nWhat is the novel retrieval unit?",
            },
        ]);
        expect(screen.getByTestId("question-quote")).toHaveTextContent(
            "sentence. We discover that the retrieval unit"
        );
        expect(screen.getByText("What is the novel retrieval unit?")).toBeInTheDocument();
        expect(document.body.textContent).not.toContain("Quoted context");
        expect(document.body.textContent).not.toContain("launchstack-quoted-context");
    });
});
