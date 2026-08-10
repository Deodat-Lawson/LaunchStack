"use client";

/**
 * Positioning for the `/`, `@`, and `:` menus.
 *
 * Tiptap v3 dropped its Tippy dependency and hands `clientRect` to the caller
 * instead, so this is the shared piece that turns that rect into a floating
 * element which flips above the caret near the bottom of the viewport and
 * follows the page as it scrolls.
 */

import type { ReactRenderer } from "@tiptap/react";

export interface SuggestionPopup {
    mount: (element: HTMLElement, rect: DOMRect | null) => void;
    update: (rect: DOMRect | null) => void;
    destroy: () => void;
}

const MARGIN = 8;

export function createSuggestionPopup(): SuggestionPopup {
    let container: HTMLDivElement | null = null;
    let child: HTMLElement | null = null;
    let lastRect: DOMRect | null = null;

    const place = (rect: DOMRect | null) => {
        if (!container || !rect) return;
        lastRect = rect;

        // Measure first: the menu's own height decides whether it fits below.
        const { width, height } = container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const fitsBelow = rect.bottom + MARGIN + height <= viewportHeight;
        const top = fitsBelow
            ? rect.bottom + MARGIN
            : Math.max(MARGIN, rect.top - MARGIN - height);
        const left = Math.min(
            Math.max(MARGIN, rect.left),
            Math.max(MARGIN, viewportWidth - width - MARGIN)
        );

        container.style.top = `${Math.round(top)}px`;
        container.style.left = `${Math.round(left)}px`;
    };

    const onScrollOrResize = () => place(lastRect);

    return {
        mount(element, rect) {
            container = document.createElement("div");
            container.className = "ntn-suggestion-anchor";
            container.style.position = "fixed";
            container.style.zIndex = "3000";
            child = element;
            container.appendChild(element);
            document.body.appendChild(container);
            place(rect);
            window.addEventListener("scroll", onScrollOrResize, true);
            window.addEventListener("resize", onScrollOrResize);
        },

        update(rect) {
            place(rect);
        },

        destroy() {
            window.removeEventListener("scroll", onScrollOrResize, true);
            window.removeEventListener("resize", onScrollOrResize);
            child?.remove();
            container?.remove();
            container = null;
            child = null;
        },
    };
}

/** Keyboard contract every suggestion list implements. */
export interface SuggestionListHandle {
    onKeyDown: (event: KeyboardEvent) => boolean;
}

/** Narrow a ReactRenderer's ref to the list handle, tolerating a null ref. */
export function listHandle(
    renderer: ReactRenderer | null
): SuggestionListHandle | null {
    const ref = renderer?.ref as SuggestionListHandle | null | undefined;
    return ref ?? null;
}
