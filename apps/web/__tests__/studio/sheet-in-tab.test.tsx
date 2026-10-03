/** @jest-environment jsdom */

/**
 * A sheet opened from a tool in a split covers that tool's tab, and only
 * that: the chat in the column beside it stays usable, and using it does not
 * close the sheet. Inside the tab the sheet behaves as a sheet always has.
 */

import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Sheet, SheetContainerProvider, SheetContent, SheetTitle } from "~/components/ui/sheet";

function Workspace() {
    const [tab, setTab] = useState<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(true);
    return (
        <div>
            <div data-testid="tab" ref={setTab} style={{ position: "relative" }}>
                <button type="button">Inside the tab</button>
                <SheetContainerProvider container={tab}>
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetContent>
                            <SheetTitle>Run</SheetTitle>
                        </SheetContent>
                    </Sheet>
                </SheetContainerProvider>
            </div>
            <input aria-label="Chat composer" />
            <output data-testid="state">{open ? "open" : "closed"}</output>
        </div>
    );
}

/** Radix listens for outside clicks from the tick after it opens. */
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

describe("a sheet inside a tool's tab", () => {
    it("mounts inside the tab and leaves the rest of the page usable", () => {
        render(<Workspace />);
        const sheet = screen.getByRole("dialog");
        expect(screen.getByTestId("tab")).toContainElement(sheet);
        // Modal dialogs set this on the body; a tab-scoped sheet must not.
        expect(document.body.style.pointerEvents).not.toBe("none");
        expect(screen.getByLabelText("Chat composer")).not.toHaveAttribute("aria-hidden");
    });

    it("stays open while the person uses the chat beside it", async () => {
        render(<Workspace />);
        await settle();
        const composer = screen.getByLabelText("Chat composer");
        fireEvent.pointerDown(composer);
        fireEvent.focus(composer);
        composer.focus();
        fireEvent.keyDown(composer, { key: "Escape" });
        expect(screen.getByTestId("state")).toHaveTextContent("open");
    });

    it("closes on a click elsewhere in the tab, as a sheet does", async () => {
        render(<Workspace />);
        await settle();
        const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
        expect(screen.getByTestId("tab")).toContainElement(overlay as HTMLElement);
        fireEvent.pointerDown(overlay);
        expect(screen.getByTestId("state")).toHaveTextContent("closed");
    });
});
