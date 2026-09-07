/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { SourceRail } from "../SourceRail";
import type { WorkspaceFolder, WorkspaceSource } from "../types";

/**
 * Folders nest. The rail draws the tree, lets a folder be picked up and
 * dropped into another, and offers the folder actions from a menu on the
 * row — including delete, which had no reachable path before.
 */

function src(id: string, folder: string, title = `${id}.pdf`): WorkspaceSource {
    return {
        id,
        documentId: Number(id.slice(1)),
        title,
        type: "doc",
        size: "",
        added: "just now",
        folder,
        tags: [],
        domain: "General",
    };
}

const SOURCES = [src("d1", "Contracts"), src("d2", "Contracts/2026"), src("d3", "Unfiled")];
const FOLDERS: WorkspaceFolder[] = ["Contracts", "Contracts/2026", "Engineering", "Unfiled"].map(
    name => ({ id: `f-${name}`, name, color: "x" })
);

interface HarnessProps {
    onNewFolder?: (parent?: string | null) => void;
    onRenameFolder?: (folder: WorkspaceFolder) => void;
    onMoveFolder?: (path: string, target: string | null) => void;
    onDeleteFolder?: (folder: WorkspaceFolder) => void;
    onMoveToFolder?: (id: string, name: string) => void;
}

function Harness(props: HarnessProps) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <SourceRail
            sources={SOURCES}
            folders={FOLDERS}
            selected={selected}
            setSelected={setSelected}
            onOpenAdd={jest.fn()}
            onNewFolder={props.onNewFolder ?? jest.fn()}
            onRenameFolder={props.onRenameFolder ?? jest.fn()}
            onMoveFolder={props.onMoveFolder ?? jest.fn()}
            onDeleteFolder={props.onDeleteFolder ?? jest.fn()}
            onMoveToFolder={props.onMoveToFolder ?? jest.fn()}
            activeFolder={activeFolder}
            setActiveFolder={setActiveFolder}
            activeTag={activeTag}
            setActiveTag={setActiveTag}
        />
    );
}

describe("SourceRail folder tree", () => {
    it("nests a subfolder under its parent and counts the whole subtree", () => {
        render(<Harness />);
        const contracts = screen.getByTestId("folder-row-Contracts");
        expect(within(contracts).getByText("2")).toBeInTheDocument();
        expect(screen.getByTestId("folder-row-Contracts/2026")).toBeInTheDocument();
        expect(
            within(screen.getByTestId("folder-row-Engineering")).getByText("0")
        ).toBeInTheDocument();
        expect(screen.getByTestId("source-row-d2")).toBeInTheDocument();
    });

    it("deletes a folder from its row menu", async () => {
        const user = userEvent.setup();
        const onDeleteFolder = jest.fn();
        render(<Harness onDeleteFolder={onDeleteFolder} />);

        await user.click(screen.getByTestId("folder-menu-Contracts/2026"));
        await user.click(await screen.findByTestId("context-menu-item-delete-folder"));

        expect(onDeleteFolder).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Contracts/2026" })
        );
    });

    it("has no rename, move, or delete for Unfiled", async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByTestId("folder-menu-Unfiled"));

        expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-delete-folder")).not.toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-rename-folder")).not.toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-select-folder")).toBeInTheDocument();
    });

    it("moves a folder by dropping it on another folder", () => {
        const onMoveFolder = jest.fn();
        render(<Harness onMoveFolder={onMoveFolder} />);

        fireEvent.dragStart(screen.getByTestId("folder-row-Contracts/2026"));
        fireEvent.dragEnter(screen.getByTestId("folder-row-Engineering"));
        fireEvent.drop(screen.getByTestId("folder-row-Engineering"));

        expect(onMoveFolder).toHaveBeenCalledWith("Contracts/2026", "Engineering");
    });

    it("refuses to drop a folder into its own subtree or into Unfiled", () => {
        const onMoveFolder = jest.fn();
        render(<Harness onMoveFolder={onMoveFolder} />);

        fireEvent.dragStart(screen.getByTestId("folder-row-Contracts"));
        fireEvent.drop(screen.getByTestId("folder-row-Contracts/2026"));
        fireEvent.dragStart(screen.getByTestId("folder-row-Contracts"));
        fireEvent.drop(screen.getByTestId("folder-row-Unfiled"));

        expect(onMoveFolder).not.toHaveBeenCalled();
    });

    it("moves a nested folder to the top level by dropping it on empty rail space", () => {
        const onMoveFolder = jest.fn();
        render(<Harness onMoveFolder={onMoveFolder} />);

        fireEvent.dragStart(screen.getByTestId("folder-row-Contracts/2026"));
        fireEvent.drop(screen.getByTestId("source-rail-list"));

        expect(onMoveFolder).toHaveBeenCalledWith("Contracts/2026", null);
    });

    it("still moves a source by dropping it on a nested folder", () => {
        const onMoveToFolder = jest.fn();
        render(<Harness onMoveToFolder={onMoveToFolder} />);

        fireEvent.dragStart(screen.getByTestId("source-row-d3"));
        fireEvent.drop(screen.getByTestId("folder-row-Contracts/2026"));

        expect(onMoveToFolder).toHaveBeenCalledWith("d3", "Contracts/2026");
    });

    it("scopes the rail to a folder and asks for subfolders inside it", async () => {
        const user = userEvent.setup();
        const onNewFolder = jest.fn();
        render(<Harness onNewFolder={onNewFolder} />);

        await user.click(screen.getByTestId("folder-menu-Contracts"));
        await user.click(await screen.findByTestId("context-menu-item-open-folder"));

        expect(screen.getByTestId("source-rail-scope")).toHaveTextContent("Contracts");
        expect(screen.queryByTestId("source-row-d3")).not.toBeInTheDocument();
        expect(screen.getByTestId("source-row-d1")).toBeInTheDocument();
        expect(screen.getByTestId("folder-row-Contracts/2026")).toBeInTheDocument();

        await user.click(screen.getByTestId("source-rail-new-folder"));
        expect(onNewFolder).toHaveBeenCalledWith("Contracts");
    });
});
