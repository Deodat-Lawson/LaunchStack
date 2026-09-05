/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AskPanel } from "../AskPanel";
import type { ThreadMessage, ThreadReference, WorkspaceSource } from "../types";

/**
 * Citations under a grounded answer are the bridge from the answer back to
 * the evidence: clicking one must hand the full reference (snippet + page +
 * matchText) to the shell so the viewer can open the document at that
 * passage. This pins the click path and the page badge.
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
    matchText: "reranker",
};

const THREAD: ThreadMessage[] = [
    { role: "user", text: "How did recall change?" },
    { role: "assistant", text: "Recall improved after the reranker.", citations: [CITATION] },
];

function renderPanel(onOpenCitation: (c: ThreadReference) => void) {
    return render(
        <AskPanel
            sources={SOURCES}
            selected={[]}
            setSelected={jest.fn()}
            thread={THREAD}
            sendMessage={jest.fn()}
            isSending={false}
            onOpenCitation={onOpenCitation}
            onOpenAdd={jest.fn()}
            onNewChat={jest.fn()}
            openPalette={jest.fn()}
            onStudioNavigate={jest.fn()}
            userInitials="TL"
            webSearch={false}
            onToggleWebSearch={jest.fn()}
            thinking={false}
            onToggleThinking={jest.fn()}
        />
    );
}

describe("AskPanel citations", () => {
    it("renders the citation with its page badge", () => {
        renderPanel(jest.fn());
        expect(screen.getByText(/Grounded in 1 source/)).toBeInTheDocument();
        expect(screen.getByText(CITATION.snippet)).toBeInTheDocument();
        expect(screen.getByText("p. 4")).toBeInTheDocument();
    });

    it("hands the full reference to onOpenCitation on click", async () => {
        const user = userEvent.setup();
        const onOpenCitation = jest.fn();
        renderPanel(onOpenCitation);

        await user.click(screen.getByTitle("Open the source at this passage"));

        expect(onOpenCitation).toHaveBeenCalledTimes(1);
        expect(onOpenCitation).toHaveBeenCalledWith(CITATION);
    });
});
