/**
 * Diagram colour system.
 *
 * Shape colours are document data, not chrome: they are written into the saved
 * JSON and must render identically for every viewer, so they are literal OKLCH
 * values rather than `var(--…)` tokens (a token would repaint when the *viewer*
 * flips theme, silently changing someone else's diagram). Editor chrome —
 * panels, toolbars, handles — uses the design tokens as normal.
 *
 * Every swatch ships a light `fill` plus a matching saturated `stroke` and a
 * readable `ink`, so picking one colour styles the whole shape coherently.
 */

export interface Swatch {
    id: string;
    name: string;
    fill: string;
    stroke: string;
    ink: string;
}

/** The primary picker row. Ordered by hue so the strip reads as a spectrum. */
export const SWATCHES: readonly Swatch[] = [
    {
        id: "slate",
        name: "Slate",
        fill: "oklch(0.97 0.004 280)",
        stroke: "oklch(0.62 0.02 280)",
        ink: "oklch(0.28 0.02 280)",
    },
    {
        id: "graphite",
        name: "Graphite",
        fill: "oklch(0.90 0.008 280)",
        stroke: "oklch(0.45 0.02 280)",
        ink: "oklch(0.22 0.02 280)",
    },
    {
        id: "violet",
        name: "Violet",
        fill: "oklch(0.94 0.05 285)",
        stroke: "oklch(0.54 0.24 285)",
        ink: "oklch(0.36 0.18 285)",
    },
    {
        id: "indigo",
        name: "Indigo",
        fill: "oklch(0.94 0.045 275)",
        stroke: "oklch(0.52 0.20 275)",
        ink: "oklch(0.34 0.16 275)",
    },
    {
        id: "blue",
        name: "Blue",
        fill: "oklch(0.94 0.04 245)",
        stroke: "oklch(0.55 0.17 245)",
        ink: "oklch(0.36 0.13 245)",
    },
    {
        id: "cyan",
        name: "Cyan",
        fill: "oklch(0.94 0.04 210)",
        stroke: "oklch(0.60 0.13 210)",
        ink: "oklch(0.36 0.09 210)",
    },
    {
        id: "teal",
        name: "Teal",
        fill: "oklch(0.94 0.04 185)",
        stroke: "oklch(0.58 0.12 185)",
        ink: "oklch(0.34 0.08 185)",
    },
    {
        id: "green",
        name: "Green",
        fill: "oklch(0.94 0.05 150)",
        // 0.52, not 0.58: green is the most luminous hue at a given lightness,
        // and at 0.58 a white label on a green root topic measured 4.34:1 —
        // under AA. Every other swatch's stroke already cleared it.
        stroke: "oklch(0.52 0.15 150)",
        ink: "oklch(0.34 0.11 150)",
    },
    {
        id: "lime",
        name: "Lime",
        fill: "oklch(0.95 0.06 125)",
        stroke: "oklch(0.62 0.16 125)",
        ink: "oklch(0.36 0.11 125)",
    },
    {
        id: "amber",
        name: "Amber",
        fill: "oklch(0.95 0.06 85)",
        // 0.62, not 0.70: amber against near-white paper measured 2.65:1, so
        // an amber node's outline barely separated from the board. 3:1 is the
        // WCAG floor for a UI boundary and 0.62 clears it at 3.6:1.
        stroke: "oklch(0.62 0.16 75)",
        ink: "oklch(0.40 0.12 70)",
    },
    {
        id: "orange",
        name: "Orange",
        fill: "oklch(0.94 0.06 55)",
        stroke: "oklch(0.64 0.18 45)",
        ink: "oklch(0.38 0.14 45)",
    },
    {
        id: "red",
        name: "Red",
        fill: "oklch(0.94 0.045 25)",
        stroke: "oklch(0.55 0.22 25)",
        ink: "oklch(0.38 0.17 25)",
    },
    {
        id: "pink",
        name: "Pink",
        fill: "oklch(0.94 0.045 350)",
        stroke: "oklch(0.60 0.20 350)",
        ink: "oklch(0.38 0.16 350)",
    },
    {
        id: "magenta",
        name: "Magenta",
        fill: "oklch(0.94 0.05 330)",
        stroke: "oklch(0.60 0.22 330)",
        ink: "oklch(0.38 0.17 330)",
    },
];

