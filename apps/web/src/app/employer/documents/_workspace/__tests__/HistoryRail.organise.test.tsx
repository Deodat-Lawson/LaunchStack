/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { HistoryEntry } from "~/lib/workspace-history";

import { ContextMenuProvider } from "~/components/context-menu";
import { HistoryRail, PINNED_CHAT_DRAG_MIME, type HistoryRailProps } from "../HistoryRail";

/**
 * History as Codex lays it out (ADR-014 §5): Pinned on top in the order you
 * gave them, Shared with you with who shared each and what's new, then your
 * chats and runs by date. Every verb here is the reader's own — pinning or
 * archiving someone else's chat changes nobody else's list.
 */

jest.mock("~/lib/profile/use-people", () => ({
    usePeople: (ids: readonly string[]) =>
        Object.fromEntries(
            ids.map(id => [
                id,
                {
                    authUserId: id,
                    name: "Bea Ortiz",
                    email: "bea@acme.test",
                    displayName: "Bea Ortiz",
                    title: null,
                    pronouns: null,
                    avatarUrl: null,
                    member: true,
                },
            ])
        ),
}));

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function chat(over: Partial<HistoryEntry> & Pick<HistoryEntry, "refId" | "title">): HistoryEntry {
    return {
        id: `chat:${over.refId}`,
        kind: "chat",
        status: "done",
        at: ago(5),
        messageCount: 2,
        pinned: false,
        pinRank: null,
        archived: false,
        shared: false,
        ...over,
    };
}

const BOARD = chat({ refId: "board", title: "Board prep", pinned: true, pinRank: 1, at: ago(1) });
const PRICING = chat({
    refId: "pricing",
    title: "Pricing memo",
    pinned: true,
    pinRank: 0,
    sharedBy: "user-b",
    unread: false,
    at: ago(500),
});
const ROADMAP = chat({ refId: "roadmap", title: "Roadmap", pinned: true, pinRank: 2, at: ago(30) });
const Q3 = chat({
    refId: "q3",
    title: "Q3 plan",
    sharedBy: "user-b",
    unread: true,
    messageCount: 3,
    at: ago(2),
});
const VENDOR = chat({ refId: "vendor", title: "Vendor review", shared: true, at: ago(3) });
const RUN: HistoryEntry = {
    id: "distribution:r1",
    kind: "distribution",
    refId: "r1",
    title: "Partners",
    status: "done",
    at: ago(4),
    href: "/employer/tools/distribution",
};

function setup(over: Partial<HistoryRailProps> = {}) {
    const props: HistoryRailProps = {
        entries: [BOARD, PRICING, ROADMAP, Q3, VENDOR, RUN],
        loading: false,
        error: null,
        degraded: [],
        activeSessionId: null,
        query: "",
        onNewChat: jest.fn(),
        onResumeSession: jest.fn(),
        onOpenRun: jest.fn(),
        onRenameSession: jest.fn(),
        onDeleteRun: jest.fn(),
        onDeleteSession: jest.fn(),
        onRefresh: jest.fn(),
        onSetPinned: jest.fn(),
        onSetArchived: jest.fn(),
        onReorderPins: jest.fn(),
        onShareSession: jest.fn(),
        onContinueSession: jest.fn(),
        archived: { open: false, entries: [], loading: false, error: null, count: 2 },
        onArchivedOpenChange: jest.fn(),
        ...over,
    };
    render(
        <ContextMenuProvider>
            <HistoryRail {...props} />
        </ContextMenuProvider>
    );
    return props;
}

const rowIdsIn = (testId: string) =>
    within(screen.getByTestId(testId))
        .getAllByTestId(/^history-row-/)
        .map(row => row.getAttribute("data-testid"));

function menuOf(title: string) {
    fireEvent.click(screen.getByLabelText(`Actions for ${title}`));
    return screen.getByRole("menu");
}

const labels = (menu: HTMLElement) =>
    within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent?.replace(/⌥[↑↓]/, "").trim());

describe("HistoryRail sections", () => {
    it("draws Pinned in manual order, then Shared with you, then the dated recents", () => {
        setup();
        expect(rowIdsIn("history-section-pinned")).toEqual([
            "history-row-chat:pricing",
            "history-row-chat:board",
            "history-row-chat:roadmap",
        ]);
        expect(rowIdsIn("history-section-shared")).toEqual(["history-row-chat:q3"]);
        // Each row lives in one section only.
        expect(screen.getAllByTestId("history-row-chat:q3")).toHaveLength(1);
        expect(screen.getByText("Today")).toBeInTheDocument();
        expect(screen.getByText("Vendor review")).toBeInTheDocument();
        expect(screen.getByText("Partners")).toBeInTheDocument();
    });

    it("says who shared a chat and marks what's new since you opened it", () => {
        setup();
        const row = screen.getByTestId("history-row-chat:q3");
        expect(within(row).getByText("Bea Ortiz · 3 turns")).toBeInTheDocument();
        expect(within(row).getByLabelText("Unread")).toBeInTheDocument();
        expect(
            within(screen.getByTestId("history-row-chat:pricing")).queryByLabelText("Unread")
        ).not.toBeInTheDocument();
    });

    it("marks your own chat that other people can read", () => {
        setup();
        expect(
            within(screen.getByTestId("history-row-chat:vendor")).getByRole("img", {
                name: "Shared",
            })
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId("history-row-chat:board")).queryByRole("img", {
                name: "Shared",
            })
        ).not.toBeInTheDocument();
    });
});

