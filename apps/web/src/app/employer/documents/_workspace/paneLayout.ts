"use client";

import { useCallback, useReducer } from "react";

/**
 * The workspace centre: one or more groups side by side, each its own strip of
 * tabs with its own active tab.
 *
 * Two rules hold everywhere in here and are worth stating once.
 *
 * A tab is open in at most ONE group. Opening something that is already open
 * focuses it where it is rather than making a second copy, because two live
 * copies of the same editor would fight over the same document.
 *
 * A move names the neighbour it lands in front of, never a position. The strip
 * renders a list filtered by permission while this reducer holds the unfiltered
 * one, so an index would address the wrong slot the moment the two disagree.
 */

/**
 * A source opened beside the chat is a tab like any other. The prefix keeps
 * its id out of the Studio app namespace, where "notes" is a tool rather than
 * a document someone happens to have called Notes.
 */
export const SOURCE_TAB_PREFIX = "source:";

export function tabIdOfSource(sourceId: string): string {
    return `${SOURCE_TAB_PREFIX}${sourceId}`;
}

export function sourceIdOfTab(tabId: string): string {
    return tabId.slice(SOURCE_TAB_PREFIX.length);
}

export interface PaneGroup {
    id: string;
    tabIds: string[];
    /** "" when the group is empty, which only the last surviving group can be. */
    activeId: string;
}

export interface PaneLayout {
    groups: PaneGroup[];
    activeGroupId: string;
    /** Source of group ids. A counter, so ids are stable across renders and in tests. */
    seq: number;
}

/**
 * Three columns is where a 1280px workspace stops being usable — the rail plus
 * three panes leaves each under 400px, narrower than the document viewer reads
 * well at. Splitting beyond this moves the tab instead of adding a column.
 */
export const MAX_GROUPS = 3;

export type PaneAction =
    /** Show `id`, in `groupId` if given, else wherever it already is, else the focused group. */
    | { type: "open"; id: string; groupId?: string }
    /** Show `id` in the group after the focused one, adding a column if there is room. */
    | { type: "openBeside"; id: string }
    | { type: "close"; groupId: string; id: string }
    | { type: "closeOthers"; groupId: string; id: string }
    | { type: "closeToRight"; groupId: string; id: string }
    /** Reorder within a group, or hand a tab to another one. */
    | { type: "move"; id: string; toGroupId: string; beforeId: string | null }
    /** Give `id` a column of its own, immediately right of the one it is in. */
    | { type: "split"; id: string }
    /**
     * Show `id` and `anchorId` side by side — never in the same column — and
     * focus the anchor. Asking about a document is this: the document stays in
     * view while the chat takes the keyboard.
     */
    | { type: "pair"; id: string; anchorId: string }
    | { type: "focusGroup"; groupId: string }
    | { type: "focusAdjacentGroup"; delta: -1 | 1 };

export function newGroup(id: string, tabIds: string[] = []): PaneGroup {
    return { id, tabIds, activeId: tabIds[0] ?? "" };
}

export function initialLayout(tabIds: string[] = ["chat"]): PaneLayout {
    return { groups: [newGroup("g0", tabIds)], activeGroupId: "g0", seq: 1 };
}

/** Which group holds this tab, if any. */
export function groupOf(layout: PaneLayout, tabId: string): PaneGroup | undefined {
    return layout.groups.find(group => group.tabIds.includes(tabId));
}

/** Every open tab, left to right, for the host that renders the panes. */
export function openTabIds(layout: PaneLayout): string[] {
    return layout.groups.flatMap(group => group.tabIds);
}

/** The tab showing in each group, for deciding which panes are visible. */
export function isTabVisible(layout: PaneLayout, tabId: string): boolean {
    return layout.groups.some(group => group.activeId === tabId);
}

/** Drop a tab from a group, choosing what takes its place. */
function withoutTab(group: PaneGroup, tabId: string): PaneGroup {
    const index = group.tabIds.indexOf(tabId);
    if (index < 0) return group;
    const tabIds = group.tabIds.filter(id => id !== tabId);
    return {
        ...group,
        tabIds,
        activeId:
            group.activeId === tabId
                ? // Whatever slid into this slot; the last tab falls back to
                  // the new last, and an emptied group has nothing to show.
                  (tabIds[index] ?? tabIds.at(-1) ?? "")
                : group.activeId,
    };
}

/**
 * Remove groups that no longer hold anything, and keep the focus somewhere
 * real. The final group is never removed: an empty workspace is a state, and
 * it is the one that offers a way back into Studio.
 */
