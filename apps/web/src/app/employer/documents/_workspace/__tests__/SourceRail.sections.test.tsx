/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ContextMenuProvider } from "~/components/context-menu";
import { SourceRail } from "../SourceRail";
import type { ItemAccessView, SourceAudience, WorkspaceFolder, WorkspaceSource } from "../types";

/**
 * ADR-014 §6 in the rail: it is obvious what is mine, what is shared with
 * specific people, and what the whole workspace sees. Three sections, a glyph
 * that says who on the rows that need one, "Added by" on hover, and folder
 * actions offered only where the caller may take them.
 */

jest.mock("~/lib/profile/use-people", () => ({
    usePeople: () => ({
        "bob-auth": { authUserId: "bob-auth", displayName: "Bob (Sales)" },
    }),
}));

const access = (audience: SourceAudience, extra: Partial<ItemAccessView> = {}): ItemAccessView => ({
    audience,
    ownAudience: audience !== "workspace",
    principalCount: audience === "private" ? 1 : audience === "shared" ? 3 : 0,
    canEdit: true,
    canManage: true,
    ...extra,
});

function src(
    id: string,
    folder: string,
    overrides: Partial<WorkspaceSource> = {}
): WorkspaceSource {
    return {
        id,
        documentId: Number(id.slice(1)),
        title: `${id}.pdf`,
        type: "doc",
        size: "",
        added: "2h ago",
        folder,
        tags: [],
        domain: "General",
        ...overrides,
    };
}

function folder(name: string, folderAccess?: ItemAccessView): WorkspaceFolder {
    return { id: `f-${name}`, name, color: "x", access: folderAccess };
}

const SOURCES: WorkspaceSource[] = [
    src("d1", "Sales", {
        access: access("workspace"),
        addedBy: { authUserId: "bob-auth", name: "Bob" },
    }),
    src("d2", "Mine", { access: access("private", { ownAudience: false }) }),
    src("d3", "Board", {
        access: access("shared", { ownAudience: false, canEdit: false, canManage: false }),
    }),
    src("d4", "Unfiled", {
        access: access("private"),
        addedBy: { authUserId: "ada-auth", name: "Ada" },
    }),
    src("d5", "Unfiled", { access: access("workspace") }),
    // A file in Sales shared with fewer people than the folder: a badge.
    src("d6", "Sales", { access: access("shared", { ownAudience: true, principalCount: 2 }) }),
];

const FOLDERS: WorkspaceFolder[] = [
    folder("Sales", access("workspace", { canManage: false })),
    folder("Sales/Private notes", access("private", { ownAudience: true })),
    folder("Sales/Leads", access("workspace")),
    folder("Mine", access("private")),
    folder("Board", access("shared", { canEdit: false, canManage: false })),
    folder("Unfiled", access("workspace")),
];

interface HarnessProps {
    sources?: WorkspaceSource[];
    folders?: WorkspaceFolder[];
    onMoveToFolder?: (id: string, name: string) => void;
    onMoveFolder?: (path: string, target: string | null) => void;
}

function Harness({
    sources = SOURCES,
    folders = FOLDERS,
    onMoveToFolder = jest.fn(),
    onMoveFolder = jest.fn(),
}: HarnessProps) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <ContextMenuProvider>
            <SourceRail
                sources={sources}
                folders={folders}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={jest.fn()}
                onNewFolder={jest.fn()}
                onRenameFolder={jest.fn()}
                onMoveFolder={onMoveFolder}
                onDeleteFolder={jest.fn()}
                onShareFolder={jest.fn()}
                onMoveToFolder={onMoveToFolder}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
                workspaceName="Acme"
                selfAuthId="ada-auth"
            />
        </ContextMenuProvider>
    );
}