export const SWATCH_BY_ID: Record<string, Swatch> = Object.fromEntries(
    SWATCHES.map(s => [s.id, s])
);

/**
 * Dark counterparts, one per swatch above and in the same order.
 *
 * Not a filter over the light set — inverting lightness alone gives muddy,
 * desaturated boxes. Each tone is placed by hand against a ~0.19 backdrop:
 * the fill sits far enough above the paper to read as a surface, the stroke
 * carries the hue, and the ink clears 7:1 against its own fill so a label is
 * never the thing you have to squint at.
 */
export const DARK_SWATCHES: readonly Swatch[] = [
    {
        id: "slate",
        name: "Slate",
        fill: "oklch(0.30 0.012 280)",
        stroke: "oklch(0.62 0.02 280)",
        ink: "oklch(0.93 0.006 280)",
    },
    {
        id: "graphite",
        name: "Graphite",
        fill: "oklch(0.36 0.014 280)",
        stroke: "oklch(0.70 0.02 280)",
        ink: "oklch(0.95 0.004 280)",
    },
    {
        id: "violet",
        name: "Violet",
        fill: "oklch(0.32 0.10 285)",
        stroke: "oklch(0.72 0.19 285)",
        ink: "oklch(0.93 0.04 285)",
    },
    {
        id: "indigo",
        name: "Indigo",
        fill: "oklch(0.32 0.09 275)",
        stroke: "oklch(0.70 0.17 275)",
        ink: "oklch(0.93 0.035 275)",
    },
    {
        id: "blue",
        name: "Blue",
        fill: "oklch(0.32 0.08 245)",
        stroke: "oklch(0.72 0.14 245)",
        ink: "oklch(0.93 0.03 245)",
    },
    {
        id: "cyan",
        name: "Cyan",
        fill: "oklch(0.32 0.07 210)",
        stroke: "oklch(0.75 0.12 210)",
        ink: "oklch(0.93 0.03 210)",
    },
    {
        id: "teal",
        name: "Teal",
        fill: "oklch(0.32 0.07 185)",
        stroke: "oklch(0.74 0.11 185)",
        ink: "oklch(0.93 0.03 185)",
    },
    {
        id: "green",
        name: "Green",
        fill: "oklch(0.32 0.08 150)",
        stroke: "oklch(0.73 0.15 150)",
        ink: "oklch(0.93 0.035 150)",
    },
    {
        id: "lime",
        name: "Lime",
        fill: "oklch(0.33 0.09 125)",
        stroke: "oklch(0.78 0.16 125)",
        ink: "oklch(0.94 0.04 125)",
    },
    {
        id: "amber",
        name: "Amber",
        fill: "oklch(0.34 0.09 80)",
        stroke: "oklch(0.80 0.15 78)",
        ink: "oklch(0.94 0.045 85)",
    },
    {
        id: "orange",
        name: "Orange",
        fill: "oklch(0.33 0.10 52)",
        stroke: "oklch(0.74 0.16 50)",
        ink: "oklch(0.94 0.04 55)",
    },
    {
        id: "red",
        name: "Red",
        fill: "oklch(0.32 0.10 25)",
        stroke: "oklch(0.68 0.19 25)",
        ink: "oklch(0.93 0.04 25)",
    },
    {
        id: "pink",
        name: "Pink",
        fill: "oklch(0.33 0.10 350)",
        stroke: "oklch(0.72 0.17 350)",
        ink: "oklch(0.93 0.04 350)",
    },
    {
        id: "magenta",
        name: "Magenta",
        fill: "oklch(0.33 0.11 330)",
        stroke: "oklch(0.72 0.19 330)",
        ink: "oklch(0.93 0.045 330)",
    },
];

export const DARK_SWATCH_BY_ID: Record<string, Swatch> = Object.fromEntries(
    DARK_SWATCHES.map(s => [s.id, s])
);

