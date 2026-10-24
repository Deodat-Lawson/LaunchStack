/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { CreatedSources, createdSourcePlace } from "../CreatedSources";
import type { WorkspaceSource } from "../types";

/**
 * The documents an answer wrote: listed under it with where they went and
 * who can open them, and one click from being open. A document the reader
 * cannot open — someone else's chat, shared with them — is not listed.
 */

function source(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
    return {
        id: "d90",
        documentId: 90,
        title: "Scenario Simulator — Business Plan",
        type: "doc",
        size: "",
        added: "just now",
        folder: "Unfiled",
        tags: [],
        domain: "Technical",
        ...overrides,
    };
}

const CREATED = [
    { documentId: 90, title: "Scenario Simulator — Business Plan", folder: "Unfiled" },
];

describe("CreatedSources", () => {
    it("lists the created document in Private and opens it", async () => {
        const user = userEvent.setup();
        const onOpen = jest.fn();
        const plan = source();
        render(<CreatedSources created={CREATED} sources={[plan]} onOpen={onOpen} />);

        expect(screen.getByRole("region", { name: "Created documents" })).toHaveTextContent(
            "Created 1 document"
        );
        expect(screen.getByText("Scenario Simulator — Business Plan")).toBeInTheDocument();
        expect(screen.getByText("Private · Only you")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Open" }));
        expect(onOpen).toHaveBeenCalledWith(plan);
    });

    it("leaves out a document the reader cannot open", () => {
        const { container } = render(
            <CreatedSources created={CREATED} sources={[]} onOpen={jest.fn()} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("says where a filed document went and who can open it", () => {
        expect(
            createdSourcePlace(
                source({
                    folder: "Company/Plans",
                    access: {
                        audience: "workspace",
                        ownAudience: false,
                        principalCount: 0,
                        canEdit: true,
                        canManage: true,
                    },
                })
            )
        ).toBe("Company / Plans · Everyone in the workspace");
        expect(createdSourcePlace(source({ folder: "Board" }))).toBe("Board");
    });
});
