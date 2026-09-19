/** @jest-environment jsdom */

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { StudioTabs, reduceTabs } from "../StudioTabs";
import type { StudioFeature } from "../types";

/**
 * Tabs exist so that switching apps costs you nothing: the pane you leave
 * keeps its draft, its scroll and its undo history. Two things have to hold
 * for that, and both are tested here — every open pane stays mounted, and the
 * order the strip shows is the order the reducer holds.
 *
 * The reorder tests are the sharp ones. The strip renders a *filtered* list
 * (an app you may not open is absent) while the reducer owns the unfiltered
 * one, so a reorder expressed as a position in the rendered list would address
 * the wrong slot. It is expressed as "put this one in front of that one".
 */

const icon = (label: string) => {
    const Icon = () => <span data-testid={`icon-${label}`} />;
    Icon.displayName = `Icon${label}`;
    return Icon;
};

const feature = (id: string, label = id): StudioFeature => ({
    id,
    label,
    Icon: icon(id),
    desc: `${label} description`,
});

const FEATURES = [
    feature("chat", "Chat"),
    feature("knowledge", "Knowledge"),
    feature("draft", "Drafts"),
];

function order(state: { ids: string[] }) {
    return state.ids.join(",");
}

/** This testing-library build has no `fireEvent.auxClick`. */
function middleClick(element: Element, button: number) {
    fireEvent(element, new MouseEvent("auxclick", { button, bubbles: true, cancelable: true }));
}

describe("reduceTabs", () => {
    const three = { ids: ["a", "b", "c"], activeId: "b" };

    it("appends and focuses an app that is not open", () => {
        expect(reduceTabs(three, { type: "open", id: "d" })).toEqual({
            ids: ["a", "b", "c", "d"],
            activeId: "d",
        });
    });

    it("focuses an already-open app without opening it twice", () => {
        expect(reduceTabs(three, { type: "open", id: "a" })).toEqual({
            ids: ["a", "b", "c"],
            activeId: "a",
        });
    });

    it("moves to the tab on the right when the active one closes", () => {
        expect(reduceTabs(three, { type: "close", id: "b" })).toEqual({
            ids: ["a", "c"],
            activeId: "c",
        });
    });

    it("falls back to the new last tab when the active one was last", () => {
        expect(reduceTabs({ ids: ["a", "b"], activeId: "b" }, { type: "close", id: "b" })).toEqual({
            ids: ["a"],
            activeId: "a",
        });
    });

    it("leaves the active tab alone when another one closes", () => {
        expect(reduceTabs(three, { type: "close", id: "c" }).activeId).toBe("b");
    });

    it("leaves an empty workspace when the last tab closes", () => {
        expect(reduceTabs({ ids: ["a"], activeId: "a" }, { type: "close", id: "a" })).toEqual({
            ids: [],
            activeId: "",
        });
    });

    it("ignores a close for a tab that is not open, without re-rendering", () => {
        expect(reduceTabs(three, { type: "close", id: "zz" })).toBe(three);
    });

    it("moves a tab in front of the one named", () => {
        expect(order(reduceTabs(three, { type: "move", id: "c", beforeId: "a" }))).toBe("c,a,b");
        expect(order(reduceTabs(three, { type: "move", id: "a", beforeId: "c" }))).toBe("b,a,c");
    });

    it("moves a tab to the end when no neighbour is named", () => {
        expect(order(reduceTabs(three, { type: "move", id: "a", beforeId: null }))).toBe("b,c,a");
    });

    it("never changes which tab is active when one moves", () => {
        expect(reduceTabs(three, { type: "move", id: "a", beforeId: null }).activeId).toBe("b");
    });

    it("ignores a move that would change nothing", () => {
        expect(reduceTabs(three, { type: "move", id: "a", beforeId: "b" })).toBe(three);
        expect(reduceTabs(three, { type: "move", id: "a", beforeId: "a" })).toBe(three);
    });

    it("lands correctly when the strip is showing fewer tabs than are open", () => {
        // `b` is open but hidden from this person, so the strip shows [a, c]
        // and asks for "a in front of c". A position-based move would have
        // put `a` where `b` is.
        const gated = { ids: ["a", "b", "c"], activeId: "a" };
        expect(order(reduceTabs(gated, { type: "move", id: "a", beforeId: null }))).toBe("b,c,a");
        expect(order(reduceTabs(gated, { type: "move", id: "c", beforeId: "a" }))).toBe("c,a,b");
    });
});

