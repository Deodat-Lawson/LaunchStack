/** @jest-environment jsdom */

import { recordedContextMenuEvents, trackContextMenuEvent } from "../telemetry";

describe("context-menu telemetry", () => {
    afterEach(() => {
        delete window.__launchstackContextMenu;
        delete window.va;
    });

    it("keeps a bounded buffer of events on the window", () => {
        for (let i = 0; i < 305; i += 1) {
            trackContextMenuEvent({ type: "open", via: "pointer", kind: "source", itemCount: i });
        }
        const events = recordedContextMenuEvents();
        expect(events).toHaveLength(300);
        expect(events[0]).toMatchObject({ type: "open", itemCount: 5 });
        expect(events.at(-1)).toMatchObject({ itemCount: 304 });
    });

    it("forwards to Vercel Web Analytics only when its queue is present", () => {
        trackContextMenuEvent({
            type: "pick",
            via: "keyboard",
            kind: "chat-message",
            itemId: "copy",
        });
        const va = jest.fn();
        window.va = va;
        trackContextMenuEvent({
            type: "pick",
            via: "keyboard",
            kind: "chat-message",
            itemId: "copy",
        });
        expect(va).toHaveBeenCalledTimes(1);
        expect(va).toHaveBeenCalledWith("event", {
            name: "context_menu",
            data: { type: "pick", via: "keyboard", kind: "chat-message", item: "copy" },
        });
    });
});
