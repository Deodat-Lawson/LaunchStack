/** @jest-environment jsdom */

/**
 * ⌘K reaches past conversations.
 *
 * It was "jump to anything" except a past chat — only the sidebar's History
 * tab could reopen one, which left the sidebar filter looking like a second,
 * smaller search. These pin that history is in the palette, that it stays a
 * short list until you type, and that Enter picks the row you are on: rows
 * run in the order the groups are drawn, because Enter picks by position.
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { HistoryEntry } from "~/lib/workspace-history";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("~/lib/settings/useSettings", () => ({ useSettingValue: () => false }));
jest.mock("~/lib/settings/registry", () => ({ searchSettings: () => [] }));
jest.mock("~/lib/context-menu", () => ({
    APP_TARGET_KIND: "app",
    actionItems: () => [],
    listActions: () => [],
}));

import { CommandPalette } from "../CommandPalette";

const NOW = new Date().toISOString();

function entry(over: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "title">): HistoryEntry {
    return { kind: "chat", refId: over.id, status: "done", at: NOW, ...over };
}

const HISTORY: HistoryEntry[] = [
    entry({ id: "chat:1", title: "Indemnity cap" }),
    entry({ id: "chat:2", title: "Q3 launch plan review" }),
    entry({ id: "chat:3", title: "Hiring budget" }),
    entry({ id: "chat:4", title: "Pricing page copy" }),
    entry({ id: "chat:5", title: "Board deck outline" }),
    entry({ id: "chat:6", title: "Older chat about launch" }),
    // A run with nowhere to open: it must not be offered.
    entry({ id: "trend-search:t1", kind: "trend-search", title: "Launch trends", href: undefined }),
];

function setup(onPickHistory = jest.fn()) {
    render(
        <CommandPalette
            open
            onClose={jest.fn()}
            sources={[]}
            onPickSource={jest.fn()}
            history={HISTORY}
            onPickHistory={onPickHistory}
        />
    );
    return onPickHistory;
}

describe("CommandPalette history", () => {
    it("shows the latest few chats before anything is typed", () => {
        setup();
        expect(screen.getByText("History")).toBeInTheDocument();
        expect(screen.getByText("Indemnity cap")).toBeInTheDocument();
        expect(screen.getByText("Board deck outline")).toBeInTheDocument();
        // The sixth is past the recent cut.
        expect(screen.queryByText("Older chat about launch")).not.toBeInTheDocument();
    });

    it("finds an older chat by what it was about", () => {
        setup();
        fireEvent.change(screen.getByPlaceholderText(/Jump to anything/), {
            target: { value: "launch" },
        });
        expect(screen.getByText("Q3 launch plan review")).toBeInTheDocument();
        expect(screen.getByText("Older chat about launch")).toBeInTheDocument();
    });

    it("does not offer a run that has nowhere to open", () => {
        setup();
        fireEvent.change(screen.getByPlaceholderText(/Jump to anything/), {
            target: { value: "launch" },
        });
        expect(screen.queryByText("Launch trends")).not.toBeInTheDocument();
    });

    it("reopens the chat that was clicked", () => {
        const onPickHistory = setup();
        fireEvent.click(screen.getByText("Hiring budget"));
        expect(onPickHistory).toHaveBeenCalledWith(HISTORY[2]);
    });

    it("picks the highlighted history row with Enter", () => {
        const onPickHistory = setup();
        const input = screen.getByPlaceholderText(/Jump to anything/);
        fireEvent.change(input, { target: { value: "hiring" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onPickHistory).toHaveBeenCalledWith(HISTORY[2]);
    });
});