/** Which half of the world a document is painted for. */
export type ThemeMode = "light" | "dark";

/** The tone a swatch takes on in a given document theme. */
export function swatchFor(id: string, mode: ThemeMode): Swatch {
    const table = mode === "dark" ? DARK_SWATCH_BY_ID : SWATCH_BY_ID;
    return table[id] ?? table.slate!;
}

/** Neutral document defaults: white fill, mid-grey stroke, near-black ink. */
export const PAPER = "oklch(1 0 0)";
export const INK = "oklch(0.22 0.015 280)";
export const INK_SOFT = "oklch(0.45 0.012 280)";
export const HAIRLINE = "oklch(0.62 0.02 280)";
export const TRANSPARENT = "none";

/** The same four, for a document painted on dark paper. */
export const PAPER_DARK = "oklch(0.19 0.018 285)";
export const INK_DARK = "oklch(0.95 0.004 280)";
export const INK_SOFT_DARK = "oklch(0.74 0.008 280)";
export const HAIRLINE_DARK = "oklch(0.52 0.02 280)";

export interface Neutrals {
    paper: string;
    ink: string;
    inkSoft: string;
    hairline: string;
}

export function neutralsFor(mode: ThemeMode): Neutrals {
    return mode === "dark"
        ? { paper: PAPER_DARK, ink: INK_DARK, inkSoft: INK_SOFT_DARK, hairline: HAIRLINE_DARK }
        : { paper: PAPER, ink: INK, inkSoft: INK_SOFT, hairline: HAIRLINE };
}

/** Sticky-note colours — saturated fills that read on a white canvas. */
export const STICKY_COLORS: readonly string[] = [
    "oklch(0.92 0.11 100)",
    "oklch(0.90 0.10 150)",
    "oklch(0.90 0.09 210)",
    "oklch(0.90 0.10 330)",
    "oklch(0.91 0.10 40)",
    "oklch(0.93 0.06 285)",
];

/**
 * Stickies on dark paper. Still the brightest thing on the board — a sticky
 * that recedes is not a sticky — but pulled down far enough that the near-black
 * ink they keep stays comfortable rather than glaring.
 */
export const STICKY_COLORS_DARK: readonly string[] = [
    "oklch(0.78 0.14 100)",
    "oklch(0.75 0.13 150)",
    "oklch(0.74 0.11 210)",
    "oklch(0.74 0.13 330)",
    "oklch(0.77 0.13 40)",
    "oklch(0.76 0.09 285)",
];

export function stickyColors(mode: ThemeMode): readonly string[] {
    return mode === "dark" ? STICKY_COLORS_DARK : STICKY_COLORS;
}

/** Ink that reads on a sticky, whichever set it came from. */
export function stickyInk(mode: ThemeMode): string {
    return mode === "dark" ? "oklch(0.20 0.02 90)" : INK;
}

/**
 * Depth-indexed accent ramp for auto-styled mindmap branches. Index 0 is the
 * root; deeper levels cycle through the rest so a wide map stays legible.
 */
export const BRANCH_RAMP: readonly string[] = [
    "violet",
    "blue",
    "teal",
    "green",
    "amber",
    "orange",
    "pink",
    "cyan",
    "lime",
    "magenta",
];

export function branchSwatch(depth: number, mode: ThemeMode = "light"): Swatch {
    if (depth <= 0) return swatchFor("violet", mode);
    const key = BRANCH_RAMP[(depth - 1) % BRANCH_RAMP.length]!;
    return swatchFor(key, mode);
}

/**
 * Relative luminance (WCAG) of a document colour, or null if unparseable.
 *
 * Documents only ever hold `oklch()` and hex, so those are the two with real
 * conversions; the OKLCH path goes through OKLab to linear sRGB, which is the
 * space luminance is defined in.
 */
