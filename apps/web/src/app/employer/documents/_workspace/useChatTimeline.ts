"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThreadMessage } from "./types";

export const messageAnchor = (msg: ThreadMessage, index: number) =>
    `chat-message-${(msg.id ?? String(index)).replace(/[^\w-]/g, "-")}`;
export const isTimelineBottom = (
    element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">
) => element.scrollHeight - element.scrollTop - element.clientHeight <= 64;
interface ReadingPosition {
    top: number;
    follow: boolean;
    anchor?: string;
    offset?: number;
}

/** Bottom-follow is an explicit reading state, rather than a side effect of every delta. */
export function useChatTimeline(thread: ThreadMessage[], draftKey: string, active: boolean) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const positions = useRef(new Map<string, ReadingPosition>());
    const currentKey = useRef(draftKey);
    const reading = useRef<ReadingPosition>({ top: 0, follow: true });
    const [following, setFollowing] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(-1);

    const capture = useCallback(() => {
        const scroll = scrollRef.current;
        if (!scroll) return;
        const top = scroll.getBoundingClientRect().top;
        const messages = Array.from(scroll.querySelectorAll<HTMLElement>("[data-chat-message]"));
        const anchor = messages.find(node => node.getBoundingClientRect().bottom > top + 8);
        reading.current = {
            top: scroll.scrollTop,
            follow: isTimelineBottom(scroll),
            anchor: anchor?.id,
            offset: anchor ? anchor.getBoundingClientRect().top - top : undefined,
        };
        positions.current.set(currentKey.current, reading.current);
        setFollowing(reading.current.follow);
        if (anchor) setCurrentIndex(Number(anchor.dataset.chatMessage));
    }, []);

    const restore = useCallback(() => {
        const scroll = scrollRef.current;
        if (!scroll) return;
        const position = reading.current;
        if (position.follow) scroll.scrollTop = scroll.scrollHeight;
        else {
            const anchor = position.anchor ? document.getElementById(position.anchor) : null;
            if (anchor && scroll.contains(anchor) && position.offset !== undefined)
                scroll.scrollTop +=
                    anchor.getBoundingClientRect().top -
                    scroll.getBoundingClientRect().top -
                    position.offset;
            else scroll.scrollTop = position.top;
        }
    }, []);

    useLayoutEffect(() => {
        if (currentKey.current !== draftKey) {
            positions.current.set(currentKey.current, reading.current);
            currentKey.current = draftKey;
            reading.current = positions.current.get(draftKey) ?? { top: 0, follow: true };
            setFollowing(reading.current.follow);
        }
        restore();
        if (reading.current.follow) setCurrentIndex(thread.length - 1);
    }, [thread, draftKey, active, restore]);

    useEffect(() => {
        const content = contentRef.current;
        if (!content || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => restore());
        observer.observe(content);
        if (scrollRef.current) observer.observe(scrollRef.current);
        return () => observer.disconnect();
    }, [restore]);

    const latest = useCallback(() => {
        reading.current = { top: scrollRef.current?.scrollHeight ?? 0, follow: true };
        setFollowing(true);
        setCurrentIndex(thread.length - 1);
        restore();
    }, [restore, thread.length]);

    const navigate = useCallback(
        (index: number) => {
            const scroll = scrollRef.current;
            const msg = thread[index];
            if (!scroll || !msg) return;
            const node = document.getElementById(messageAnchor(msg, index));
            if (!node || !scroll.contains(node)) return;
            reading.current.follow = false;
            setFollowing(false);
            // Instant navigation respects reduced motion and prevents stream deltas competing with an animation.
            scroll.scrollTop +=
                node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12;
            capture();
            setCurrentIndex(index);
        },
        [thread, capture]
    );

    return { scrollRef, contentRef, following, currentIndex, onScroll: capture, latest, navigate };
}
