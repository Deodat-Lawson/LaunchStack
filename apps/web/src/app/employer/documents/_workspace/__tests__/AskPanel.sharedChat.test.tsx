/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { AskPanel, type AskPanelProps } from "../AskPanel";
import type { ThreadMessage } from "../types";

/**
 * Reading a chat someone shared with you (ADR-014 §4): the header says whose
 * it is, the composer gives way to "Continue in a new chat", nothing offers to
 * write into a composer that isn't there, and the citations the server hid
 * are counted rather than silently missing. Your own chat gets a Share button.
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
jest.mock("~/lib/profile/use-people", () => ({
    usePeople: (ids: readonly string[]) =>
        Object.fromEntries(
            ids.map(id => [
                id,
                {
                    authUserId: id,
                    name: "Ada Lovelace",
                    email: "ada@acme.test",
                    displayName: "Ada Lovelace",
                    title: null,
                    pronouns: null,
                    avatarUrl: null,
                    member: true,
                },
            ])
        ),
}));

const THREAD: ThreadMessage[] = [
    { role: "user", text: "What is the cap?" },
    { role: "assistant", text: "Five million.", citations: [], hiddenCitations: 2 },
];

function renderPanel(over: Partial<AskPanelProps> = {}) {
    const props: AskPanelProps = {
        sources: [],
        selected: [],
        setSelected: jest.fn(),
        thread: THREAD,
        sendMessage: jest.fn(),
        isSending: false,
        onOpenAdd: jest.fn(),
        onNewChat: jest.fn(),
        openPalette: jest.fn(),
        onStudioNavigate: jest.fn(),
        title: "Indemnity cap",
        ...over,
    };
    render(<AskPanel {...props} />);
    return props;
}

describe("AskPanel reading a shared chat", () => {
    it("says whose chat it is and how many citations were hidden", () => {
        renderPanel({
            readOnly: { ownerAuthUserId: "user-a", hiddenCitations: 2, onContinue: jest.fn() },
        });
        expect(screen.getByTestId("shared-by")).toHaveTextContent("Shared by Ada Lovelace");
        expect(screen.getByText("· 2 hidden")).toBeInTheDocument();
        expect(screen.getByTestId("hidden-citations")).toHaveTextContent(
            "2 sources you can’t open are hidden."
        );
        // Their questions are under their name, not "You".
        expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
        expect(screen.queryByText("You")).not.toBeInTheDocument();
    });

    it("replaces the composer with a quiet bar that continues it as your own", async () => {
        let finish: () => void = () => undefined;
        const onContinue = jest.fn(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve;
                })
        );
        renderPanel({ readOnly: { ownerAuthUserId: "user-a", onContinue } });

        expect(screen.getByTestId("read-only-bar")).toHaveTextContent("You can read this chat.");
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /Continue in a new chat/ }));
        expect(onContinue).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: /Continuing…/ })).toBeDisabled();
        await act(async () => finish());
        expect(screen.getByRole("button", { name: /Continue in a new chat/ })).toBeEnabled();
    });

    it("offers no verbs that write into a composer, and no rename or share", () => {
        renderPanel({
            readOnly: { ownerAuthUserId: "user-a", onContinue: jest.fn() },
        });
        expect(screen.queryByLabelText("Quote in reply")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Edit and ask again")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Rename conversation")).not.toBeInTheDocument();
        expect(screen.queryByTestId("chat-share")).not.toBeInTheDocument();
        // Copying is still reading.
        expect(screen.getAllByLabelText("Copy message").length).toBeGreaterThan(0);
    });
});

describe("AskPanel on your own chat", () => {
    it("has a Share button and the composer", () => {
        const onShare = jest.fn();
        renderPanel({ onShare });
        fireEvent.click(screen.getByTestId("chat-share"));
        expect(onShare).toHaveBeenCalled();
        expect(screen.queryByTestId("read-only-bar")).not.toBeInTheDocument();
        expect(screen.queryByTestId("shared-by")).not.toBeInTheDocument();
        expect(screen.getAllByLabelText("Quote in reply").length).toBeGreaterThan(0);
    });
});