export function relativeLuminance(css: string): number | null {
    const value = css.trim().toLowerCase();

    const ok = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/.exec(value);
    if (ok) {
        const rawL = Number.parseFloat(ok[1]!);
        const L = ok[1]!.endsWith("%") ? rawL / 100 : rawL;
        const C = Number.parseFloat(ok[2]!);
        const h = (Number.parseFloat(ok[3]!) * Math.PI) / 180;
        if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(h)) return null;

        const a = C * Math.cos(h);
        const b = C * Math.sin(h);
        const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
        const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
        const s2 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

        const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
        const r = clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2);
        const g = clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2);
        const bl = clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s2);
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    }

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
    if (hex) {
        const d = hex[1]!;
        const chan = (i: number) =>
            (d.length === 3
                ? Number.parseInt(d[i]!.repeat(2), 16)
                : Number.parseInt(d.slice(i * 2, i * 2 + 2), 16)) / 255;
        const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * decode(chan(0)) + 0.7152 * decode(chan(1)) + 0.0722 * decode(chan(2));
    }

    return null;
}

/** WCAG contrast ratio, 1–21. Returns 1 when either colour cannot be read. */
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    if (la === null || lb === null) return 1;
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

export const INK_ON_LIGHT = INK;
export const INK_ON_DARK = "oklch(0.99 0.002 285)";

/**
 * Whichever of the two inks is actually readable on `background`.
 *
 * Measured, not assumed. The root topic forced it: its fill is the swatch's
 * *stroke*, which on a dark board is a bright violet at 0.72 lightness —
 * near-white on that is 2.6:1 and fails AA even at the large-text threshold,
 * while near-black is 8:1. No fixed choice per mode gets both boards right,
 * and any fixed choice is wrong again the moment someone picks their own fill.
 */
export function readableInkOn(background: string): string {
    return contrastRatio(INK_ON_DARK, background) >= contrastRatio(INK_ON_LIGHT, background)
        ? INK_ON_DARK
        : INK_ON_LIGHT;
}

/**
 * Named document themes. Applying one restyles every node/edge on the page in
 * a single history step (see `applyTheme` in `commands.ts`).
 */
export interface DocTheme {
    id: string;
    name: string;
    /** Which swatch table the cycle is read from, and how the paper is lit. */
    mode: ThemeMode;
    /** Swatch ids cycled across nodes, in order. */
    cycle: string[];
    edgeStroke: string;
    background: string;
    ink: string;
}

export const THEMES: readonly DocTheme[] = [
    {
        id: "default",
        name: "Launchstack",
        mode: "light",
        cycle: ["violet", "blue", "teal", "green", "amber", "pink"],
        edgeStroke: "oklch(0.55 0.03 280)",
        background: "oklch(0.992 0.003 80)",
        ink: INK,
    },
    {
        id: "mono",
        name: "Monochrome",
        mode: "light",
        cycle: ["slate", "graphite"],
        edgeStroke: "oklch(0.45 0.01 280)",
        background: "oklch(1 0 0)",
        ink: INK,
    },
    {
        id: "ocean",
        name: "Ocean",
        mode: "light",
        cycle: ["blue", "cyan", "teal", "indigo"],
        edgeStroke: "oklch(0.52 0.08 235)",
        background: "oklch(0.985 0.008 235)",
        ink: "oklch(0.26 0.05 245)",
    },
    {
        id: "sunset",
        name: "Sunset",
        mode: "light",
        cycle: ["orange", "amber", "red", "pink", "magenta"],
        edgeStroke: "oklch(0.55 0.10 40)",
        background: "oklch(0.99 0.01 70)",
        ink: "oklch(0.28 0.06 40)",
    },
    {
        id: "forest",
        name: "Forest",
        mode: "light",
        cycle: ["green", "lime", "teal", "amber"],
        edgeStroke: "oklch(0.48 0.09 150)",
        background: "oklch(0.99 0.008 140)",
        ink: "oklch(0.26 0.05 150)",
    },

    // ── Dark ────────────────────────────────────────────────────────────
    // One per light theme, so switching a board between them is a change of
    // lighting rather than a change of identity.
    {
        id: "midnight",
        name: "Midnight",
        mode: "dark",
        cycle: ["violet", "blue", "teal", "green", "amber", "pink"],
        edgeStroke: "oklch(0.66 0.03 285)",
        background: "oklch(0.19 0.018 285)",
        ink: INK_DARK,
    },
    {
        id: "carbon",
        name: "Carbon",
        mode: "dark",
        cycle: ["slate", "graphite"],
        edgeStroke: "oklch(0.68 0.01 280)",
        background: "oklch(0.17 0.004 280)",
        ink: INK_DARK,
    },
    {
        id: "abyss",
        name: "Abyss",
        mode: "dark",
        cycle: ["blue", "cyan", "teal", "indigo"],
        edgeStroke: "oklch(0.68 0.08 235)",
        background: "oklch(0.19 0.03 240)",
        ink: "oklch(0.94 0.02 235)",
    },
    {
        id: "ember",
        name: "Ember",
        mode: "dark",
        cycle: ["orange", "amber", "red", "pink", "magenta"],
        edgeStroke: "oklch(0.70 0.10 45)",
        background: "oklch(0.19 0.025 40)",
        ink: "oklch(0.94 0.025 60)",
    },
    {
        id: "pine",
        name: "Pine",
        mode: "dark",
        cycle: ["green", "lime", "teal", "amber"],
        edgeStroke: "oklch(0.68 0.10 150)",
        background: "oklch(0.185 0.022 155)",
        ink: "oklch(0.94 0.02 150)",
    },
];

