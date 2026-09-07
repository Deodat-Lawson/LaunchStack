/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { RenameSourceDialog } from "../RenameSourceDialog";
import { ConfirmActionDialog } from "../ConfirmActionDialog";
import type { WorkspaceSource } from "../types";

const source: WorkspaceSource = {
    id: "d1",
    documentId: 12,
    title: "reference_design_bundles.md",
    type: "doc",
    size: "",
    added: "",
    folder: "Unfiled",
    tags: [],
    domain: "General",
};

describe("RenameSourceDialog", () => {
    it("saves a trimmed title through onRename", async () => {
        const user = userEvent.setup();
        const onRename = jest.fn().mockResolvedValue(true);
        const onClose = jest.fn();
        render(<RenameSourceDialog open source={source} onRename={onRename} onClose={onClose} />);

        const input = screen.getByTestId("rename-source-input");
        await user.clear(input);
        await user.type(input, "New name");
        await user.click(screen.getByTestId("rename-source-save"));
        expect(onRename).toHaveBeenCalledWith(source, "New name");
        expect(onClose).toHaveBeenCalled();
    });

    it("keeps Save disabled when the title is unchanged", () => {
        render(
            <RenameSourceDialog open source={source} onRename={jest.fn()} onClose={jest.fn()} />
        );
        expect(screen.getByTestId("rename-source-save")).toBeDisabled();
    });
});

describe("ConfirmActionDialog", () => {
    it("confirms a destructive action", async () => {
        const user = userEvent.setup();
        const onConfirm = jest.fn();
        render(
            <ConfirmActionDialog
                open
                title="Delete this source?"
                body="This cannot be undone."
                confirmLabel="Delete"
                onConfirm={onConfirm}
                onClose={jest.fn()}
            />
        );
        await user.click(screen.getByTestId("confirm-action-confirm"));
        expect(onConfirm).toHaveBeenCalled();
    });
});