function prune(layout: PaneLayout, preferGroupId?: string): PaneLayout {
    const groups = layout.groups.filter(group => group.tabIds.length > 0);
    if (groups.length === 0) {
        const kept = layout.groups[0]!;
        return {
            ...layout,
            groups: [{ ...kept, tabIds: [], activeId: "" }],
            activeGroupId: kept.id,
        };
    }
    const wanted = preferGroupId ?? layout.activeGroupId;
    const activeGroupId = groups.some(group => group.id === wanted)
        ? wanted
        : // The focus followed a group that has gone; take the nearest one
          // that was to its left, which is where the eye already is.
          (groups[
              Math.max(
                  0,
                  Math.min(
                      groups.length - 1,
                      layout.groups.findIndex(group => group.id === wanted) - 1
                  )
              )
          ]?.id ?? groups[0]!.id);
    return { ...layout, groups, activeGroupId };
}

function replaceGroup(layout: PaneLayout, groupId: string, next: (group: PaneGroup) => PaneGroup) {
    return layout.groups.map(group => (group.id === groupId ? next(group) : group));
}

export function reduceLayout(layout: PaneLayout, action: PaneAction): PaneLayout {
    switch (action.type) {
        case "open": {
            const existing = groupOf(layout, action.id);
            // Already open somewhere. Show it there rather than opening a
            // second copy of the same editor.
            if (existing && (!action.groupId || action.groupId === existing.id)) {
                return {
                    ...layout,
                    groups: replaceGroup(layout, existing.id, group => ({
                        ...group,
                        activeId: action.id,
                    })),
                    activeGroupId: existing.id,
                };
            }
            const targetId = action.groupId ?? layout.activeGroupId;
            if (!layout.groups.some(group => group.id === targetId)) return layout;
            const detached = existing
                ? {
                      ...layout,
                      groups: replaceGroup(layout, existing.id, g => withoutTab(g, action.id)),
                  }
                : layout;
            const groups = replaceGroup(detached, targetId, group => ({
                ...group,
                tabIds: [...group.tabIds, action.id],
                activeId: action.id,
            }));
            return prune({ ...detached, groups, activeGroupId: targetId }, targetId);
        }

        case "openBeside": {
            const existing = groupOf(layout, action.id);
            if (existing) {
                return reduceLayout(layout, { type: "open", id: action.id, groupId: existing.id });
            }
            const at = layout.groups.findIndex(group => group.id === layout.activeGroupId);
            // An empty column is already a column to the side; filling it
            // beats stranding it and spending one of the three on a blank.
            if (layout.groups[at]?.tabIds.length === 0) {
                return reduceLayout(layout, { type: "open", id: action.id });
            }
            const beside = layout.groups[at + 1];
            if (beside) {
                return reduceLayout(layout, { type: "open", id: action.id, groupId: beside.id });
            }
            if (layout.groups.length >= MAX_GROUPS) {
                return reduceLayout(layout, { type: "open", id: action.id });
            }
            const created = newGroup(`g${layout.seq}`, [action.id]);
            const groups = [...layout.groups];
            groups.splice(at + 1, 0, created);
            // Prune like every other create path: a column emptied earlier
            // must not survive just because this action added another.
            return prune({ groups, activeGroupId: created.id, seq: layout.seq + 1 }, created.id);
        }

        case "split": {
            const from = groupOf(layout, action.id);
            // Nothing to split off if it is already alone in its column.
            if (!from || from.tabIds.length < 2 || layout.groups.length >= MAX_GROUPS)
                return layout;
            const at = layout.groups.findIndex(group => group.id === from.id);
            const created = newGroup(`g${layout.seq}`, [action.id]);
            const groups = layout.groups.map(group =>
                group.id === from.id ? withoutTab(group, action.id) : group
            );
            groups.splice(at + 1, 0, created);
            return prune({ groups, activeGroupId: created.id, seq: layout.seq + 1 }, created.id);
        }

        case "pair": {
            if (action.id === action.anchorId) return layout;
            // The anchor has to be showing before anything can sit beside it.
            let next = groupOf(layout, action.anchorId)
                ? layout
                : reduceLayout(layout, { type: "open", id: action.anchorId });
            const anchorGroup = groupOf(next, action.anchorId);
            if (!anchorGroup) return layout;
            const held = groupOf(next, action.id);

            if (held && held.id !== anchorGroup.id) {
                // Already in a column of its own: show it there.
                next = reduceLayout(next, { type: "open", id: action.id, groupId: held.id });
            } else {
                // Not open, or sharing the anchor's column — where focusing the
                // anchor would hide it, which is the whole failure this action
                // exists to prevent. It needs a different column.
                const at = next.groups.findIndex(group => group.id === anchorGroup.id);
                const neighbour =
                    next.groups[at + 1] ??
                    (next.groups.length >= MAX_GROUPS ? next.groups[at - 1] : undefined);
                if (neighbour) {
                    next = reduceLayout(next, {
                        type: "open",
                        id: action.id,
                        groupId: neighbour.id,
                    });
                } else {
                    const created = newGroup(`g${next.seq}`, [action.id]);
                    const groups = next.groups.map(group =>
                        group.id === anchorGroup.id ? withoutTab(group, action.id) : group
                    );
                    groups.splice(at + 1, 0, created);
                    next = { groups, activeGroupId: created.id, seq: next.seq + 1 };
                }
            }
            // Focus goes to the anchor: it is what is about to be typed into.
            return reduceLayout(next, { type: "open", id: action.anchorId });
        }

        case "close":
            return prune(
                {
                    ...layout,
                    groups: replaceGroup(layout, action.groupId, group =>
                        withoutTab(group, action.id)
                    ),
                },
                action.groupId
            );

        case "closeOthers":
            return prune(
                {
                    ...layout,
                    groups: replaceGroup(layout, action.groupId, group =>
                        group.tabIds.includes(action.id)
                            ? { ...group, tabIds: [action.id], activeId: action.id }
                            : group
                    ),
                },
                action.groupId
            );

        case "closeToRight":
            return prune(
                {
                    ...layout,
                    groups: replaceGroup(layout, action.groupId, group => {
                        const at = group.tabIds.indexOf(action.id);
                        if (at < 0) return group;
                        const tabIds = group.tabIds.slice(0, at + 1);
                        return {
                            ...group,
                            tabIds,
                            activeId: tabIds.includes(group.activeId) ? group.activeId : action.id,
                        };
                    }),
                },
                action.groupId
            );

        case "move": {
            const from = groupOf(layout, action.id);
            const to = layout.groups.find(group => group.id === action.toGroupId);
            if (!from || !to || action.beforeId === action.id) return layout;

            const sameGroup = from.id === to.id;
            const rest = to.tabIds.filter(id => id !== action.id);
            const at = action.beforeId === null ? rest.length : rest.indexOf(action.beforeId);
            // The anchor left the group between the drag starting and landing.
            if (at < 0) return layout;
            const tabIds = [...rest.slice(0, at), action.id, ...rest.slice(at)];

            if (sameGroup && tabIds.every((id, i) => id === from.tabIds[i])) return layout;

            const groups = layout.groups.map(group => {
                if (group.id === to.id) {
                    return { ...group, tabIds, activeId: sameGroup ? group.activeId : action.id };
                }
                if (group.id === from.id) return withoutTab(group, action.id);
                return group;
            });
            return prune({ ...layout, groups, activeGroupId: to.id }, to.id);
        }

        case "focusGroup":
            return layout.groups.some(group => group.id === action.groupId)
                ? { ...layout, activeGroupId: action.groupId }
                : layout;

        case "focusAdjacentGroup": {
            const at = layout.groups.findIndex(group => group.id === layout.activeGroupId);
            const next = layout.groups[at + action.delta];
            return next ? { ...layout, activeGroupId: next.id } : layout;
        }
    }
}

