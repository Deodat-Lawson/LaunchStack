/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { RAIL_WIDTH, RailResizeHandle, clampRailWidth, useRailWidth } from "../RailResizeHandle";

/**
 * The sidebar's edge: dragged, nudged from the keyboard, reset, and
 * remembered — never narrower than its list can be read at, nor wider than
 * leaves room for the panes.
 */

/** jsdom has no PointerEvent; a MouseEvent of the same name carries what React reads. */
function pointer(type: string, clientX: number) {
    return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
}

function setup(width = 280) {
    const onPreview = jest.fn();
    const onCommit = jest.fn();
    render(<RailResizeHandle width={width} onPreview={onPreview} onCommit={onCommit} />);
    return {
        onPreview,
        onCommit,
        handle: screen.getByRole("separator", { name: "Resize the sidebar" }),
    };
}

describe("RailResizeHandle", () => {
    beforeEach(() => localStorage.clear());

    it("is a splitter a screen reader can read", () => {
        const { handle } = setup(300);
        expect(handle).toHaveAttribute("aria-orientation", "vertical");
        expect(handle).toHaveAttribute("aria-valuenow", "300");
        expect(handle).toHaveAttribute("aria-valuemin", String(RAIL_WIDTH.min));
        expect(handle).toHaveAttribute("aria-valuemax", String(RAIL_WIDTH.max));
    });

    it("follows a drag and commits where it is let go, within the limits", () => {
        const { handle, onPreview, onCommit } = setup(280);
        fireEvent(handle, pointer("pointerdown", 280));
        fireEvent(handle, pointer("pointermove", 360));
        expect(onPreview).toHaveBeenLastCalledWith(360);
        fireEvent(handle, pointer("pointermove", 2000));
        expect(onPreview).toHaveBeenLastCalledWith(RAIL_WIDTH.max);
        fireEvent(handle, pointer("pointerup", 2000));
        expect(onCommit).toHaveBeenCalledWith(RAIL_WIDTH.max);
    });

    it("moves from the keyboard, and goes back to the default", () => {
        const { handle, onCommit } = setup(280);
        fireEvent.keyDown(handle, { key: "ArrowRight" });
        expect(onCommit).toHaveBeenLastCalledWith(296);
        fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
        expect(onCommit).toHaveBeenLastCalledWith(216);
        fireEvent.keyDown(handle, { key: "End" });
        expect(onCommit).toHaveBeenLastCalledWith(RAIL_WIDTH.max);
        fireEvent.doubleClick(handle);
        expect(onCommit).toHaveBeenLastCalledWith(RAIL_WIDTH.initial);
    });

    it("clamps, and remembers the width on this device", () => {
        expect(clampRailWidth(10)).toBe(RAIL_WIDTH.min);
        expect(clampRailWidth(9999)).toBe(RAIL_WIDTH.max);

        const first = renderHook(() => useRailWidth());
        act(() => first.result.current.commit(333));
        expect(first.result.current.width).toBe(333);
        first.unmount();

        const again = renderHook(() => useRailWidth());
        expect(again.result.current.width).toBe(333);
    });
});
