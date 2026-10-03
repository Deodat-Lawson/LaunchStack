/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ContextMenuProvider, useActionMenu, useContextTarget, useRegisterActions } from "..";
import {
    resetActionsForTests,
    resetTargetsForTests,
    type ContextMenuEvent,
} from "~/lib/context-menu";

function Row({ onOpen, inherit }: { onOpen?: () => void; inherit?: boolean }) {
    const ctx = useContextTarget({
        kind: "row",
        id: "r1",
        label: "Row actions",
        inherit,
        items: () => [
            { type: "item", id: "row.open", label: "Open", onSelect: onOpen ?? (() => undefined) },
        ],
    });
    return (
        <div data-testid="row" tabIndex={0} {...ctx}>
            <span data-testid="row-text">a row</span>
            <a data-testid="row-link" href="https://example.com/doc">
                link
            </a>
        </div>
    );
}

function Pane({ children, inherit }: { children: React.ReactNode; inherit?: boolean }) {
    const ctx = useContextTarget({
        kind: "pane",
        inherit,
        items: () => [{ type: "item", id: "pane.new", label: "New", onSelect: () => undefined }],
    });
    return (
        <div data-testid="pane" {...ctx}>
            {children}
        </div>
    );
}

function DotsButton() {
    const menu = useActionMenu();
    return (
        <button
            type="button"
            data-testid="dots"
            onClick={() =>
                menu.open({
                    x: 10,
                    y: 10,
                    items: [
                        {
                            type: "item",
                            id: "dots.hello",
                            label: "Hello",
                            onSelect: () => undefined,
                        },
                    ],
                })
            }
        >
            ⋯
        </button>
    );
}

function Scoped() {
    useRegisterActions([
        {
            id: "row.star",
            label: "Star",
            appliesTo: t => t.kind === "row",
            run: () => undefined,
        },
    ]);
    return null;
}

describe("ContextMenuProvider", () => {
    beforeEach(() => {
        resetActionsForTests();
        resetTargetsForTests();
    });

    it("opens the declared target's menu on right-click and runs the pick", async () => {
        const user = userEvent.setup();
        const onOpen = jest.fn();
        render(
            <ContextMenuProvider>
                <Row onOpen={onOpen} />
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("row-text"), { clientX: 40, clientY: 50 });
        const menu = await screen.findByTestId("context-menu");
        expect(menu).toHaveAttribute("aria-label", "Row actions");
        await user.click(screen.getByTestId("context-menu-item-row.open"));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
    });

    it("leaves Shift+right-click to the browser", () => {
        render(
            <ContextMenuProvider>
                <Row />
            </ContextMenuProvider>
        );
        const event = fireEvent.contextMenu(screen.getByTestId("row"), { shiftKey: true });
        expect(event).toBe(true); // not prevented
        expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
    });

    it("leaves inputs and textareas to the browser unless a target opts in", () => {
        function Composer({ editable }: { editable: boolean }) {
            const ctx = useContextTarget({
                kind: "composer",
                editable,
                items: () => [
                    { type: "item", id: "paste", label: "Paste", onSelect: () => undefined },
                ],
            });
            return (
                <div {...ctx}>
                    <textarea data-testid="ta" />
                </div>
            );
        }
        const { unmount } = render(
            <ContextMenuProvider>
                <Composer editable={false} />
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("ta"));
        expect(screen.queryByTestId("context-menu")).not.toBeInTheDocument();
        unmount();
        resetTargetsForTests();

        render(
            <ContextMenuProvider>
                <Composer editable />
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("ta"));
        expect(screen.getByTestId("context-menu-item-paste")).toBeInTheDocument();
    });

    it("opens from the keyboard at the focused target", () => {
        render(
            <ContextMenuProvider>
                <Row />
            </ContextMenuProvider>
        );
        screen.getByTestId("row").focus();
        fireEvent.keyDown(document.activeElement!, { key: "F10", shiftKey: true });
        expect(screen.getByTestId("context-menu-item-row.open")).toBeInTheDocument();
    });

    it("merges registered actions into the target's group", () => {
        render(
            <ContextMenuProvider>
                <Scoped />
                <Row />
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("row"));
        expect(screen.getByTestId("context-menu-item-row.open")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-row.star")).toBeInTheDocument();
    });

    it("shows a nested target's menu alone, or with its inheriting ancestor", () => {
        const { unmount } = render(
            <ContextMenuProvider>
                <Pane>
                    <Row />
                </Pane>
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("row"));
        expect(screen.getByTestId("context-menu-item-row.open")).toBeInTheDocument();
        expect(screen.queryByTestId("context-menu-item-pane.new")).not.toBeInTheDocument();
        unmount();
        resetTargetsForTests();

        render(
            <ContextMenuProvider>
                <Pane inherit>
                    <Row />
                </Pane>
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("row"));
        expect(screen.getByTestId("context-menu-item-row.open")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-pane.new")).toBeInTheDocument();
    });

    it("adds link actions on top of the target when the click lands on an anchor", () => {
        render(
            <ContextMenuProvider>
                <Row />
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("row-link"));
        expect(screen.getByTestId("context-menu-item-link.open-new-tab")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-link.copy")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-row.open")).toBeInTheDocument();
    });

    it("offers the selection when the click lands inside highlighted text", () => {
        render(
            <ContextMenuProvider>
                <Row />
            </ContextMenuProvider>
        );
        const text = screen.getByTestId("row-text");
        const range = document.createRange();
        range.selectNodeContents(text);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        fireEvent.contextMenu(text);
        expect(screen.getByTestId("context-menu-item-selection.copy")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-row.open")).toBeInTheDocument();
        selection.removeAllRanges();
    });

    it("falls back to the app menu on bare page chrome", () => {
        render(
            <ContextMenuProvider>
                <div data-testid="chrome">nothing declared here</div>
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("chrome"));
        expect(screen.getByTestId("context-menu-item-app.theme")).toBeInTheDocument();
        expect(screen.getByTestId("context-menu-item-app.copy-page-link")).toBeInTheDocument();
    });

    it("opens imperatively for a ⋯ button and reports events", async () => {
        const user = userEvent.setup();
        const events: ContextMenuEvent[] = [];
        render(
            <ContextMenuProvider onEvent={e => events.push(e)}>
                <DotsButton />
            </ContextMenuProvider>
        );
        await user.click(screen.getByTestId("dots"));
        await user.click(await screen.findByTestId("context-menu-item-dots.hello"));
        expect(events).toEqual([
            { type: "open", via: "button", kind: "custom", itemCount: 1 },
            { type: "pick", via: "button", kind: "custom", itemId: "dots.hello" },
        ]);
    });

    it("reports a dismiss when the menu closes without a pick", async () => {
        const user = userEvent.setup();
        const events: ContextMenuEvent[] = [];
        render(
            <ContextMenuProvider onEvent={e => events.push(e)}>
                <Row />
            </ContextMenuProvider>
        );
        fireEvent.contextMenu(screen.getByTestId("row"));
        await screen.findByTestId("context-menu");
        await act(async () => {
            await user.keyboard("{Escape}");
        });
        expect(events.map(e => e.type)).toEqual(["open", "dismiss"]);
    });
});
