/**
 * The editor's colour palette.
 *
 * Notion offers ten text colours and ten block backgrounds, and the same names
 * appear in the text menu, the block menu, and select/status options — so they
 * live in one table. Values are expressed against the app's own tokens rather
 * than Notion's hex codes: `--ink`/`--panel` already flip with the theme, and
 * hard-coded greys would read as dirt in dark mode.
 */

export interface EditorColor {
    /** Stable id persisted in the document. */
    id: string;
    label: string;
    /** CSS colour for text usage. */
    text: string;
    /** CSS colour for background usage. */
    background: string;
    /** Swatch fill in the colour menu. */
    swatch: string;
}

/**
 * `l`/`c`/`h` are OKLCH components. Text uses a darker, more saturated form
 * than the background so both stay legible over the page in either theme.
 */
function color(
    id: string,
    label: string,
    hue: number,
    chroma: number
): EditorColor {
    return {
        id,
        label,
        text: `oklch(var(--ntn-text-l) ${chroma} ${hue})`,
        background: `oklch(var(--ntn-bg-l) ${chroma * 0.35} ${hue})`,
        swatch: `oklch(var(--ntn-swatch-l) ${chroma * 0.6} ${hue})`,
    };
}

export const EDITOR_COLORS: EditorColor[] = [
    {
        id: "default",
        label: "Default",
        text: "var(--ink)",
        background: "transparent",
        swatch: "var(--ink)",
    },
    {
        id: "gray",
        label: "Gray",
        text: "var(--ink-3)",
        background: "oklch(var(--ntn-bg-l) 0.004 280)",
        swatch: "var(--ink-3)",
    },
    color("brown", "Brown", 55, 0.09),
    color("orange", "Orange", 55, 0.16),
    color("yellow", "Yellow", 90, 0.15),
    color("green", "Green", 150, 0.14),
    color("blue", "Blue", 240, 0.15),
    color("purple", "Purple", 300, 0.16),
    color("pink", "Pink", 350, 0.14),
    color("red", "Red", 25, 0.19),
];

const BY_ID = new Map(EDITOR_COLORS.map((c) => [c.id, c]));

export function getColor(id: string | null | undefined): EditorColor {
    return BY_ID.get(id ?? "default") ?? EDITOR_COLORS[0]!;
}

/** CSS value for a text colour, or null when it is the default. */
export function textColorValue(id: string | null | undefined): string | null {
    if (!id || id === "default") return null;
    return getColor(id).text;
}

/** CSS value for a background colour, or null when it is the default. */
export function backgroundColorValue(id: string | null | undefined): string | null {
    if (!id || id === "default" || id === "default_background") return null;
    return getColor(id.replace(/_background$/, "")).background;
}

/**
 * Deterministic colour for a select/status option that was created without
 * one, so the same tag never changes colour between sessions.
 */
export function colorForName(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    const palette = EDITOR_COLORS.slice(1);
    return palette[hash % palette.length]!.id;
}
