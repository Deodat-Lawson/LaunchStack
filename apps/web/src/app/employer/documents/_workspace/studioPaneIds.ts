/**
 * Every app id `renderStudioPane` draws a pane for. The switch there is
 * exhaustive over this list (TypeScript fails on a missing case), and
 * `registry.test.ts` fails on a Studio entry that is not in it — so an app
 * cannot be added to the Studio without a pane, which is what made a tool
 * "a page of its own" before.
 *
 * Kept apart from `StudioPanes.tsx` so tests can read it without loading
 * every pane.
 */
export const STUDIO_PANE_IDS = [
    "chat",
    "knowledge",
    "meetings",
    "calls",
    "agents",
    "growth",
    "proposals",
    "investors",
    "vantage",
    "draft",
    "rewrite",
    "settings",
    "analytics",
    "mindmap",
    "workflows",
    "metadata",
] as const;

export type StudioPaneId = (typeof STUDIO_PANE_IDS)[number];

export function isStudioPaneId(id: string): id is StudioPaneId {
    return (STUDIO_PANE_IDS as readonly string[]).includes(id);
}
