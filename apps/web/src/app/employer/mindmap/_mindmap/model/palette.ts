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
        stroke: "oklch(0.58 0.16 150)",
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
        stroke: "oklch(0.70 0.16 75)",
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

/** Neutral document defaults: white fill, mid-grey stroke, near-black ink. */
export const PAPER = "oklch(1 0 0)";
export const INK = "oklch(0.22 0.015 280)";
export const INK_SOFT = "oklch(0.45 0.012 280)";
export const HAIRLINE = "oklch(0.62 0.02 280)";
export const TRANSPARENT = "none";

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

export function branchSwatch(depth: number): Swatch {
    if (depth <= 0) return SWATCH_BY_ID.violet!;
    const key = BRANCH_RAMP[(depth - 1) % BRANCH_RAMP.length]!;
    return SWATCH_BY_ID[key]!;
}

/**
 * Named document themes. Applying one restyles every node/edge on the page in
 * a single history step (see `applyTheme` in `commands.ts`).
 */
export interface DocTheme {
    id: string;
    name: string;
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
        cycle: ["violet", "blue", "teal", "green", "amber", "pink"],
        edgeStroke: "oklch(0.55 0.03 280)",
        background: "oklch(0.992 0.003 80)",
        ink: INK,
    },
    {
        id: "mono",
        name: "Monochrome",
        cycle: ["slate", "graphite"],
        edgeStroke: "oklch(0.45 0.01 280)",
        background: "oklch(1 0 0)",
        ink: INK,
    },
    {
        id: "ocean",
        name: "Ocean",
        cycle: ["blue", "cyan", "teal", "indigo"],
        edgeStroke: "oklch(0.52 0.08 235)",
        background: "oklch(0.985 0.008 235)",
        ink: "oklch(0.26 0.05 245)",
    },
    {
        id: "sunset",
        name: "Sunset",
        cycle: ["orange", "amber", "red", "pink", "magenta"],
        edgeStroke: "oklch(0.55 0.10 40)",
        background: "oklch(0.99 0.01 70)",
        ink: "oklch(0.28 0.06 40)",
    },
    {
        id: "forest",
        name: "Forest",
        cycle: ["green", "lime", "teal", "amber"],
        edgeStroke: "oklch(0.48 0.09 150)",
        background: "oklch(0.99 0.008 140)",
        ink: "oklch(0.26 0.05 150)",
    },
];

export const THEME_BY_ID: Record<string, DocTheme> = Object.fromEntries(THEMES.map(t => [t.id, t]));
