/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { renderWithLocale } from "~/i18n/testing/render";

import type { ChatCreatedSource } from "~/lib/chat-turns";

import { CreatedSources, createdSourcePlace } from "../CreatedSources";
import type { WorkspaceSource } from "../types";

// The picture reads the map from the server; here it only says which map it draws.
jest.mock("../../_mindmap/ui/DiagramCardPreview", () => ({
    DiagramCardPreview: ({ mindmapId }: { mindmapId: number }) => (
        <div data-testid="diagram-preview">{`preview of m${mindmapId}`}</div>
    ),
}));

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
        const filed = source({
            folder: "Company/Plans",
            access: {
                audience: "workspace",
                ownAudience: false,
                principalCount: 0,
                canEdit: true,
                canManage: true,
            },
        });
        expect(createdSourcePlace(filed)).toEqual({
            folder: "Company / Plans",
            audience: "workspace",
        });
        expect(createdSourcePlace(source({ folder: "Board" }))).toEqual({
            folder: "Board",
            audience: null,
        });
        render(<CreatedSources created={CREATED} sources={[filed]} />);
        expect(screen.getByText("Company / Plans · Everyone in the workspace")).toBeInTheDocument();
        // Without a way to open it, no Open button.
        expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    });

    it("reads in Chinese", () => {
        renderWithLocale(
            <CreatedSources created={CREATED} sources={[source()]} onOpen={jest.fn()} />,
            "zh-CN"
        );
        expect(screen.getByRole("region", { name: "已创建的文档" })).toHaveTextContent(
            "已创建 1 个文档"
        );
        expect(screen.getByText("私有 · 仅你可见")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
    });

    describe("diagrams the answer drew or changed", () => {
        const map = (overrides: Partial<WorkspaceSource> = {}) =>
            source({
                id: "m7",
                documentId: undefined,
                mindmapId: 7,
                type: "mindmap",
                title: "Refunds",
                size: "6 shapes",
                ...overrides,
            });
        const DREW: ChatCreatedSource[] = [
            { kind: "diagram", mindmapId: 7, title: "Refunds", folder: "Unfiled" },
        ];

        it("shows the diagram's picture, says it drew it, and opens it from the picture or the button", async () => {
            const user = userEvent.setup();
            const onOpen = jest.fn();
            const refunds = map();
            render(<CreatedSources created={DREW} sources={[refunds]} onOpen={onOpen} />);

            const region = screen.getByRole("region", { name: "Made in your workspace" });
            expect(region).toHaveTextContent("Drew 1 diagram");
            expect(await screen.findByTestId("diagram-preview")).toHaveTextContent("preview of m7");
            expect(screen.getByText("Diagram · Private · Only you")).toBeInTheDocument();

            await user.click(screen.getByRole("button", { name: "Open Refunds" }));
            await user.click(screen.getByRole("button", { name: "Open" }));
            expect(onOpen).toHaveBeenCalledTimes(2);
            expect(onOpen).toHaveBeenCalledWith(refunds);
        });

        it("says when it changed a diagram that was already there", () => {
            render(
                <CreatedSources
                    created={[
                        {
                            kind: "diagram",
                            mindmapId: 7,
                            title: "Refunds",
                            folder: "Unfiled",
                            edited: true,
                        },
                    ]}
                    sources={[map()]}
                />
            );
            expect(
                screen.getByRole("region", { name: "Made in your workspace" })
            ).toHaveTextContent("Changed 1 diagram");
            expect(screen.getByText("Changed · Private · Only you")).toBeInTheDocument();
        });

        it("counts documents and diagrams together, and never mistakes a map for a document", () => {
            render(
                <CreatedSources
                    created={[...CREATED, ...DREW]}
                    // The map's published copy shares no id with the created document.
                    sources={[source(), map({ documentId: 91 })]}
                    onOpen={jest.fn()}
                />
            );
            expect(
                screen.getByRole("region", { name: "Made in your workspace" })
            ).toHaveTextContent("Made or changed 2 items");
            expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
        });

        it("leaves out a diagram the reader cannot open", () => {
            const { container } = render(<CreatedSources created={DREW} sources={[source()]} />);
            expect(container).toBeEmptyDOMElement();
        });

        it("reads in Chinese", () => {
            renderWithLocale(
                <CreatedSources created={DREW} sources={[map()]} onOpen={jest.fn()} />,
                "zh-CN"
            );
            expect(screen.getByRole("region", { name: "已在工作区中创建" })).toHaveTextContent(
                "已绘制 1 个图表"
            );
        });
    });
});
