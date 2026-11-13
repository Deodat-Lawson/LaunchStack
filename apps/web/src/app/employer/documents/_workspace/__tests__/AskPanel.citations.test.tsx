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
 * passage. This pins the click path.
 *
 * No page is shown: indexing stores `page_number: 1` for every chunk, so the
 * badge said "p. 1" wherever a passage came from. The page still travels in
 * the reference — the viewer uses it — it is just not claimed in the UI.
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

function renderPanel(onOpenCitation: (c: ThreadReference) => void, thread = THREAD) {
    return render(
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
}

describe("AskPanel citations", () => {
    it("renders the citation without claiming a page", () => {
        renderPanel(jest.fn());
        const chip = screen.getByRole("button", {
            name: "Open Q3 Retrieval Plan.pdf at the cited passage",
        });
        expect(chip).toHaveTextContent("Q3 Retrieval Plan.pdf");
        // The passage itself is the chip's tooltip.
        expect(chip).toHaveAttribute("title", `“${CITATION.snippet}”`);
        // Every chunk is indexed as page 1, so any page here would be a
        // precise-looking lie. Pinned so re-adding it is deliberate.
        expect(screen.queryByText(/^p\. \d+$/)).not.toBeInTheDocument();
        expect(chip).not.toHaveTextContent(/p\. \d/);
    });

    it("hands the full reference to onOpenCitation on click", async () => {
        const user = userEvent.setup();
        const onOpenCitation = jest.fn();
        renderPanel(onOpenCitation);

        await user.click(
            screen.getByRole("button", { name: "Open Q3 Retrieval Plan.pdf at the cited passage" })
        );

        expect(onOpenCitation).toHaveBeenCalledTimes(1);
        expect(onOpenCitation).toHaveBeenCalledWith(CITATION);
    });

    it.each([undefined, "complete", "stopped", "error"] as const)(
        "links web citations in saved answers with status %s using each answer's own sources",
        async status => {
            const onOpenCitation = jest.fn();
            const urls = ["https://docs.example.com/docker", "https://docs.example.com/models"];
            renderPanel(onOpenCitation, [
                { role: "user", text: "Are model weights bundled?" },
                {
                    role: "assistant",
                    text: "The runtime is bundled [Source 1].",
                    status,
                    webSources: [{ title: "Docker deployment", url: urls[0]! }],
                    citations: [CITATION],
                },
                { role: "user", text: "Which models work?" },
                {
                    role: "assistant",
                    text: "These models are supported [Source 1].",
                    webSources: [{ title: "Supported models", url: urls[1]! }],
                },
            ]);

            const links = await screen.findAllByRole("link", { name: "[Source 1]" });
            expect(links.map(link => link.getAttribute("href"))).toEqual(urls);
            for (const link of links) {
                expect(link).toHaveAttribute("target", "_blank");
                expect(link).toHaveAttribute("rel", "noopener noreferrer");
            }
            await userEvent.click(
                screen.getByRole("button", {
                    name: "Open Q3 Retrieval Plan.pdf at the cited passage",
                })
            );
            expect(onOpenCitation).toHaveBeenCalledWith(CITATION);
        }
    );

    it("links web citations inside a proposed plan", async () => {
        renderPanel(jest.fn(), [
            {
                role: "user",
                text: "Plan the deployment",
                send: {
                    text: "Plan the deployment",
                    refs: [],
                    attachments: [],
                    webSearch: true,
                    thinking: true,
                    agentKey: null,
                    chatMode: "plan",
                },
            },
            {
                role: "assistant",
                text: "Use this deployment guide [Source 1].",
                webSources: [
                    { title: "Docker deployment", url: "https://docs.example.com/docker" },
                ],
            },
        ]);
        expect(await screen.findByRole("link", { name: "[Source 1]" })).toHaveAttribute(
            "href",
            "https://docs.example.com/docker"
        );
    });
});