describe("SourceRail sections", () => {
    it("files every folder and loose file under Workspace, Shared or Private", () => {
        render(<Harness />);
        const workspace = screen.getByTestId("rail-section-workspace");
        const shared = screen.getByTestId("rail-section-shared");
        const mine = screen.getByTestId("rail-section-private");

        expect(within(workspace).getByTestId("folder-row-Sales")).toBeInTheDocument();
        // Old workspace-wide loose files stay together under Workspace › Unfiled.
        expect(within(workspace).getByTestId("folder-row-Unfiled")).toBeInTheDocument();
        expect(within(workspace).getByTestId("source-row-d5")).toBeInTheDocument();

        expect(within(shared).getByTestId("folder-row-Board")).toBeInTheDocument();
        expect(within(mine).getByTestId("folder-row-Mine")).toBeInTheDocument();
        // A new loose file is filed on its own, in Private.
        expect(within(mine).getByTestId("source-row-d4")).toBeInTheDocument();
        expect(within(workspace).queryByTestId("source-row-d4")).not.toBeInTheDocument();
    });

    it("labels each section in sentence case with how much it holds", () => {
        render(<Harness />);
        expect(
            within(screen.getByTestId("rail-section-workspace")).getByRole("heading")
        ).toHaveTextContent(/^Workspace3$/);
        expect(
            within(screen.getByTestId("rail-section-private")).getByRole("heading")
        ).toHaveTextContent(/^Private2$/);
    });

    it("hides an empty section, except Private, which says where new files land", () => {
        render(
            <Harness
                sources={[src("d5", "Unfiled", { access: access("workspace") })]}
                folders={[folder("Unfiled", access("workspace"))]}
            />
        );
        expect(screen.queryByTestId("rail-section-shared")).not.toBeInTheDocument();
        expect(screen.getByTestId("rail-section-private")).toHaveTextContent(
            "Files you add start here. Share them when you're ready."
        );
    });

    it("says who can see a row: Only you, Shared with 3, and nothing for everyone", () => {
        render(<Harness />);
        expect(
            within(screen.getByTestId("folder-row-Mine")).getByRole("img", { name: "Only you" })
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId("folder-row-Board")).getByRole("img", {
                name: "Shared with 3",
            })
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId("source-row-d4")).getByRole("img", { name: "Only you" })
        ).toBeInTheDocument();
        expect(within(screen.getByTestId("folder-row-Sales")).queryByRole("img")).toBeNull();
        // Inside a private folder, a file that inherits it needs no glyph of its own.
        expect(within(screen.getByTestId("source-row-d2")).queryByRole("img")).toBeNull();
    });

    it("badges a subfolder or file whose access differs from its parent's", () => {
        render(<Harness />);
        expect(
            within(screen.getByTestId("folder-row-Sales/Private notes")).getByRole("img", {
                name: "Only you",
            })
        ).toBeInTheDocument();
        expect(within(screen.getByTestId("folder-row-Sales/Leads")).queryByRole("img")).toBeNull();
        expect(
            within(screen.getByTestId("source-row-d6")).getByRole("img", { name: "Shared with 2" })
        ).toBeInTheDocument();
    });

    it("says who added a file on hover, by their current name, and 'you' for your own", () => {
        render(<Harness />);
        expect(
            within(screen.getByTestId("source-row-d1")).getByTitle(
                /^Added by Bob \(Sales\) · 2h ago/
            )
        ).toBeInTheDocument();
        expect(
            within(screen.getByTestId("source-row-d4")).getByTitle(/^Added by you · 2h ago/)
        ).toBeInTheDocument();
    });

    it("drops the section split inside a folder, showing just its subtree", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByTestId("folder-menu-Mine"));
        await user.click(await screen.findByTestId("context-menu-item-open-folder"));

        expect(screen.queryByTestId("rail-section-private")).not.toBeInTheDocument();
        expect(screen.getByTestId("source-row-d2")).toBeInTheDocument();
    });
});

describe("SourceRail per-item permissions", () => {
    it("offers rename, move and delete only on folders the caller manages", async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByTestId("folder-menu-Mine"));
        expect(await screen.findByTestId("context-menu-item-rename-folder")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-delete-folder")).toBeInTheDocument();
        await user.keyboard("{Escape}");

        await user.click(screen.getByTestId("folder-menu-Sales"));
        expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-rename-folder")).not.toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-delete-folder")).not.toBeInTheDocument();
        // Sales is workspace-wide and the member can add to it.
        expect(screen.getByTestId("context-menu-item-new-subfolder")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-share-folder")).toHaveTextContent("Share…");
    });

    it("offers no new subfolder in a folder the caller can only view", async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByTestId("folder-menu-Board"));
        expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-new-subfolder")).not.toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-share-folder")).toBeInTheDocument();
    });

    it("lets only a managed folder be picked up", () => {
        render(<Harness />);
        expect(screen.getByTestId("folder-row-Mine")).toHaveAttribute("draggable", "true");
        expect(screen.getByTestId("folder-row-Sales")).toHaveAttribute("draggable", "false");
    });

    it("refuses a file dropped on a folder the caller cannot add to", () => {
        const onMoveToFolder = jest.fn();
        render(<Harness onMoveToFolder={onMoveToFolder} />);

        fireEvent.dragStart(screen.getByTestId("source-row-d4"));
        fireEvent.drop(screen.getByTestId("folder-row-Board"));
        expect(onMoveToFolder).not.toHaveBeenCalled();

        fireEvent.dragStart(screen.getByTestId("source-row-d4"));
        fireEvent.drop(screen.getByTestId("folder-row-Mine"));
        expect(onMoveToFolder).toHaveBeenCalledWith("d4", "Mine");
    });

    it("never moves a file the caller can only view", () => {
        const onMoveToFolder = jest.fn();
        render(<Harness onMoveToFolder={onMoveToFolder} />);

        fireEvent.dragStart(screen.getByTestId("source-row-d3"));
        fireEvent.drop(screen.getByTestId("folder-row-Mine"));
        expect(onMoveToFolder).not.toHaveBeenCalled();
    });

    it("files a dropped file loose — private to you — when it lands on Private", () => {
        const onMoveToFolder = jest.fn();
        render(<Harness onMoveToFolder={onMoveToFolder} />);

        fireEvent.dragStart(screen.getByTestId("source-row-d1"));
        fireEvent.dragEnter(screen.getByTestId("rail-section-private"));
        fireEvent.drop(screen.getByTestId("rail-section-private"));
        expect(onMoveToFolder).toHaveBeenCalledWith("d1", "Unfiled");
    });
});