export function useStudioLayout(initial: PaneLayout = initialLayout()) {
    const [layout, dispatch] = useReducer(reduceLayout, initial);

    const open = useCallback((id: string, groupId?: string) => {
        dispatch({ type: "open", id, groupId });
    }, []);
    const openBeside = useCallback((id: string) => dispatch({ type: "openBeside", id }), []);
    const close = useCallback(
        (groupId: string, id: string) => dispatch({ type: "close", groupId, id }),
        []
    );
    const closeOthers = useCallback(
        (groupId: string, id: string) => dispatch({ type: "closeOthers", groupId, id }),
        []
    );
    const closeToRight = useCallback(
        (groupId: string, id: string) => dispatch({ type: "closeToRight", groupId, id }),
        []
    );
    const move = useCallback(
        (id: string, toGroupId: string, beforeId: string | null) =>
            dispatch({ type: "move", id, toGroupId, beforeId }),
        []
    );
    const split = useCallback((id: string) => dispatch({ type: "split", id }), []);
    const pair = useCallback(
        (id: string, anchorId: string) => dispatch({ type: "pair", id, anchorId }),
        []
    );
    const focusGroup = useCallback(
        (groupId: string) => dispatch({ type: "focusGroup", groupId }),
        []
    );
    const focusAdjacentGroup = useCallback(
        (delta: -1 | 1) => dispatch({ type: "focusAdjacentGroup", delta }),
        []
    );

    return {
        layout,
        open,
        openBeside,
        close,
        closeOthers,
        closeToRight,
        move,
        split,
        pair,
        focusGroup,
        focusAdjacentGroup,
    };
}
