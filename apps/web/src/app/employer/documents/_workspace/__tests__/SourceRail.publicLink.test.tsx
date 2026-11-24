/** @jest-environment jsdom */

import React, { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ContextMenuProvider } from "~/components/context-menu";
import { SourceRail } from "../SourceRail";
import type { ItemAccessView, WorkspaceFolder, WorkspaceSource } from "../types";

/**
 * A file anyone can open through its public link (ADR-016) says so in the
 * rail: a globe on its row, named for screen readers and on hover, beside
 * whatever says who in the workspace can see it.
 */

jest.mock("~/lib/profile/use-people", () => ({ usePeople: () => ({}) }));

const privateToMe: ItemAccessView = {
    audience: "private",
    ownAudience: true,
    principalCount: 1,
    canEdit: true,
    canManage: true,
};

function src(id: string, overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id,
        documentId: Number(id.slice(1)),
        title: `${id}.pdf`,
        type: "doc",
        size: "",
        added: "2h ago",
        folder: "Unfiled",
        tags: [],
        domain: "General",
        access: privateToMe,
        ...overrides,
    };
}

const FOLDERS: WorkspaceFolder[] = [{ id: "f-Unfiled", name: "Unfiled", color: "x" }];

function Harness({ sources }: { sources: WorkspaceSource[] }) {
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    return (
        <ContextMenuProvider>
            <SourceRail
                sources={sources}
                folders={FOLDERS}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={jest.fn()}
                onNewFolder={jest.fn()}
                onRenameFolder={jest.fn()}
                onMoveFolder={jest.fn()}
                onDeleteFolder={jest.fn()}
                onShareFolder={jest.fn()}
                onMoveToFolder={jest.fn()}
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

describe("SourceRail public link badge", () => {
    it("puts a globe on a file with a live public link, next to its audience glyph", () => {
        render(<Harness sources={[src("d1", { publicLink: true }), src("d2")]} />);

        const row = screen.getByTestId("source-row-d1");
        const globe = within(row).getByRole("img", { name: "Public link on" });
        expect(globe).toHaveAttribute("title", "Public link on");
        expect(globe).toHaveAttribute("data-public-link");
        // The audience glyph stays: who in the workspace can see it is a separate fact.
        expect(within(row).getByRole("img", { name: "Only you" })).toBeInTheDocument();

        expect(
            within(screen.getByTestId("source-row-d2")).queryByRole("img", {
                name: "Public link on",
            })
        ).toBeNull();
    });
});
