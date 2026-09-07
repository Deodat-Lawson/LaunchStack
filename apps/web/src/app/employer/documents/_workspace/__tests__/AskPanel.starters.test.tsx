/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AskPanel } from "../AskPanel";
import { resetAskStartersMemo } from "../useAskStarters";
import type { ComposerSend, WorkspaceSource } from "../types";
import type { AskStartersPayload } from "~/lib/ask-starters/contract";

/**
 * The starter cards on the empty state are the first thing a workspace shows.
 * They must (a) be the server's questions for this workspace, (b) send on
 * click through the same path as a typed message, and (c) pin the document a
 * starter is about so the answer and any follow-up are scoped to it.
 */

jest.mock("next-themes", () => ({
    useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
}));
jest.mock("../../../_chrome/EmployerWorkspaceSwitcherContext", () => ({
    useEmployerWorkspaceSwitcher: () => ({
        name: "Acme Robotics",
        initials: "AR",
        swatch: 1,
        membershipCount: 1,
    }),
}));
jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({ routes: [], loading: false }),
}));

const SOURCES: WorkspaceSource[] = [
    {
        id: "d7",
        documentId: 7,
        title: "Globex MSA 2026.pdf",
        type: "doc",
        size: "",
        added: "2 days ago",
        folder: "Contracts",
        tags: [],
        domain: "Contract",
    },
    {
        id: "d9",
        documentId: 9,
        title: "Onboarding handbook.docx",
        type: "doc",
        size: "",
        added: "last week",
        folder: "HR",
        tags: [],
        domain: "HR",
    },
];

const PAYLOAD: AskStartersPayload = {
    starters: [
        {
            id: "g1",
            question: "What are the renewal terms in the Globex MSA?",
            hint: "from the MSA",
            documentIds: [7],
        },
        {
            id: "g2",
            question: "What does Acme Robotics sell, according to these sources?",
            hint: "across 2 sources",
            documentIds: [],
        },
        {
            id: "g3",
            question: "Which policies does the onboarding handbook require on day one?",
            hint: "from the handbook",
            documentIds: [9],
        },
        {
            id: "g4",
            question: "Summarize a document that was deleted since",
            hint: "stale pin",
            documentIds: [404],
        },
    ],
    basis: {
        companyName: "Acme Robotics",
        sourceCount: 2,
        hasProfile: true,
        mode: "generated",
        generatedAt: "2026-09-02T00:00:00.000Z",
    },
};

const fetchMock = jest.fn();

function respondWith(payload: AskStartersPayload) {
    fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: payload }),
    });
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    resetAskStartersMemo();
    fetchMock.mockReset();
    respondWith(PAYLOAD);
});

function renderPanel(overrides: {
    sendMessage?: (send: ComposerSend) => void;
    setSelected?: jest.Mock;
    selected?: string[];
    isSending?: boolean;
    onStudioNavigate?: jest.Mock;
}) {
    return render(
        <AskPanel
            sources={SOURCES}
            selected={overrides.selected ?? []}
            setSelected={overrides.setSelected ?? jest.fn()}
            thread={[]}
            sendMessage={overrides.sendMessage ?? jest.fn()}
            isSending={overrides.isSending ?? false}
            onOpenAdd={jest.fn()}
            onNewChat={jest.fn()}
            openPalette={jest.fn()}
            onStudioNavigate={overrides.onStudioNavigate ?? jest.fn()}
            userInitials="TL"
            webSearch={false}
            onToggleWebSearch={jest.fn()}
            thinking={false}
            onToggleThinking={jest.fn()}
        />
    );
}

describe("AskPanel starter questions", () => {
    it("shows the workspace's four questions and what they were built from", async () => {
        renderPanel({});

        expect(await screen.findByText(PAYLOAD.starters[0]!.question)).toBeInTheDocument();
        for (const starter of PAYLOAD.starters) {
            expect(screen.getByText(starter.question)).toBeInTheDocument();
        }
        expect(
            screen.getByText("Suggested from the Acme Robotics profile and 2 sources")
        ).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/ask/starters", expect.anything());
    });

    it("sends a pinned starter over its document and pins it for follow-ups", async () => {
        const user = userEvent.setup();
        const sendMessage = jest.fn();
        const setSelected = jest.fn();
        renderPanel({ sendMessage, setSelected });

        await user.click(await screen.findByText(PAYLOAD.starters[0]!.question));

        expect(setSelected).toHaveBeenCalledWith(["d7"]);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({
            text: "What are the renewal terms in the Globex MSA?",
            refs: ["d7"],
            attachments: [],
            webSearch: false,
            thinking: false,
        });
    });

    it("sends a broad starter over whatever the user already pinned", async () => {
        const user = userEvent.setup();
        const sendMessage = jest.fn();
        const setSelected = jest.fn();
        renderPanel({ sendMessage, setSelected, selected: ["d9"] });

        await user.click(await screen.findByText(PAYLOAD.starters[1]!.question));

        expect(setSelected).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: PAYLOAD.starters[1]!.question, refs: ["d9"] })
        );
    });

    it("drops a pin to a document the workspace no longer has", async () => {
        const user = userEvent.setup();
        const sendMessage = jest.fn();
        const setSelected = jest.fn();
        renderPanel({ sendMessage, setSelected });

        await user.click(await screen.findByText(PAYLOAD.starters[3]!.question));

        expect(setSelected).not.toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ refs: [] }));
    });

    it("waits while a message is in flight", async () => {
        const sendMessage = jest.fn();
        renderPanel({ sendMessage, isSending: true });

        const card = await screen.findByTestId("ask-starter-g1");
        expect(card).toBeDisabled();
    });

    it("asks for a different set on Shuffle", async () => {
        const user = userEvent.setup();
        renderPanel({});
        await screen.findByText(PAYLOAD.starters[0]!.question);

        const shuffled: AskStartersPayload = {
            ...PAYLOAD,
            starters: [
                {
                    id: "g1",
                    question: "Which contracts renew this quarter?",
                    hint: "",
                    documentIds: [],
                },
            ],
        };
        respondWith(shuffled);
        await user.click(screen.getByRole("button", { name: /shuffle/i }));

        expect(await screen.findByText("Which contracts renew this quarter?")).toBeInTheDocument();
        expect(fetchMock).toHaveBeenLastCalledWith(
            "/api/ask/starters?refresh=1",
            expect.anything()
        );
    });

    it("still offers sendable questions when the route is unreachable", async () => {
        const user = userEvent.setup();
        const sendMessage = jest.fn();
        fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        renderPanel({ sendMessage });

        expect(
            await screen.findByText("Suggestions are offline — these still work")
        ).toBeInTheDocument();
        await user.click(screen.getByText("Summarize what my sources cover"));

        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: "Summarize what my sources cover", refs: [] })
        );
    });

    it("offers the company profile when none informed the questions", async () => {
        const user = userEvent.setup();
        const onStudioNavigate = jest.fn();
        respondWith({ ...PAYLOAD, basis: { ...PAYLOAD.basis, hasProfile: false } });
        renderPanel({ onStudioNavigate });

        await user.click(await screen.findByRole("button", { name: /add company profile/i }));

        expect(onStudioNavigate).toHaveBeenCalledWith("/employer/settings#company");
        await waitFor(() =>
            expect(
                screen.getByText("Suggested from 2 sources in Acme Robotics")
            ).toBeInTheDocument()
        );
    });
});
