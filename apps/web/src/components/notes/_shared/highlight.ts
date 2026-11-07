/**
 * A highlight is a note with no words of its own: a passage marked in a
 * colour. It is stored as a note — tagged `highlight`, its colour on the
 * anchor's `primary` — so it gets everything a note has for free: it is the
 * author's own (ADR-014), it is listed and deletable in the Notes panel, and
 * it follows the passage to a new version through anchor rehydration.
 *
 * The colour is stored as a name, not a value: the page is paper in both
 * themes, and the names map to the `--paper-hl-*` tokens when drawn.
 */

export const HIGHLIGHT_TAG = "highlight";

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

/** The fill each colour paints with. */
export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
    yellow: "var(--paper-hl-yellow)",
    green: "var(--paper-hl-green)",
    blue: "var(--paper-hl-blue)",
    pink: "var(--paper-hl-pink)",
};

export function isHighlightColor(value: unknown): value is HighlightColor {
    return typeof value === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

/**
 * The colour a note is highlighted in, or null when it is an ordinary note.
 * A highlight whose colour was lost (an old client's edit) reads as yellow.
 */
export function highlightColorOf(note: {
    tags?: string[] | null;
    anchor?: unknown;
}): HighlightColor | null {
    if (!note.tags?.includes(HIGHLIGHT_TAG)) return null;
    const color = (note.anchor as { primary?: { color?: unknown } } | null)?.primary?.color;
    return isHighlightColor(color) ? color : DEFAULT_HIGHLIGHT_COLOR;
}