export const THEME_BY_ID: Record<string, DocTheme> = Object.fromEntries(THEMES.map(t => [t.id, t]));

/**
 * Is this colour dark enough that chrome drawn on it must be light?
 *
 * Answered from the colour itself rather than from the theme id, because the
 * background is editable: someone can set a custom paper on a light theme and
 * the selection handles still have to be visible. Parses the two notations the
 * document ever holds — `oklch()` and hex — and treats anything else as light,
 * which is the safe guess for an unrecognised value on a canvas that has
 * historically been white.
 */
export function isDarkSurface(css: string): boolean {
    const value = css.trim().toLowerCase();

    const oklch = /^oklch\(\s*([\d.]+)(%?)/.exec(value);
    if (oklch) {
        const raw = Number.parseFloat(oklch[1]!);
        if (Number.isNaN(raw)) return false;
        return (oklch[2] === "%" ? raw / 100 : raw) < 0.5;
    }

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
    if (hex) {
        const digits = hex[1]!;
        const pair = (i: number) =>
            digits.length === 3
                ? Number.parseInt(digits[i]!.repeat(2), 16)
                : Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
        // Rec. 601 luma: close enough for a light/dark decision, and it needs
        // no colour-space conversion.
        const luma = (0.299 * pair(0) + 0.587 * pair(1) + 0.114 * pair(2)) / 255;
        return luma < 0.5;
    }

    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
    if (rgb) {
        const luma =
            (0.299 * Number.parseFloat(rgb[1]!) +
                0.587 * Number.parseFloat(rgb[2]!) +
                0.114 * Number.parseFloat(rgb[3]!)) /
            255;
        return luma < 0.5;
    }

    return false;
}

/**
 * The dark board that corresponds to a light one and vice versa, so switching
 * a document between them is a change of lighting rather than of identity.
 */
const THEME_COUNTERPART: Record<string, string> = {
    default: "midnight",
    mono: "carbon",
    ocean: "abyss",
    sunset: "ember",
    forest: "pine",
    midnight: "default",
    carbon: "mono",
    abyss: "ocean",
    ember: "sunset",
    pine: "forest",
};

/** The same theme lit the other way, or the input if it has no counterpart. */
export function counterpartTheme(themeId: string): string {
    return THEME_COUNTERPART[themeId] ?? themeId;
}

/** The default board for a viewer currently in this app theme. */
export function defaultThemeFor(mode: ThemeMode): string {
    return mode === "dark" ? "midnight" : "default";
}

/** The mode a theme id names, defaulting to light for an unknown id. */
export function themeMode(themeId: string | null | undefined): ThemeMode {
    if (!themeId) return "light";
    return THEME_BY_ID[themeId]?.mode ?? "light";
}
