import type { LinkInfo, TextSelectionInfo } from "./types";

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
]);

/** True inside an input, textarea or contenteditable — where the native menu usually wins. */
export function isEditableElement(el: Element | null): boolean {
    const host = el instanceof HTMLElement ? el : (el?.parentElement ?? null);
    if (!host) return false;
    if (host.isContentEditable) return true;
    const field = host.closest("input, textarea");
    if (!field) return false;
    if (field.tagName === "TEXTAREA") return true;
    return !NON_TEXT_INPUT_TYPES.has((field as HTMLInputElement).type);
}

/** The link under the pointer, if it is a real destination. */
export function linkAt(el: Element | null): LinkInfo | null {
    const anchor = el?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    const raw = anchor.getAttribute("href") ?? "";
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return null;
    return { href: anchor.href, text: anchor.textContent?.trim() ?? "" };
}

/**
 * The text selection the pointer is inside, or null. A selection elsewhere on
 * the page does not turn every right-click into a selection menu.
 */
export function textSelectionAt(
    el: Element | null,
    point?: { x: number; y: number }
): TextSelectionInfo | null {
    if (typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);

    // Prefer a point test: the click must land inside the highlighted run,
    // not merely on an element the run passes through.
    const doc = el?.ownerDocument ?? document;
    const caretFromPoint = (
        doc as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
            caretPositionFromPoint?: (
                x: number,
                y: number
            ) => { offsetNode: Node; offset: number } | null;
        }
    );
    if (point) {
        if (typeof caretFromPoint.caretPositionFromPoint === "function") {
            const pos = caretFromPoint.caretPositionFromPoint(point.x, point.y);
            if (pos && !range.isPointInRange(pos.offsetNode, pos.offset)) return null;
        } else if (typeof caretFromPoint.caretRangeFromPoint === "function") {
            const caret = caretFromPoint.caretRangeFromPoint(point.x, point.y);
            if (caret && !range.isPointInRange(caret.startContainer, caret.startOffset)) {
                return null;
            }
        } else if (el && !range.intersectsNode(el)) {
            return null;
        }
    } else if (el && !range.intersectsNode(el)) {
        return null;
    }

    const common = range.commonAncestorContainer;
    const container = common instanceof Element ? common : common.parentElement;
    return { text, container };
}
