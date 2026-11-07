/**
 * A picture of the page as the reporter sees it, without asking the browser
 * for screen-share permission: the DOM is redrawn into an image
 * (modern-screenshot, SVG foreignObject). It restores each pane's scroll
 * position — a chat scrolled to its last message is captured there, not at
 * the top — which is why it is used rather than html-to-image.
 *
 * What it cannot draw: the inside of iframes, and images from another
 * origin that refuse CORS (those come out blank). The dialog says so when a
 * capture fails, and paste/attach is always there instead.
 *
 * Elements marked `data-feedback-capture="skip"` (the dialog, its overlay,
 * the launcher, toasts) are left out, so the report shows the page and not
 * the form about the page.
 */

import { domToBlob } from "modern-screenshot";

export const CAPTURE_SKIP_ATTRIBUTE = "data-feedback-capture";

function skipped(node: Node): boolean {
    return (
        node instanceof Element &&
        (node.getAttribute(CAPTURE_SKIP_ATTRIBUTE) === "skip" ||
            // The dialog's dimmed backdrop: the picture is of the page under it.
            node.getAttribute("data-slot") === "dialog-overlay" ||
            // Sonner's toaster: "Report sent" must not be in the next report's picture.
            node.hasAttribute("data-sonner-toaster"))
    );
}

/** The visible viewport as a PNG, at up to 2× for legibility. */
export async function capturePage(): Promise<Blob> {
    const body = document.body;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const background = getComputedStyle(body).backgroundColor;
    return domToBlob(body, {
        width,
        height,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        backgroundColor: background,
        type: "image/png",
        timeout: 15_000,
        filter: node => !skipped(node),
        features: { restoreScrollPosition: true },
        // A window-level scroll (Settings is a long page) is not an element's:
        // move the copy so the viewport's part of it is what gets drawn.
        style:
            window.scrollX || window.scrollY
                ? { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` }
                : undefined,
    });
}
