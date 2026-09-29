/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ContextMenuProvider } from "~/components/context-menu";
import { SourceRail } from "../SourceRail";
import type { ShortcutHints } from "../ShortcutHint";

/**
 * The sidebar's commands show their keys.
 *
 * They were icons in the header — search, Knowledge, add — with ⌘K and ⌘U
 * hidden in tooltips, and the complaint was simply that the shortcuts were
 * gone. These pin that each command is named, carries the member's own key,
 * and that `/` can find the search box whichever tab is showing.
 */

const HINTS: ShortcutHints = { palette: "⌘K", add: "⌘U", rail: "⌘\\", search: "/" };

function Harness({
    onOpenPalette = jest.fn(),
    onOpenAdd = jest.fn(),
    shortcuts = HINTS,
}: {
    onOpenPalette?: () => void;
    onOpenAdd?: () => void;
    shortcuts?: ShortcutHints;
}) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <ContextMenuProvider>
            <SourceRail
                sources={[]}
                folders={[]}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={onOpenAdd}
                onOpenPalette={onOpenPalette}
                onClose={jest.fn()}
                shortcuts={shortcuts}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
            />
        </ContextMenuProvider>
    );
}

describe("SourceRail commands", () => {
    it("names each command and shows its key", () => {
        render(<Harness />);
        expect(screen.getByTestId("rail-palette")).toHaveTextContent("Jump to anything");
        expect(screen.getByTestId("rail-palette")).toHaveTextContent("⌘K");
        expect(screen.getByTestId("rail-add")).toHaveTextContent("Add knowledge");
        expect(screen.getByTestId("rail-add")).toHaveTextContent("⌘U");
    });

    it("runs the command the row names", () => {
        const onOpenPalette = jest.fn();
        const onOpenAdd = jest.fn();
        render(<Harness onOpenPalette={onOpenPalette} onOpenAdd={onOpenAdd} />);
        fireEvent.click(screen.getByTestId("rail-palette"));
        fireEvent.click(screen.getByTestId("rail-add"));
        expect(onOpenPalette).toHaveBeenCalled();
        expect(onOpenAdd).toHaveBeenCalled();
    });

    it("shows a rebound key as rebound, and nothing for an unbound one", () => {
        render(<Harness shortcuts={{ palette: "⌘P", add: null }} />);
        expect(screen.getByTestId("rail-palette")).toHaveTextContent("⌘P");
        expect(screen.getByTestId("rail-add").querySelector("kbd")).toBeNull();
    });

    it("keeps the hide key on the hide control", () => {
        render(<Harness />);
        expect(screen.getByRole("button", { name: "Hide sidebar" })).toHaveAttribute(
            "title",
            "Hide sidebar  ⌘\\"
        );
    });

    it("marks the search box for `/`, and shows the key until it is used", () => {
        render(<Harness />);
        const box = document.querySelector<HTMLInputElement>("[data-rail-search]");
        expect(box).not.toBeNull();
        const field = box!.parentElement!;
        expect(field).toHaveTextContent("/");
        fireEvent.focus(box!);
        expect(field.querySelector("kbd")).toBeNull();
    });

    it("drops the header's icon row: no bare Knowledge or add icons", () => {
        render(<Harness />);
        expect(screen.queryByRole("button", { name: "Open Knowledge" })).not.toBeInTheDocument();
        expect(screen.queryByTitle(/^Add knowledge/)).not.toBeInTheDocument();
    });
});