describe("HistoryRail row menus", () => {
    it("offers your own chat pin, share, rename, archive and delete", () => {
        setup();
        expect(labels(menuOf("Vendor review"))).toEqual([
            "Open",
            "Pin",
            "Share…",
            "Rename…",
            "Archive",
            "Delete chat…",
        ]);
    });

    it("offers a chat shared with you pin, continue and archive — never rename, share or delete", () => {
        setup();
        expect(labels(menuOf("Q3 plan"))).toEqual([
            "Open",
            "Pin",
            "Continue in a new chat",
            "Archive",
        ]);
    });

    it("pins, shares, continues and archives through the caller", () => {
        const props = setup();
        fireEvent.click(within(menuOf("Vendor review")).getByText("Pin"));
        expect(props.onSetPinned).toHaveBeenCalledWith(VENDOR, true);

        fireEvent.click(within(menuOf("Vendor review")).getByText("Share…"));
        expect(props.onShareSession).toHaveBeenCalledWith(VENDOR);

        fireEvent.click(within(menuOf("Q3 plan")).getByText("Continue in a new chat"));
        expect(props.onContinueSession).toHaveBeenCalledWith(Q3);

        fireEvent.click(within(menuOf("Q3 plan")).getByText("Archive"));
        expect(props.onSetArchived).toHaveBeenCalledWith(Q3, true);

        fireEvent.click(within(menuOf("Board prep")).getByText("Unpin"));
        expect(props.onSetPinned).toHaveBeenCalledWith(BOARD, false);
    });
});

describe("reordering pins", () => {
    it("moves a pin up or down from its menu, and can't move the top one up", () => {
        const props = setup();
        const top = menuOf("Pricing memo");
        expect(within(top).getByText("Move up").closest("[role=menuitem]")).toHaveAttribute(
            "aria-disabled",
            "true"
        );
        fireEvent.click(within(top).getByText("Move down"));
        expect(props.onReorderPins).toHaveBeenCalledWith(["board", "pricing", "roadmap"]);
    });

    it("moves a focused pin with Alt+Arrow", () => {
        const props = setup();
        fireEvent.keyDown(screen.getByTestId("history-row-chat:roadmap"), {
            key: "ArrowUp",
            altKey: true,
        });
        expect(props.onReorderPins).toHaveBeenCalledWith(["pricing", "roadmap", "board"]);
        expect(props.onResumeSession).not.toHaveBeenCalled();
    });

    it("drops a dragged pin before the row it lands on", () => {
        const props = setup();
        const store = new Map<string, string>();
        const dataTransfer = {
            setData: (type: string, value: string) => store.set(type, value),
            getData: (type: string) => store.get(type) ?? "",
            effectAllowed: "",
            dropEffect: "",
        };
        const roadmap = screen.getByTestId("history-row-chat:roadmap");
        const pricing = screen.getByTestId("history-row-chat:pricing");

        fireEvent.dragStart(roadmap, { dataTransfer });
        expect(store.get(PINNED_CHAT_DRAG_MIME)).toBe("roadmap");
        fireEvent.dragOver(pricing, { dataTransfer, clientY: -1 });
        fireEvent.drop(pricing, { dataTransfer, clientY: -1 });

        expect(props.onReorderPins).toHaveBeenCalledWith(["roadmap", "pricing", "board"]);
    });

    it("only pinned rows are draggable", () => {
        setup();
        expect(screen.getByTestId("history-row-chat:board")).toHaveAttribute("draggable", "true");
        expect(screen.getByTestId("history-row-chat:vendor")).not.toHaveAttribute("draggable");
    });
});

describe("the Archived view", () => {
    it("is a link at the foot of the list, with the count", () => {
        const props = setup();
        const link = screen.getByTestId("history-archived-link");
        expect(link).toHaveTextContent("Archived· 2");
        fireEvent.click(link);
        expect(props.onArchivedOpenChange).toHaveBeenCalledWith(true);
    });

    it("lists archived chats and restores them; only your own can be deleted", async () => {
        const gone = chat({ refId: "gone", title: "Old notes", archived: true });
        const theirs = chat({
            refId: "theirs",
            title: "Their memo",
            archived: true,
            sharedBy: "user-b",
        });
        const props = setup({
            archived: {
                open: true,
                entries: [gone, theirs],
                loading: false,
                error: null,
                count: 2,
            },
        });

        expect(screen.getByTestId("history-archived")).toBeInTheDocument();
        expect(screen.queryByText("Board prep")).not.toBeInTheDocument();
        expect(screen.queryByTestId("history-new-chat")).not.toBeInTheDocument();

        expect(labels(menuOf("Old notes"))).toEqual(["Open", "Unarchive", "Delete chat…"]);
        fireEvent.click(screen.getByText("Unarchive"));
        expect(props.onSetArchived).toHaveBeenCalledWith(gone, false);

        expect(labels(menuOf("Their memo"))).toEqual([
            "Open",
            "Continue in a new chat",
            "Unarchive",
        ]);

        fireEvent.click(screen.getByTestId("history-archived-back"));
        expect(props.onArchivedOpenChange).toHaveBeenCalledWith(false);
    });

    it("says so when nothing is archived", () => {
        setup({ archived: { open: true, entries: [], loading: false, error: null, count: 0 } });
        expect(screen.getByText(/Nothing archived/)).toBeInTheDocument();
    });
});
