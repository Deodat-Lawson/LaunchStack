/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { HistoryEntry } from "~/lib/workspace-history";

import { ContextMenuProvider } from "~/components/context-menu";
import { SourceRail, type SourceRailProps } from "../SourceRail";
import type { WorkspaceFolder, WorkspaceSource } from "../types";

/**
 * The rail holds two lists behind one search box. What matters here is that
 * they stay separate — the tab decides which list the field filters and which
 * controls belong on screen — and that a rail given no history props is
 * exactly the sources-only rail it was before.
 */

const SOURCES: WorkspaceSource[] = [
    {
        id: "d1",
        documentId: 1,
        title: "Vendor agreement.pdf",
        type: "doc",
        size: "",
        added: "just now",
        folder: "Contracts",
        tags: [],
        domain: "General",
    },
];
const FOLDERS: WorkspaceFolder[] = [{ id: "f-Contracts", name: "Contracts", color: "x" }];

const CHAT: HistoryEntry = {
    id: "chat:s1",
    kind: "chat",
    refId: "s1",
    title: "Indemnity cap",
    status: "done",
    at: new Date().toISOString(),
    messageCount: 2,
};

function history(over: Partial<NonNullable<SourceRailProps["history"]>> = {}) {
    return {
        entries: [CHAT],
        loading: false,
        error: null,
        degraded: [],
        activeSessionId: null,
        onNewChat: jest.fn(),
        onResumeSession: jest.fn(),
        onOpenRun: jest.fn(),
        onRenameSession: jest.fn(),
        onDeleteSession: jest.fn(),
        onRefresh: jest.fn(),
        ...over,
    };
}

function Harness({ withHistory = true }: { withHistory?: boolean }) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <ContextMenuProvider>
            <SourceRail
                sources={SOURCES}
                folders={FOLDERS}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={jest.fn()}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
                history={withHistory ? history() : undefined}
            />
        </ContextMenuProvider>
    );
}

beforeEach(() => {
    localStorage.clear();
});

describe("SourceRail tabs", () => {
    it("opens on Sources", () => {
        render(<Harness />);
        expect(screen.getByTestId("rail-tab-sources")).toHaveAttribute("aria-selected", "true");
        expect(screen.getByTestId("source-rail-list")).toBeInTheDocument();
        expect(screen.queryByTestId("history-rail")).not.toBeInTheDocument();
    });

    it("swaps the list — and the search box's job — when History is picked", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("rail-tab-history"));

        expect(screen.getByTestId("history-rail")).toBeInTheDocument();
        expect(screen.queryByTestId("source-rail-list")).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText("Search history")).toBeInTheDocument();
    });

    it("filters history through the rail's one search box", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("rail-tab-history"));
        expect(screen.getByText("Indemnity cap")).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("Search history"), {
            target: { value: "zzz" },
        });
        expect(screen.queryByText("Indemnity cap")).not.toBeInTheDocument();
    });

    it("remembers the tab across a remount", () => {
        const { unmount } = render(<Harness />);
        fireEvent.click(screen.getByTestId("rail-tab-history"));
        unmount();

        render(<Harness />);
        expect(screen.getByTestId("rail-tab-history")).toHaveAttribute("aria-selected", "true");
    });

    it("is the plain sources rail — no tab strip — when history is not wired up", () => {
        render(<Harness withHistory={false} />);
        expect(screen.queryByTestId("rail-tab-history")).not.toBeInTheDocument();
        expect(screen.getByTestId("source-rail-list")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Search your knowledge")).toBeInTheDocument();
    });

    it("falls back to Sources when a remembered History tab has nothing to show it in", () => {
        localStorage.setItem("workspace.railTab.v1", "history");
        render(<Harness withHistory={false} />);
        expect(screen.getByTestId("source-rail-list")).toBeInTheDocument();
    });
});
