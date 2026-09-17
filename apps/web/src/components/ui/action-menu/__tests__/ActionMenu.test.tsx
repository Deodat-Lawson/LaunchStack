/** @jest-environment jsdom */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ActionMenu } from "../ActionMenu";
import type { ActionMenuItem } from "../types";

function items(handlers: {
    onOpen?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
}): ActionMenuItem[] {
    return [
        { type: "label", id: "title", label: "memory.md" },
        {
            type: "item",
            id: "open",
            label: "Open",
            icon: "open",
            onSelect: handlers.onOpen ?? jest.fn(),
        },
        {
            type: "item",
            id: "rename",
            label: "Rename…",
            icon: "rename",
            onSelect: handlers.onRename ?? jest.fn(),
        },
        { type: "separator", id: "sep" },
        {
            type: "item",
            id: "delete",
            label: "Delete…",
            icon: "delete",
            danger: true,
            onSelect: handlers.onDelete ?? jest.fn(),
        },
    ];
}

describe("ActionMenu", () => {
    it("renders actions at the click point and runs the selected item", async () => {
        const user = userEvent.setup();
        const onRename = jest.fn();
        const onClose = jest.fn();
        render(<ActionMenu open x={24} y={48} items={items({ onRename })} onClose={onClose} />);

        expect(await screen.findByTestId("context-menu")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-rename")).toHaveTextContent("Rename…");
        await user.click(screen.getByTestId("context-menu-item-rename"));
        expect(onRename).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape and on backdrop mousedown", async () => {
        const user = userEvent.setup();
        const onClose = jest.fn();
        render(<ActionMenu open x={10} y={10} items={items({})} onClose={onClose} />);
        await screen.findByTestId("context-menu");
        await user.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalled();

        onClose.mockClear();
        act(() => {
            screen
                .getByTestId("context-menu-backdrop")
                .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalled();
    });

    it("does not fire a disabled item", async () => {
        const user = userEvent.setup();
        const onDelete = jest.fn();
        const onClose = jest.fn();
        render(
            <ActionMenu
                open
                x={10}
                y={10}
                items={[
                    {
                        type: "item",
                        id: "delete",
                        label: "Delete…",
                        disabled: true,
                        disabledReason: "Still indexing",
                        onSelect: onDelete,
                    },
                ]}
                onClose={onClose}
            />
        );
        await user.click(await screen.findByTestId("context-menu-item-delete"));
        expect(onDelete).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe("ActionMenu submenus", () => {
    it("opens a submenu inside a submenu on hover, and runs its pick", async () => {
        const user = userEvent.setup();
        const onPick = jest.fn();
        const onClose = jest.fn();
        render(
            <ActionMenu
                open
                x={10}
                y={10}
                onClose={onClose}
                items={[
                    {
                        type: "submenu",
                        id: "shape",
                        label: "Change shape",
                        items: [
                            {
                                type: "submenu",
                                id: "nodes",
                                label: "Nodes",
                                items: [
                                    { type: "item", id: "topic", label: "Topic", onSelect: onPick },
                                ],
                            },
                        ],
                    },
                    {
                        type: "item",
                        id: "swatched",
                        label: "Slate",
                        swatch: "oklch(0.6 0.02 280)",
                        onSelect: jest.fn(),
                    },
                ]}
            />
        );
        await user.hover(screen.getByTestId("context-menu-item-shape"));
        await user.click(screen.getByTestId("context-menu-item-shape"));
        await user.hover(await screen.findByTestId("context-menu-item-nodes"));
        await user.click(screen.getByTestId("context-menu-item-nodes"));
        await user.click(await screen.findByTestId("context-menu-item-topic"));
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