describe("StudioTabs", () => {
    beforeAll(() => {
        // jsdom implements neither.
        Element.prototype.scrollIntoView = jest.fn();
    });

    function renderStrip(overrides: Partial<React.ComponentProps<typeof StudioTabs>> = {}) {
        const props = {
            onSelect: jest.fn(),
            onClose: jest.fn(),
            onMove: jest.fn(),
            onOpenStudio: jest.fn(),
        };
        render(
            <StudioTabs features={FEATURES} activeId="chat" {...props} {...overrides}>
                {(id: string) => <div data-testid={`pane-${id}`}>{id} pane</div>}
            </StudioTabs>
        );
        return { props };
    }

    it("shows one tab per open app, with only one selected", () => {
        renderStrip();
        expect(screen.getAllByRole("tab")).toHaveLength(3);
        expect(screen.getByRole("tab", { name: /Chat/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: /Drafts/ })).toHaveAttribute(
            "aria-selected",
            "false"
        );
    });

    it("keeps every open pane mounted and hides the ones off screen", () => {
        renderStrip();
        expect(screen.getByTestId("pane-chat")).toBeInTheDocument();
        // Mounted, which is the whole point, but not on screen.
        const hidden = screen.getByTestId("pane-draft").closest('[role="tabpanel"]');
        expect(hidden).toBeInTheDocument();
        expect(hidden).toHaveAttribute("hidden");
        expect(hidden).toHaveAttribute("data-state", "inactive");
    });

    it("keeps what you typed in a pane you switch away from", () => {
        let mounts = 0;
        function Draft() {
            const [value, setValue] = useState("");
            React.useEffect(() => {
                mounts += 1;
            }, []);
            return (
                <input
                    aria-label="draft"
                    value={value}
                    onChange={event => setValue(event.target.value)}
                />
            );
        }
        function Host() {
            const [activeId, setActiveId] = useState("draft");
            return (
                <StudioTabs
                    features={FEATURES}
                    activeId={activeId}
                    onSelect={setActiveId}
                    onClose={jest.fn()}
                    onMove={jest.fn()}
                    onOpenStudio={jest.fn()}
                >
                    {id => (id === "draft" ? <Draft /> : <div>{id}</div>)}
                </StudioTabs>
            );
        }
        render(<Host />);
        fireEvent.change(screen.getByLabelText("draft"), { target: { value: "half a sentence" } });
        fireEvent.click(screen.getByRole("tab", { name: /Chat/ }));
        fireEvent.click(screen.getByRole("tab", { name: /Drafts/ }));
        expect(screen.getByLabelText("draft")).toHaveValue("half a sentence");
        expect(mounts).toBe(1);
    });

    it("reports a tab click as a selection", () => {
        const { props } = renderStrip();
        // Radix selects a tab on mousedown, which is the half of a click that
        // matters here; fireEvent.click alone never reaches its handler.
        fireEvent.mouseDown(screen.getByRole("tab", { name: /Knowledge/ }), { button: 0 });
        expect(props.onSelect).toHaveBeenCalledWith("knowledge");
    });

    it("closes from the X and from a middle click, but not a left click on the strip", () => {
        const { props } = renderStrip();
        fireEvent.click(screen.getByRole("button", { name: "Close Knowledge tab" }));
        expect(props.onClose).toHaveBeenCalledWith("knowledge");

        middleClick(screen.getByRole("tab", { name: /Drafts/ }), 1);
        expect(props.onClose).toHaveBeenCalledWith("draft");

        props.onClose.mockClear();
        middleClick(screen.getByRole("tab", { name: /Drafts/ }), 0);
        expect(props.onClose).not.toHaveBeenCalled();
    });

    it("closes on Delete and claims the key, so nothing behind the tab also acts on it", () => {
        const { props } = renderStrip();
        const tab = screen.getByRole("tab", { name: /Drafts/ });
        const handled = fireEvent.keyDown(tab, { key: "Delete" });
        expect(props.onClose).toHaveBeenCalledWith("draft");
        // fireEvent returns false once a handler has called preventDefault.
        expect(handled).toBe(false);
    });

    it("also closes on Backspace, which is what the Delete key sends on a Mac laptop", () => {
        const { props } = renderStrip();
        fireEvent.keyDown(screen.getByRole("tab", { name: /Drafts/ }), { key: "Backspace" });
        expect(props.onClose).toHaveBeenCalledWith("draft");
    });

    it("reorders with Alt+Arrow, naming the neighbour to land in front of", () => {
        const { props } = renderStrip();
        const knowledge = screen.getByRole("tab", { name: /Knowledge/ });

        fireEvent.keyDown(knowledge, { key: "ArrowLeft", altKey: true });
        expect(props.onMove).toHaveBeenCalledWith("knowledge", "chat");

        props.onMove.mockClear();
        fireEvent.keyDown(knowledge, { key: "ArrowRight", altKey: true });
        // Past Drafts, which is last, so: to the end.
        expect(props.onMove).toHaveBeenCalledWith("knowledge", null);
    });

    it("does not move the first tab further left, or the last further right", () => {
        const { props } = renderStrip();
        fireEvent.keyDown(screen.getByRole("tab", { name: /Chat/ }), {
            key: "ArrowLeft",
            altKey: true,
        });
        fireEvent.keyDown(screen.getByRole("tab", { name: /Drafts/ }), {
            key: "ArrowRight",
            altKey: true,
        });
        expect(props.onMove).not.toHaveBeenCalled();
    });

    it("says where a tab landed, for anyone not watching the strip", () => {
        renderStrip();
        fireEvent.keyDown(screen.getByRole("tab", { name: /Knowledge/ }), {
            key: "ArrowLeft",
            altKey: true,
        });
        expect(screen.getByRole("status")).toHaveTextContent("Knowledge moved to position 1 of 3");
    });

    it("counts the tabs for a screen reader", () => {
        renderStrip();
        const tabs = screen.getAllByRole("tab");
        expect(tabs[1]).toHaveAttribute("aria-posinset", "2");
        expect(tabs[1]).toHaveAttribute("aria-setsize", "3");
    });

    it("keeps the close buttons out of the tab order", () => {
        renderStrip();
        expect(screen.getByRole("button", { name: "Close Chat tab" })).toHaveAttribute(
            "tabindex",
            "-1"
        );
    });

    it("offers a way back into Studio when nothing is open", () => {
        const { props } = renderStrip({ features: [], activeId: "" });
        expect(screen.queryAllByRole("tab")).toHaveLength(0);
        expect(screen.getByText("Your workspace, ready when you are")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Open Studio" }));
        expect(props.onOpenStudio).toHaveBeenCalled();
    });

    it("tells each pane whether it is the one on screen", () => {
        const seen: Record<string, boolean> = {};
        render(
            <StudioTabs
                features={FEATURES}
                activeId="chat"
                onSelect={jest.fn()}
                onClose={jest.fn()}
                onMove={jest.fn()}
                onOpenStudio={jest.fn()}
            >
                {(id, active) => {
                    seen[id] = active;
                    return <div>{id}</div>;
                }}
            </StudioTabs>
        );
        expect(seen).toEqual({ chat: true, knowledge: false, draft: false });
    });
});
