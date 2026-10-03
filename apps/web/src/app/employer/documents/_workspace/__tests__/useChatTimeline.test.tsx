/** @jest-environment jsdom */
import React, { useLayoutEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { isTimelineBottom, messageAnchor, useChatTimeline } from "../useChatTimeline";
import type { ThreadMessage } from "../types";
const THREAD: ThreadMessage[] = [
    { id: "one", role: "user", text: "Question" },
    { id: "two", role: "assistant", text: "Answer", status: "streaming" },
];
function Harness({
    height = 1000,
    draftKey = "A",
    thread = THREAD,
}: {
    height?: number;
    draftKey?: string;
    thread?: ThreadMessage[];
}) {
    const timeline = useChatTimeline(thread, draftKey, true);
    useLayoutEffect(() => {
        const node = timeline.scrollRef.current!;
        Object.defineProperty(node, "scrollHeight", { configurable: true, value: height });
        Object.defineProperty(node, "clientHeight", { configurable: true, value: 200 });
    }, [height, timeline.scrollRef]);
    return (
        <>
            <div ref={timeline.scrollRef} onScroll={timeline.onScroll} data-testid="scroll">
                <div ref={timeline.contentRef}>
                    {thread.map(msg => (
                        <p
                            key={msg.id}
                            id={messageAnchor(msg, thread.indexOf(msg))}
                            data-chat-message={thread.indexOf(msg)}
                        >
                            {msg.text}
                        </p>
                    ))}
                </div>
            </div>
            <button onClick={timeline.latest}>Latest</button>
            <output>{timeline.following ? "Following" : "Reading"}</output>
        </>
    );
}
it("recognizes near-bottom follow state", () => {
    expect(isTimelineBottom({ scrollHeight: 1000, scrollTop: 740, clientHeight: 200 })).toBe(true);
    expect(isTimelineBottom({ scrollHeight: 1000, scrollTop: 200, clientHeight: 200 })).toBe(false);
});
it("preserves manual reading across streaming deltas, then follows after Latest", () => {
    const { rerender } = render(<Harness />);
    const scroll = screen.getByTestId("scroll");
    scroll.scrollTop = 100;
    fireEvent.scroll(scroll);
    expect(screen.getByText("Reading")).toBeInTheDocument();
    rerender(
        <Harness thread={[THREAD[0]!, { ...THREAD[1]!, text: "Answer growing" }]} height={1200} />
    );
    expect(scroll.scrollTop).toBe(100);
    fireEvent.click(screen.getByText("Latest"));
    expect(scroll.scrollTop).toBe(1200);
    expect(screen.getByText("Following")).toBeInTheDocument();
});
it("restores independent reading positions when switching conversations", () => {
    const { rerender } = render(<Harness />);
    const scroll = screen.getByTestId("scroll");
    act(() => {
        scroll.scrollTop = 160;
        fireEvent.scroll(scroll);
    });
    rerender(<Harness draftKey="B" />);
    act(() => {
        scroll.scrollTop = 320;
        fireEvent.scroll(scroll);
    });
    rerender(<Harness draftKey="A" />);
    expect(scroll.scrollTop).toBe(160);
    rerender(<Harness draftKey="B" />);
    expect(scroll.scrollTop).toBe(320);
});

it("anchors visible content while a disclosure above it changes height", () => {
    const oldObserver = global.ResizeObserver;
    const observers: MockObserver[] = [];
    class MockObserver {
        constructor(private readonly callback: ResizeObserverCallback) {
            observers.push(this);
        }
        observe(_target: Element) {
            /* manual trigger */
        }
        unobserve(_target: Element) {
            /* manual trigger */
        }
        disconnect() {
            /* manual trigger */
        }
        flush() {
            this.callback([], this);
        }
    }
    global.ResizeObserver = MockObserver;
    try {
        render(<Harness />);
        const scroll = screen.getByTestId("scroll");
        const anchor = document.getElementById("chat-message-one")!;
        let offset = 10;
        anchor.getBoundingClientRect = () => new DOMRect(0, offset, 100, 50);
        scroll.getBoundingClientRect = () => new DOMRect(0, 0, 100, 200);
        scroll.scrollTop = 100;
        fireEvent.scroll(scroll);
        offset = 80;
        act(() => observers[0]!.flush());
        expect(scroll.scrollTop).toBe(170);
    } finally {
        global.ResizeObserver = oldObserver;
    }
});
