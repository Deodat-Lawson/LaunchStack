/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ConfirmDialog } from "../confirm-dialog";

/**
 * The in-app "Are you sure?". It replaced `window.confirm`, which embedded web
 * views suppress (it returns false unseen), so these pin the contract callers
 * lean on: nothing runs until the confirming button, the pending item lives in
 * the caller's state, and the dialog can be lifted above a raised surface.
 */

/** A caller written the way the kit's doc comment asks: pending item in state. */
function Caller({ onRemove }: { onRemove: (name: string) => void }) {
    const [pending, setPending] = useState<string | null>(null);
    return (
        <>
            <button onClick={() => setPending("Alpha")}>Remove Alpha…</button>
            <ConfirmDialog
                open={pending !== null}
                onOpenChange={next => {
                    if (!next) setPending(null);
                }}
                title={`Remove “${pending ?? ""}”?`}
                description={pending ? `${pending} and every number against it go.` : undefined}
                confirmLabel="Remove"
                onConfirm={() => {
                    const target = pending;
                    setPending(null);
                    if (target) onRemove(target);
                }}
            />
        </>
    );
}

function ask() {
    const onRemove = jest.fn();
    render(<Caller onRemove={onRemove} />);
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove Alpha…"));
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    return onRemove;
}

afterEach(() => jest.restoreAllMocks());

describe("ConfirmDialog", () => {
    it("says what is about to happen, and runs nothing until confirmed", () => {
        const onRemove = ask();
        expect(screen.getByText("Remove “Alpha”?")).toBeInTheDocument();
        expect(screen.getByText("Alpha and every number against it go.")).toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it("Cancel closes it and runs nothing", () => {
        const onRemove = ask();
        fireEvent.click(screen.getByTestId("confirm-cancel"));
        expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it("Escape closes it and runs nothing", () => {
        const onRemove = ask();
        fireEvent.keyDown(screen.getByTestId("confirm-dialog"), { key: "Escape" });
        expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
        expect(onRemove).not.toHaveBeenCalled();
    });

    it("confirming runs the pending action once, with the item that was asked about", () => {
        const onRemove = ask();
        fireEvent.click(screen.getByTestId("confirm-accept"));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith("Alpha");
        expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    });

    it("closes before it runs the action, so a handler that navigates leaves no dialog behind", () => {
        const onOpenChange = jest.fn();
        const onConfirm = jest.fn();
        render(
            <ConfirmDialog
                open
                onOpenChange={onOpenChange}
                title="Delete it?"
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(screen.getByTestId("confirm-accept"));
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
            onConfirm.mock.invocationCallOrder[0]!
        );
    });

    it("a non-destructive action (Restore) gets the ordinary button, a delete the danger one", () => {
        const { rerender } = render(
            <ConfirmDialog
                open
                onOpenChange={() => undefined}
                title="Restore this version?"
                confirmLabel="Restore"
                destructive={false}
                onConfirm={() => undefined}
            />
        );
        expect(screen.getByTestId("confirm-accept")).toHaveTextContent("Restore");
        expect(screen.getByTestId("confirm-accept")).not.toHaveClass("bg-danger");

        rerender(
            <ConfirmDialog
                open
                onOpenChange={() => undefined}
                title="Delete it?"
                onConfirm={() => undefined}
            />
        );
        expect(screen.getByTestId("confirm-accept")).toHaveTextContent("Delete");
        expect(screen.getByTestId("confirm-accept")).toHaveClass("bg-danger");
    });

    it("layerClassName lifts the backdrop and the panel together", () => {
        render(
            <ConfirmDialog
                open
                onOpenChange={() => undefined}
                title="Delete it?"
                layerClassName="z-[90]"
                onConfirm={() => undefined}
            />
        );
        const panel = screen.getByTestId("confirm-dialog");
        const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
        expect(panel).toHaveClass("z-[90]");
        expect(panel).not.toHaveClass("z-50");
        expect(backdrop).toHaveClass("z-[90]");
        expect(backdrop).not.toHaveClass("z-50");
    });

    it("keeps saying what it asked while it fades out, though the caller cleared its item", () => {
        // jsdom runs no CSS animations, so Radix would unmount at once. Report
        // an exit animation for the closed panel, as a browser would, so the
        // panel stays mounted through its fade-out the way it does for real.
        const real = window.getComputedStyle.bind(window);
        jest.spyOn(window, "getComputedStyle").mockImplementation(
            (el: Element, pseudo?: string | null) => {
                const style = real(el, pseudo);
                if (!(el instanceof HTMLElement) || !el.dataset.slot?.startsWith("dialog-")) {
                    return style;
                }
                return new Proxy(style, {
                    get: (target, key) =>
                        key === "animationName"
                            ? el.dataset.state === "closed"
                                ? "exit"
                                : "enter"
                            : (Reflect.get(target, key) as unknown),
                });
            }
        );

        ask();
        fireEvent.click(screen.getByTestId("confirm-accept"));

        const panel = screen.getByTestId("confirm-dialog");
        expect(panel).toHaveAttribute("data-state", "closed");
        expect(screen.getByText("Remove “Alpha”?")).toBeInTheDocument();
        expect(screen.getByText("Alpha and every number against it go.")).toBeInTheDocument();
    });
});
