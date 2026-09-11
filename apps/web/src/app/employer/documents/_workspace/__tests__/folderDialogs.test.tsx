/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { DeleteFolderDialog } from "../DeleteFolderDialog";
import { FolderDialog } from "../FolderDialog";

const EXISTING = ["Contracts", "Contracts/2026", "HR", "Unfiled"];

describe("FolderDialog", () => {
    it("creates a subfolder inside the requested parent", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn().mockResolvedValue(null);
        const onClose = jest.fn();
        render(
            <FolderDialog
                request={{ mode: "create", parentPath: "Contracts" }}
                existingPaths={EXISTING}
                onSubmit={onSubmit}
                onClose={onClose}
            />
        );

        expect(screen.getByText("New subfolder")).toBeInTheDocument();
        await user.type(screen.getByTestId("folder-dialog-input"), " 2027 ");
        await user.click(screen.getByTestId("folder-dialog-submit"));

        expect(onSubmit).toHaveBeenCalledWith("Contracts/2027");
        expect(onClose).toHaveBeenCalled();
    });

    it("refuses a name that already exists in that place, or contains a slash", async () => {
        const user = userEvent.setup();
        render(
            <FolderDialog
                request={{ mode: "create", parentPath: "Contracts" }}
                existingPaths={EXISTING}
                onSubmit={jest.fn()}
                onClose={jest.fn()}
            />
        );
        const input = screen.getByTestId("folder-dialog-input");

        await user.type(input, "2026");
        expect(screen.getByRole("alert")).toHaveTextContent("already exists");
        expect(screen.getByTestId("folder-dialog-submit")).toBeDisabled();

        await user.clear(input);
        await user.type(input, "a/b");
        expect(screen.getByRole("alert")).toHaveTextContent("can't contain");
    });

    it("renames in place, keeping the parent", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn().mockResolvedValue(null);
        render(
            <FolderDialog
                request={{ mode: "rename", path: "Contracts/2026" }}
                existingPaths={EXISTING}
                onSubmit={onSubmit}
                onClose={jest.fn()}
            />
        );
        const input = screen.getByTestId("folder-dialog-input");
        expect(input).toHaveValue("2026");
        expect(screen.getByTestId("folder-dialog-submit")).toBeDisabled();

        await user.clear(input);
        await user.type(input, "Archive");
        await user.click(screen.getByTestId("folder-dialog-submit"));

        expect(onSubmit).toHaveBeenCalledWith("Contracts/Archive");
    });

    it("shows the server's reason when the change is refused", async () => {
        const user = userEvent.setup();
        const onClose = jest.fn();
        render(
            <FolderDialog
                request={{ mode: "create", parentPath: null }}
                existingPaths={EXISTING}
                onSubmit={jest.fn().mockResolvedValue("Folders can be nested at most 8 deep.")}
                onClose={onClose}
            />
        );

        await user.type(screen.getByTestId("folder-dialog-input"), "Deep");
        await user.click(screen.getByTestId("folder-dialog-submit"));

        expect(await screen.findByRole("alert")).toHaveTextContent("at most 8 deep");
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe("DeleteFolderDialog", () => {
    it("says what moves where, and confirms with the path", async () => {
        const user = userEvent.setup();
        const onConfirm = jest.fn().mockResolvedValue(null);
        const onClose = jest.fn();
        render(
            <DeleteFolderDialog
                path="Contracts/2026"
                documentCount={3}
                subfolderCount={1}
                onConfirm={onConfirm}
                onClose={onClose}
            />
        );

        expect(screen.getByText(/3 sources inside will move to Contracts\./)).toBeInTheDocument();
        expect(screen.getByText(/1 subfolder will be removed too\./)).toBeInTheDocument();
        await user.click(screen.getByTestId("delete-folder-confirm"));

        expect(onConfirm).toHaveBeenCalledWith("Contracts/2026");
        expect(onClose).toHaveBeenCalled();
    });

    it("sends a top-level folder's sources to Unfiled", () => {
        render(
            <DeleteFolderDialog
                path="HR"
                documentCount={1}
                subfolderCount={0}
                onConfirm={jest.fn()}
                onClose={jest.fn()}
            />
        );
        expect(screen.getByText(/1 source inside will move to Unfiled\./)).toBeInTheDocument();
    });
});
