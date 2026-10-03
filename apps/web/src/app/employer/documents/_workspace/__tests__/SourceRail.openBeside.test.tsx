/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ContextMenuProvider } from "~/components/context-menu";
import { SourceRail } from "../SourceRail";
import { SOURCE_DRAG_MIME } from "../dragData";
import type { WorkspaceSource } from "../types";

/**
 * The sidebar as a way into the panes: a click opens a source, ⌘/Ctrl-click
 * opens it beside what is showing, and dragging it carries its id so a pane
 * can take the drop.
 */

const source: WorkspaceSource = {
    id: "d1",
    documentId: 12,
    title: "Series A memo",
    type: "doc",
    size: "",
    added: "just now",
    folder: "",
    tags: [],
    domain: "General",
};

function Harness(props: {
    onOpenSource: (source: WorkspaceSource) => void;
    onOpenSourceBeside: (source: WorkspaceSource) => void;
}) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <ContextMenuProvider>
            <SourceRail
                sources={[source]}
                folders={[]}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={jest.fn()}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
                {...props}
            />
        </ContextMenuProvider>
    );
}

describe("SourceRail into the panes", () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    it("opens on a click, and beside what is showing on ⌘- or Ctrl-click", () => {
        const onOpenSource = jest.fn();
        const onOpenSourceBeside = jest.fn();
        render(<Harness onOpenSource={onOpenSource} onOpenSourceBeside={onOpenSourceBeside} />);
        const title = screen.getByText("Series A memo");

        fireEvent.click(title);
        expect(onOpenSource).toHaveBeenCalledWith(source);

        fireEvent.click(title, { metaKey: true });
        fireEvent.click(title, { ctrlKey: true });
        expect(onOpenSourceBeside).toHaveBeenCalledTimes(2);
        expect(onOpenSource).toHaveBeenCalledTimes(1);
    });

    it("carries the source's id on a drag, for a pane to take", () => {
        render(<Harness onOpenSource={jest.fn()} onOpenSourceBeside={jest.fn()} />);
        const row = screen.getByTestId("source-row-d1").parentElement!;
        const setData = jest.fn();
        fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: "" } });
        expect(setData).toHaveBeenCalledWith(SOURCE_DRAG_MIME, "d1");
    });
});
