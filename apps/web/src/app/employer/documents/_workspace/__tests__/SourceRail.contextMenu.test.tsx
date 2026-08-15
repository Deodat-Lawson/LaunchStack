/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { SourceRail } from "../SourceRail";
import type { WorkspaceFolder, WorkspaceSource } from "../types";

const source: WorkspaceSource = {
  id: "d1",
  documentId: 12,
  title:
    "Claude Code (global) — projects/-Users-aurea-Pensieve-new-frontend/memory/reference_design_bundles.md",
  type: "doc",
  size: "",
  added: "just now",
  folder: "Launchstack Future Plans 2",
  tags: [],
  domain: "General",
};

const folders: WorkspaceFolder[] = [
  { id: "cat-1", name: "Launchstack Future Plans 2", color: "x" },
];

function RailHarness({
  onRenameSource = jest.fn(),
  onDeleteSource = jest.fn(),
  onOpenSource = jest.fn(),
  onOpenAdd = jest.fn(),
  onNewFolder = jest.fn(),
  onMoveToFolder = jest.fn(),
}: {
  onRenameSource?: (source: WorkspaceSource) => void;
  onDeleteSource?: (source: WorkspaceSource) => void;
  onOpenSource?: (source: WorkspaceSource) => void;
  onOpenAdd?: () => void;
  onNewFolder?: () => void;
  onMoveToFolder?: (id: string, name: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  return (
    <SourceRail
      sources={[source]}
      folders={folders}
      selected={selected}
      setSelected={setSelected}
      onOpenAdd={onOpenAdd}
      onOpenSource={onOpenSource}
      onNewFolder={onNewFolder}
      onMoveToFolder={onMoveToFolder}
      onRenameSource={onRenameSource}
      onDeleteSource={onDeleteSource}
      activeFolder={activeFolder}
      setActiveFolder={setActiveFolder}
      activeTag={activeTag}
      setActiveTag={setActiveTag}
    />
  );
}

describe("SourceRail context menu", () => {
  it("opens a file menu on right-click and exposes modify actions", async () => {
    const user = userEvent.setup();
    const onRenameSource = jest.fn();
    const onDeleteSource = jest.fn();
    const onOpenSource = jest.fn();
    render(
      <RailHarness
        onRenameSource={onRenameSource}
        onDeleteSource={onDeleteSource}
        onOpenSource={onOpenSource}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("source-row-d1"), {
      clientX: 90,
      clientY: 220,
    });

    expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("context-menu-item-open")).toBeInTheDocument();
    expect(screen.getByTestId("context-menu-item-rename")).toBeInTheDocument();
    expect(screen.getByTestId("context-menu-item-delete")).toBeInTheDocument();
    expect(screen.getByTestId("context-menu-item-move")).toBeInTheDocument();

    await user.click(screen.getByTestId("context-menu-item-rename"));
    expect(onRenameSource).toHaveBeenCalledWith(source);
    expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
  });

  it("opens a blank-rail menu when right-clicking empty list space", async () => {
    const user = userEvent.setup();
    const onOpenAdd = jest.fn();
    const onNewFolder = jest.fn();
    render(<RailHarness onOpenAdd={onOpenAdd} onNewFolder={onNewFolder} />);

    fireEvent.contextMenu(screen.getByTestId("source-rail-list"), {
      clientX: 40,
      clientY: 400,
    });

    expect(await screen.findByTestId("context-menu-item-add")).toBeInTheDocument();
    await user.click(screen.getByTestId("context-menu-item-new-folder"));
    expect(onNewFolder).toHaveBeenCalled();
  });

  it("opens the same file menu from the hover actions button", async () => {
    const user = userEvent.setup();
    const onDeleteSource = jest.fn();
    render(<RailHarness onDeleteSource={onDeleteSource} />);

    fireEvent.mouseEnter(screen.getByTestId("source-row-d1"));
    await user.click(screen.getByTestId("source-row-menu-d1"));
    await user.click(await screen.findByTestId("context-menu-item-delete"));
    expect(onDeleteSource).toHaveBeenCalledWith(source);
  });
});
