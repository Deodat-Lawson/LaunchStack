/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { AddSourceModal } from "../AddSourceModal";

/**
 * "Add a source" → Folder. The picked folder is created inside the folder the
 * destination bar names (not beside it at the top level), keeps its
 * subfolders, and the bar shows the new folder and who will see it before
 * anything is uploaded.
 */

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mockUpload = jest.fn();
const mockRegister = jest.fn();
jest.mock("../sourceUpload", () => ({
    uploadFileToStorage: (file: File) => mockUpload(file),
    registerDocument: (params: unknown) => mockRegister(params),
}));

beforeAll(() => {
    global.fetch = jest.fn((url: string) =>
        Promise.resolve({
            ok: url === "/api/connectors/google",
            status: url === "/api/connectors/google" ? 200 : 404,
            json: () => Promise.resolve({ enabled: false, connected: false }),
            text: () => Promise.resolve(JSON.stringify({ enabled: false, connected: false })),
        })
    ) as unknown as typeof fetch;
});

beforeEach(() => {
    mockUpload.mockReset().mockResolvedValue({ url: "https://files/x", provider: "s3" });
    mockRegister.mockReset().mockResolvedValue(undefined);
});

/** A file as a folder picker yields it: with the path under the picked folder. */
function picked(relativePath: string): File {
    const file = new File(["x"], relativePath.split("/").pop()!, { type: "text/plain" });
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    return file;
}

const shared = {
    audience: "shared" as const,
    ownAudience: true,
    principalCount: 3,
    canEdit: true,
    canManage: false,
};

function mount(defaultCategory: string) {
    const onUploaded = jest.fn();
    const { container } = render(
        <AddSourceModal
            open
            onClose={jest.fn()}
            userId="user_1"
            initialTab="folder"
            defaultCategory={defaultCategory}
            folders={["Q4 planning", "Unfiled"]}
            folderAccess={{ "Q4 planning": shared }}
            onUploaded={onUploaded}
        />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    return { input, onUploaded };
}

describe("uploading a folder", () => {
    it("nests it inside the destination, keeps subfolders, and says so first", async () => {
        const user = userEvent.setup();
        const { input, onUploaded } = mount("Q4 planning");

        fireEvent.change(input, {
            target: {
                files: [
                    picked("Q3 data/summary.pdf"),
                    picked("Q3 data/raw/a.csv"),
                    picked("Q3 data/.DS_Store"),
                ],
            },
        });

        // The bar: "Q4 planning › Q3 data  New folder", following Q4 planning.
        const bar = screen.getByTestId("add-destination");
        expect(bar).toHaveTextContent("Q3 data");
        expect(bar).toHaveTextContent("New folder");
        expect(screen.getByTestId("add-source-audience")).toHaveTextContent(
            "Q3 data is a new folder inside Q4 planning, so it follows Q4 planning's sharing."
        );
        expect(screen.getByText("2 files into 2 folders")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Add 2 files to Q3 data" }));

        await waitFor(() => expect(onUploaded).toHaveBeenCalled());
        expect(mockRegister.mock.calls.map(([p]) => (p as { category: string }).category)).toEqual([
            "Q4 planning/Q3 data",
            "Q4 planning/Q3 data/raw",
        ]);
    });

    it("puts it at the top level, private to you, when there is no destination folder", async () => {
        const { input } = mount("Unfiled");
        fireEvent.change(input, { target: { files: [picked("Q3 data/a.pdf")] } });
        expect(screen.getByTestId("add-source-audience")).toHaveTextContent(
            "Q3 data is a new folder. New folders start private to you."
        );
    });

    it("renames the new folder from the name field, and the bar follows", async () => {
        const user = userEvent.setup();
        const { input } = mount("Q4 planning");
        fireEvent.change(input, { target: { files: [picked("Q3 data/a.pdf")] } });

        const name = screen.getByRole("textbox", { name: "Folder name" });
        await user.clear(name);
        await user.type(name, "Quarter three");
        expect(screen.getByTestId("add-destination")).toHaveTextContent("Quarter three");

        await user.click(screen.getByRole("button", { name: "Add 1 file to Quarter three" }));
        await waitFor(() => expect(mockRegister).toHaveBeenCalled());
        expect((mockRegister.mock.calls[0]![0] as { category: string }).category).toBe(
            "Q4 planning/Quarter three"
        );
    });

    it("joins an existing folder of the same name instead of calling it new", () => {
        const { input } = mount("Unfiled");
        fireEvent.change(input, { target: { files: [picked("Q4 planning/a.pdf")] } });
        expect(screen.getByTestId("add-destination")).not.toHaveTextContent("New folder");
        expect(screen.getByTestId("add-source-audience")).toHaveTextContent("Specific people");
    });
});
