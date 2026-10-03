"use client";

import { useCallback, useReducer, useRef } from "react";

/**
 * The workspace centre: panes arranged by a tree of splits, each pane its own
 * strip of tabs with its own active tab.
 *
 * The shape is cmux's (and before it, every tiling editor's): a split lays its
 * children out side by side or stacked, a child is a pane or another split,
 * and splitting a pane puts the new one beside it. Unlike cmux's binary tree a
 * split here holds any number of children, so three columns are one split of
 * three rather than a split nested in a split — which keeps "the pane to the
 * right" a sibling and every divider between two neighbours.
 *
 * Three rules hold everywhere in here and are worth stating once.
 *
 * A tab is open in at most ONE pane. Opening something that is already open
 * focuses it where it is rather than making a second copy, because two live
 * copies of the same editor would fight over the same document.
 *
 * A move names the neighbour it lands in front of, never a position. The strip
 * renders a list filtered by permission while this reducer holds the unfiltered
 * one, so an index would address the wrong slot the moment the two disagree.
 *
 * `groups` is the tree's leaves in reading order — depth first, so left to
 * right and then top to bottom within a column. Everything that walks "the
 * panes" walks that list; only the renderer and the split verbs read the tree.
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
    /** "" when the pane is empty: the last one standing, or one split off to fill. */
    activeId: string;
}

/** How a split lays out its children: side by side, or stacked. */
export type SplitAxis = "row" | "column";

/** Where a new pane goes, relative to the one it is split from. */
export type SplitSide = "left" | "right" | "up" | "down";

export interface PaneNode {
    type: "pane";
    groupId: string;
}

export interface SplitNode {
    type: "split";
    id: string;
    axis: SplitAxis;
    children: LayoutNode[];
    /** Each child's share of the split, summing to one. */
    sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface PaneLayout {
    /** Every pane, in reading order. Exactly the tree's leaves. */
    groups: PaneGroup[];
    root: LayoutNode;
    activeGroupId: string;
    /**
     * A pane blown up to fill the centre, or null. Only ever the focused one:
     * focusing anything else lets the rest of the layout back.
     */
    zoomedGroupId: string | null;
    /** Source of pane and split ids. A counter, so ids are stable across renders and in tests. */
    seq: number;
}

/**
 * The most panes a workspace holds. Past six, at 1280px, a pane is narrower or
 * shorter than anything in it reads well at, however they are arranged.
 */
export const MAX_GROUPS = 6;

/**
 * Splits nobody asked for — "open to the side", "ask about" — stop at three.
 * Three columns is where a 1280px workspace stops being usable: the rail plus
 * three panes leaves each under 400px, narrower than the document viewer
 * reads well at. Past it they reuse a pane instead of adding one.
 */
export const AUTO_SPLIT_LIMIT = 3;

export type PaneAction =
    /** Show `id`, in `groupId` if given, else wherever it already is, else the focused pane. */
    | { type: "open"; id: string; groupId?: string }
    /** Show `id` in the pane to the right of the focused one, adding one if there is room. */
    | { type: "openBeside"; id: string }
    | { type: "close"; groupId: string; id: string }
    | { type: "closeOthers"; groupId: string; id: string }
    | { type: "closeToRight"; groupId: string; id: string }
    /** Reorder within a pane, or hand a tab to another one. */
    | { type: "move"; id: string; toGroupId: string; beforeId: string | null }
    /**
     * Give `id` a pane of its own on `side` (default right) of `targetGroupId`
     * (default the pane it is in, or the focused one if it is not open). With
     * `atRoot`, the pane spans the whole workspace on that side instead.
     * Dropping a tab or a source on a pane's edge is this; so is ⌘-clicking
     * something to open it beside.
     */
    | {
          type: "split";
          id: string;
          side?: SplitSide;
          targetGroupId?: string;
          atRoot?: boolean;
      }
    /** A new, empty pane beside `groupId` (default the focused one), to open something in. */
    | { type: "splitPane"; side: SplitSide; groupId?: string }
    /** Close a pane and every tab in it. The last pane empties instead. */
    | { type: "closeGroup"; groupId: string }
    /**
     * Show `id` and `anchorId` side by side — never in the same pane — and
     * focus the anchor. Asking about a document is this: the document stays in
     * view while the chat takes the keyboard.
     */
    | { type: "pair"; id: string; anchorId: string }
    /**
     * Fold every pane into the focused one, keeping reading order and what
     * that pane was showing. For a window too narrow for panes: on a phone
     * two of them were 195px each, a strip nobody could read.
     */
    | { type: "merge" }
    | { type: "focusGroup"; groupId: string }
    | { type: "focusAdjacentGroup"; delta: -1 | 1 }
    /** Fill the centre with one pane (default the focused one), or give the rest back. */
    | { type: "toggleZoom"; groupId?: string }
    /** A divider was dragged: new shares for the children of `splitId`. */
    | { type: "resize"; splitId: string; sizes: number[] }
    /**
     * A saved layout, from the last visit. Unless nothing has happened since
     * the page started with `since`, whatever was opened before it arrived —
     * a `?feature=` link, a click while it loaded — is added to it rather
     * than lost.
     */
    | { type: "restore"; layout: PaneLayout; since?: PaneLayout };

export function newGroup(id: string, tabIds: string[] = []): PaneGroup {
    return { id, tabIds, activeId: tabIds[0] ?? "" };
}

/**
 * Panes side by side, in one row. Every layout the flat-column workspace could
 * make is one of these, which is also what the tests build from.
 */
export function rowLayout(groups: PaneGroup[], activeGroupId: string, seq: number): PaneLayout {
    const root: LayoutNode =
        groups.length === 1
            ? { type: "pane", groupId: groups[0]!.id }
            : {
                  type: "split",
                  id: `s${seq}`,
                  axis: "row",
                  children: groups.map(group => ({ type: "pane", groupId: group.id })),
                  sizes: evenSizes(groups.length),
              };
    return {
        groups,
        root,
        activeGroupId,
        zoomedGroupId: null,
        seq: groups.length === 1 ? seq : seq + 1,
    };
}

export function initialLayout(tabIds: string[] = ["chat"]): PaneLayout {
    return rowLayout([newGroup("g0", tabIds)], "g0", 1);
}

/** Which pane holds this tab, if any. */
export function groupOf(layout: PaneLayout, tabId: string): PaneGroup | undefined {
    return layout.groups.find(group => group.tabIds.includes(tabId));
}

/** Every open tab, in reading order, for the host that renders the panes. */
export function openTabIds(layout: PaneLayout): string[] {
    return layout.groups.flatMap(group => group.tabIds);
}

/** Whether a tab is on screen: showing in its pane, and that pane not behind a zoom. */
export function isTabVisible(layout: PaneLayout, tabId: string): boolean {
    return layout.groups.some(
        group =>
            group.activeId === tabId &&
            (layout.zoomedGroupId === null || layout.zoomedGroupId === group.id)
    );
}

/** The pane ids under a node, in reading order. */
export function leafIds(node: LayoutNode): string[] {
    return node.type === "pane" ? [node.groupId] : node.children.flatMap(leafIds);
}

function evenSizes(count: number): number[] {
    return Array.from({ length: count }, () => 1 / count);
}

/** Shares that are positive and sum to one, whatever was handed in. */
function normalSizes(sizes: readonly number[] | undefined, count: number): number[] {
    if (
        !sizes ||
        sizes.length !== count ||
        sizes.some(size => !Number.isFinite(size) || size <= 0)
    ) {
        return evenSizes(count);
    }
    const total = sizes.reduce((sum, size) => sum + size, 0);
    return sizes.map(size => size / total);
}

/**
 * The one shape each arrangement has: no split holding a single child, no
 * split directly inside one of the same axis (its children join the parent's,
 * sharing out its size), and shares that sum to one.
 */
function normalize(node: LayoutNode): LayoutNode {
    if (node.type === "pane") return node;
    const sizes = normalSizes(node.sizes, node.children.length);
    const children: LayoutNode[] = [];
    const flatSizes: number[] = [];
    node.children.forEach((child, i) => {
        const settled = normalize(child);
        if (settled.type === "split" && settled.axis === node.axis) {
            settled.children.forEach((grandchild, j) => {
                children.push(grandchild);
                flatSizes.push(sizes[i]! * settled.sizes[j]!);
            });
        } else {
            children.push(settled);
            flatSizes.push(sizes[i]!);
        }
    });
    if (children.length === 1) return children[0]!;
    return { ...node, children, sizes: normalSizes(flatSizes, children.length) };
}

/** The tree without one pane. Its share goes to the neighbour that was before it. */
function removeLeaf(node: LayoutNode, groupId: string): LayoutNode | null {
    if (node.type === "pane") return node.groupId === groupId ? null : node;
    const at = node.children.findIndex(child => leafIds(child).includes(groupId));
    if (at < 0) return node;
    const replaced = removeLeaf(node.children[at]!, groupId);
    if (replaced) {
        const children = [...node.children];
        children[at] = replaced;
        return { ...node, children };
    }
    const children = node.children.filter((_, i) => i !== at);
    if (children.length === 0) return null;
    const sizes = node.sizes.filter((_, i) => i !== at);
    // The sibling that was before it, or — for the first — the one that
    // slid into its place: whichever shared the divider it leaves behind.
    const heir = Math.max(0, at - 1);
    sizes[heir] = (sizes[heir] ?? 0) + (node.sizes[at] ?? 0);
    return { ...node, children, sizes };
}

/**
 * Put `created` on `side` of the pane `targetId`. Beside a pane that already
 * sits in a split of the right axis, it joins that split and the two share the
 * target's space; otherwise the target becomes a split of the two.
 */
function insertBeside(
    node: LayoutNode,
    targetId: string,
    created: PaneNode,
    side: SplitSide,
    splitId: string
): LayoutNode {
    const axis: SplitAxis = side === "left" || side === "right" ? "row" : "column";
    const before = side === "left" || side === "up";
    if (node.type === "pane") {
        if (node.groupId !== targetId) return node;
        return {
            type: "split",
            id: splitId,
            axis,
            children: before ? [created, node] : [node, created],
            sizes: [0.5, 0.5],
        };
    }
    const at = node.children.findIndex(
        child => child.type === "pane" && child.groupId === targetId
    );
    if (at >= 0 && node.axis === axis) {
        const children = [...node.children];
        const sizes = [...node.sizes];
        const half = (sizes[at] ?? 0) / 2;
        sizes[at] = half;
        const insertAt = before ? at : at + 1;
        children.splice(insertAt, 0, created);
        sizes.splice(insertAt, 0, half);
        return { ...node, children, sizes };
    }
    return {
        ...node,
        children: node.children.map(child => insertBeside(child, targetId, created, side, splitId)),
    };
}

/**
 * Put `created` along a whole side of the workspace. Beside a root split of
 * the right axis it joins it as a new first or last child, taking an equal
 * share; otherwise the whole tree becomes one half of a new split.
 */
function insertAtRoot(
    root: LayoutNode,
    created: PaneNode,
    side: SplitSide,
    splitId: string
): LayoutNode {
    const axis: SplitAxis = side === "left" || side === "right" ? "row" : "column";
    const before = side === "left" || side === "up";
    if (root.type === "split" && root.axis === axis) {
        const share = 1 / (root.children.length + 1);
        const scaled = root.sizes.map(size => size * (1 - share));
        return {
            ...root,
            children: before ? [created, ...root.children] : [...root.children, created],
            sizes: before ? [share, ...scaled] : [...scaled, share],
        };
    }
    return {
        type: "split",
        id: splitId,
        axis,
        children: before ? [created, root] : [root, created],
        sizes: [0.5, 0.5],
    };
}

/** Apply `next` to the split with this id, leaving the tree untouched if there is none. */
function mapSplit(
    node: LayoutNode,
    splitId: string,
    next: (split: SplitNode) => SplitNode
): LayoutNode {
    if (node.type === "pane") return node;
    if (node.id === splitId) return next(node);
    let changed = false;
    const children = node.children.map(child => {
        const mapped = mapSplit(child, splitId, next);
        if (mapped !== child) changed = true;
        return mapped;
    });
    return changed ? { ...node, children } : node;
}

/**
 * The pane over the divider on `side` of this one: the nearest ancestor split
 * of that axis with a sibling in that direction, then into that sibling —
 * its first pane going right or down, its last going left or up.
 */
export function neighbourOf(root: LayoutNode, groupId: string, side: SplitSide): string | null {
    const axis: SplitAxis = side === "left" || side === "right" ? "row" : "column";
    const forward = side === "right" || side === "down";
    const path: { split: SplitNode; index: number }[] = [];
    const find = (node: LayoutNode): boolean => {
        if (node.type === "pane") return node.groupId === groupId;
        for (let i = 0; i < node.children.length; i++) {
            path.push({ split: node, index: i });
            if (find(node.children[i]!)) return true;
            path.pop();
        }
        return false;
    };
    if (!find(root)) return null;
    for (let depth = path.length - 1; depth >= 0; depth--) {
        const { split, index } = path[depth]!;
        if (split.axis !== axis) continue;
        const sibling = split.children[index + (forward ? 1 : -1)];
        if (!sibling) continue;
        const leaves = leafIds(sibling);
        return (forward ? leaves[0] : leaves.at(-1)) ?? null;
    }
    return null;
}

/** Normalise a new tree and put `groups` back in its reading order. */
function withTree(layout: PaneLayout, root: LayoutNode): PaneLayout {
    const settled = normalize(root);
    const byId = new Map(layout.groups.map(group => [group.id, group]));
    const groups = leafIds(settled).flatMap(id => {
        const group = byId.get(id);
        return group ? [group] : [];
    });
    return { ...layout, root: settled, groups };
}

/** Focus a pane that exists, and keep a zoom only while it is on the focused pane. */
function settle(layout: PaneLayout): PaneLayout {
    const activeGroupId = layout.groups.some(group => group.id === layout.activeGroupId)
        ? layout.activeGroupId
        : layout.groups[0]!.id;
    const zoomedGroupId =
        layout.zoomedGroupId === activeGroupId && layout.groups.length > 1
            ? layout.zoomedGroupId
            : null;
    return activeGroupId === layout.activeGroupId && zoomedGroupId === layout.zoomedGroupId
        ? layout
        : { ...layout, activeGroupId, zoomedGroupId };
}

/** Drop a tab from a pane, choosing what takes its place. */
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
                  // the new last, and an emptied pane has nothing to show.
                  (tabIds[index] ?? tabIds.at(-1) ?? "")
                : group.activeId,
    };
}

/**
 * Remove the panes among `emptied` that no longer hold anything — a pane goes
 * with its last tab — and keep the focus somewhere real. Only the panes an
 * action emptied are candidates: a pane split off to be filled is empty on
 * purpose and stays until something is opened in it or it is closed. The
 * final pane is never removed: an empty workspace is a state, and it is the
 * one that offers a way back into Studio.
 */
function prune(layout: PaneLayout, emptied: string[], preferGroupId?: string): PaneLayout {
    let next = layout;
    let wanted = preferGroupId ?? layout.activeGroupId;
    for (const id of emptied) {
        const at = next.groups.findIndex(group => group.id === id);
        const group = next.groups[at];
        if (!group || group.tabIds.length > 0 || next.groups.length === 1) continue;
        const root = removeLeaf(next.root, id);
        if (!root) continue;
        next = withTree({ ...next, groups: next.groups.filter(other => other.id !== id) }, root);
        if (wanted === id) {
            // The focus followed a pane that has gone; take the one before it
            // in reading order, which is where the eye already is.
            wanted = next.groups[Math.max(0, at - 1)]!.id;
        }
    }
    return settle({ ...next, activeGroupId: wanted });
}

function replaceGroup(layout: PaneLayout, groupId: string, next: (group: PaneGroup) => PaneGroup) {
    return layout.groups.map(group => (group.id === groupId ? next(group) : group));
}

function focusedGroup(layout: PaneLayout): PaneGroup {
    return layout.groups.find(group => group.id === layout.activeGroupId) ?? layout.groups[0]!;
}

/**
 * A new pane holding `tabIds`, focused: on `side` of the pane `targetId`, or
 * along that whole side of the workspace when `targetId` is null.
 */
function addGroup(
    layout: PaneLayout,
    targetId: string | null,
    side: SplitSide,
    tabIds: string[],
    emptied: string[] = []
): PaneLayout {
    const created = newGroup(`g${layout.seq}`, tabIds);
    const leaf: PaneNode = { type: "pane", groupId: created.id };
    const splitId = `s${layout.seq}`;
    const root =
        targetId === null
            ? insertAtRoot(layout.root, leaf, side, splitId)
            : insertBeside(layout.root, targetId, leaf, side, splitId);
    const next = withTree(
        {
            ...layout,
            groups: [...layout.groups, created],
            activeGroupId: created.id,
            seq: layout.seq + 1,
        },
        root
    );
    return prune(next, emptied, created.id);
}

function asSplitAxis(value: unknown): SplitAxis | null {
    return value === "row" || value === "column" ? value : null;
}

function sanitizeNode(
    raw: unknown,
    groupIds: Set<string>,
    seenPanes: Set<string>,
    seenSplits: Set<string>
): LayoutNode | null {
    if (!raw || typeof raw !== "object") return null;
    const node = raw as Record<string, unknown>;
    if (node.type === "pane") {
        const groupId = node.groupId;
        if (typeof groupId !== "string" || !groupIds.has(groupId) || seenPanes.has(groupId))
            return null;
        seenPanes.add(groupId);
        return { type: "pane", groupId };
    }
    const axis = asSplitAxis(node.axis);
    if (node.type !== "split" || typeof node.id !== "string" || !axis) return null;
    if (seenSplits.has(node.id) || !Array.isArray(node.children) || node.children.length < 1)
        return null;
    seenSplits.add(node.id);
    const children: LayoutNode[] = [];
    for (const child of node.children) {
        const clean = sanitizeNode(child, groupIds, seenPanes, seenSplits);
        if (!clean) return null;
        children.push(clean);
    }
    const sizes = Array.isArray(node.sizes) ? (node.sizes as unknown[]).map(Number) : undefined;
    return {
        type: "split",
        id: node.id,
        axis,
        children,
        sizes: normalSizes(sizes, children.length),
    };
}

/**
 * A saved layout made safe to use, or null when it cannot be. Storage is a
 * string anyone can edit and an older build may have written, so nothing is
 * assumed: the tree must name exactly the saved panes, a tab may appear once,
 * and tabs `keep` rejects — an app since retired, a document editor with no
 * document — are dropped, taking their pane with them if it held nothing else.
 */
export function sanitizeLayout(
    raw: unknown,
    keep: (tabId: string) => boolean = () => true
): PaneLayout | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;
    if (!Array.isArray(value.groups) || value.groups.length === 0) return null;

    const groupIds = new Set<string>();
    const seenTabs = new Set<string>();
    const groups: PaneGroup[] = [];
    const lostEverything: string[] = [];
    for (const rawGroup of value.groups as unknown[]) {
        if (!rawGroup || typeof rawGroup !== "object") return null;
        const group = rawGroup as Record<string, unknown>;
        if (typeof group.id !== "string" || groupIds.has(group.id)) return null;
        if (!Array.isArray(group.tabIds)) return null;
        groupIds.add(group.id);
        const saved = (group.tabIds as unknown[]).filter(
            (id): id is string => typeof id === "string"
        );
        const tabIds = saved.filter(id => !seenTabs.has(id) && keep(id));
        tabIds.forEach(id => seenTabs.add(id));
        if (saved.length > 0 && tabIds.length === 0) lostEverything.push(group.id);
        const activeId =
            typeof group.activeId === "string" && tabIds.includes(group.activeId)
                ? group.activeId
                : (tabIds[0] ?? "");
        groups.push({ id: group.id, tabIds, activeId });
    }

    const seenPanes = new Set<string>();
    const root = sanitizeNode(value.root, groupIds, seenPanes, new Set());
    if (!root || seenPanes.size !== groupIds.size) return null;

    const idNumbers = [...groupIds, ...collectSplitIds(root)].map(id => {
        const match = /^[gs](\d+)$/.exec(id);
        return match ? Number(match[1]) : -1;
    });
    const savedSeq = typeof value.seq === "number" && Number.isFinite(value.seq) ? value.seq : 0;
    const seq = Math.max(savedSeq, ...idNumbers.map(n => n + 1));

    const activeGroupId =
        typeof value.activeGroupId === "string" && groupIds.has(value.activeGroupId)
            ? value.activeGroupId
            : groups[0]!.id;
    const layout = withTree({ groups, root, activeGroupId, zoomedGroupId: null, seq }, root);
    return prune(layout, lostEverything);
}

function collectSplitIds(node: LayoutNode): string[] {
    return node.type === "pane" ? [] : [node.id, ...node.children.flatMap(collectSplitIds)];
}

export function reduceLayout(layout: PaneLayout, action: PaneAction): PaneLayout {
    switch (action.type) {
        case "open": {
            const existing = groupOf(layout, action.id);
            // Already open somewhere. Show it there rather than opening a
            // second copy of the same editor.
            if (existing && (!action.groupId || action.groupId === existing.id)) {
                if (existing.activeId === action.id && layout.activeGroupId === existing.id)
                    return layout;
                return settle({
                    ...layout,
                    groups: replaceGroup(layout, existing.id, group => ({
                        ...group,
                        activeId: action.id,
                    })),
                    activeGroupId: existing.id,
                });
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
            return prune(
                { ...detached, groups, activeGroupId: targetId },
                existing ? [existing.id] : [],
                targetId
            );
        }

        case "openBeside": {
            const existing = groupOf(layout, action.id);
            if (existing) {
                return reduceLayout(layout, { type: "open", id: action.id, groupId: existing.id });
            }
            const focused = focusedGroup(layout);
            // An empty pane is already a pane to the side; filling it beats
            // stranding it and spending another on a blank.
            if (focused.tabIds.length === 0) {
                return reduceLayout(layout, { type: "open", id: action.id });
            }
            const beside = neighbourOf(layout.root, focused.id, "right");
            if (beside) {
                return reduceLayout(layout, { type: "open", id: action.id, groupId: beside });
            }
            if (layout.groups.length >= AUTO_SPLIT_LIMIT) {
                return reduceLayout(layout, { type: "open", id: action.id });
            }
            return addGroup(layout, focused.id, "right", [action.id]);
        }

        case "split": {
            const side = action.side ?? "right";
            const from = groupOf(layout, action.id);
            if (!from) {
                // Not open yet — a source dragged in from the sidebar, an app
                // ⌘-clicked to open beside. It arrives in a pane of its own,
                // or, with no room for one, where it was aimed.
                const targetId = action.targetGroupId ?? layout.activeGroupId;
                if (!action.atRoot && !layout.groups.some(group => group.id === targetId))
                    return layout;
                if (layout.groups.length >= MAX_GROUPS) {
                    return reduceLayout(layout, { type: "open", id: action.id, groupId: targetId });
                }
                return addGroup(layout, action.atRoot ? null : targetId, side, [action.id]);
            }
            const targetId = action.atRoot ? null : (action.targetGroupId ?? from.id);
            if (targetId !== null && !layout.groups.some(group => group.id === targetId))
                return layout;
            // Nothing to split off if it is already alone in the pane it
            // would split — or, at the root, if it is the only pane there is.
            if (targetId === from.id && from.tabIds.length < 2) return layout;
            if (targetId === null && layout.groups.length < 2 && from.tabIds.length < 2)
                return layout;
            // A tab leaving a pane it was alone in frees that pane, so the
            // count does not grow.
            const grows = from.tabIds.length > 1;
            if (grows && layout.groups.length >= MAX_GROUPS) return layout;
            const detached = {
                ...layout,
                groups: replaceGroup(layout, from.id, group => withoutTab(group, action.id)),
            };
            return addGroup(detached, targetId, side, [action.id], [from.id]);
        }

        case "splitPane": {
            const targetId = action.groupId ?? layout.activeGroupId;
            const target = layout.groups.find(group => group.id === targetId);
            // An empty pane is already somewhere to open things; a second one
            // beside it would be a blank next to a blank.
            if (!target || target.tabIds.length === 0 || layout.groups.length >= MAX_GROUPS)
                return layout;
            return addGroup(layout, targetId, action.side, []);
        }

        case "closeGroup": {
            const group = layout.groups.find(item => item.id === action.groupId);
            if (!group) return layout;
            const emptied = {
                ...layout,
                groups: replaceGroup(layout, group.id, item => ({
                    ...item,
                    tabIds: [],
                    activeId: "",
                })),
            };
            return prune(emptied, [group.id], group.id);
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
                // Already in a pane of its own: show it there.
                next = reduceLayout(next, { type: "open", id: action.id, groupId: held.id });
            } else {
                // Not open, or sharing the anchor's pane — where focusing the
                // anchor would hide it, which is the whole failure this action
                // exists to prevent. It needs a different pane.
                const full = next.groups.length >= AUTO_SPLIT_LIMIT;
                const neighbour =
                    neighbourOf(next.root, anchorGroup.id, "right") ??
                    (full
                        ? (neighbourOf(next.root, anchorGroup.id, "left") ??
                          next.groups.find(group => group.id !== anchorGroup.id)?.id)
                        : undefined);
                if (neighbour) {
                    next = reduceLayout(next, { type: "open", id: action.id, groupId: neighbour });
                } else if (held) {
                    next = reduceLayout(next, { type: "split", id: action.id, side: "right" });
                } else {
                    next = addGroup(next, anchorGroup.id, "right", [action.id]);
                }
            }
            // Focus goes to the anchor: it is what is about to be typed into.
            return reduceLayout(next, { type: "open", id: action.anchorId });
        }

        case "merge": {
            if (layout.groups.length < 2) return layout;
            const focused = focusedGroup(layout);
            const tabIds = openTabIds(layout);
            return {
                ...layout,
                groups: [{ ...focused, tabIds, activeId: focused.activeId || (tabIds[0] ?? "") }],
                root: { type: "pane", groupId: focused.id },
                activeGroupId: focused.id,
                zoomedGroupId: null,
            };
        }

        case "close":
            return prune(
                {
                    ...layout,
                    groups: replaceGroup(layout, action.groupId, group =>
                        withoutTab(group, action.id)
                    ),
                },
                [action.groupId],
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
                [action.groupId],
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
                [action.groupId],
                action.groupId
            );

        case "move": {
            const from = groupOf(layout, action.id);
            const to = layout.groups.find(group => group.id === action.toGroupId);
            if (!to || action.beforeId === action.id) return layout;
            if (!from) {
                // Not open yet — a source dropped on a strip. It opens where
                // it was dropped.
                const at =
                    action.beforeId === null
                        ? to.tabIds.length
                        : to.tabIds.indexOf(action.beforeId);
                if (at < 0) return layout;
                const tabIds = [...to.tabIds.slice(0, at), action.id, ...to.tabIds.slice(at)];
                return settle({
                    ...layout,
                    groups: replaceGroup(layout, to.id, group => ({
                        ...group,
                        tabIds,
                        activeId: action.id,
                    })),
                    activeGroupId: to.id,
                });
            }

            const sameGroup = from.id === to.id;
            const rest = to.tabIds.filter(id => id !== action.id);
            const at = action.beforeId === null ? rest.length : rest.indexOf(action.beforeId);
            // The anchor left the pane between the drag starting and landing.
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
            return prune({ ...layout, groups, activeGroupId: to.id }, [from.id], to.id);
        }

        case "focusGroup":
            return layout.groups.some(group => group.id === action.groupId)
                ? settle({ ...layout, activeGroupId: action.groupId })
                : layout;

        case "focusAdjacentGroup": {
            const at = layout.groups.findIndex(group => group.id === layout.activeGroupId);
            const next = layout.groups[at + action.delta];
            return next ? settle({ ...layout, activeGroupId: next.id }) : layout;
        }

        case "toggleZoom": {
            const targetId = action.groupId ?? layout.activeGroupId;
            if (layout.zoomedGroupId === targetId) return { ...layout, zoomedGroupId: null };
            if (layout.groups.length < 2 || !layout.groups.some(group => group.id === targetId))
                return layout;
            return { ...layout, activeGroupId: targetId, zoomedGroupId: targetId };
        }

        case "resize": {
            const root = mapSplit(layout.root, action.splitId, split =>
                split.children.length === action.sizes.length
                    ? { ...split, sizes: normalSizes(action.sizes, split.children.length) }
                    : split
            );
            return root === layout.root ? layout : { ...layout, root };
        }

        case "restore": {
            // Compared by identity: the reducer returns the same object for
            // anything that changes nothing, so "still the starting layout"
            // is exactly "nothing has happened".
            if (layout === action.since) return action.layout;
            let next = action.layout;
            for (const id of openTabIds(layout)) {
                if (!groupOf(next, id)) next = reduceLayout(next, { type: "open", id });
            }
            // What was on screen before the saved layout arrived stays on screen.
            const shown = focusedGroup(layout).activeId;
            return shown ? reduceLayout(next, { type: "open", id: shown }) : next;
        }
    }
}

export function useStudioLayout(initial: PaneLayout = initialLayout()) {
    /** The first render's layout: the one the reducer started from. */
    const initialRef = useRef(initial);
    const [layout, dispatch] = useReducer(reduceLayout, initialRef.current);

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
    const split = useCallback(
        (id: string, side?: SplitSide, targetGroupId?: string) =>
            dispatch({ type: "split", id, side, targetGroupId }),
        []
    );
    const splitAtRoot = useCallback(
        (id: string, side: SplitSide) => dispatch({ type: "split", id, side, atRoot: true }),
        []
    );
    const splitPane = useCallback(
        (side: SplitSide, groupId?: string) => dispatch({ type: "splitPane", side, groupId }),
        []
    );
    const closeGroup = useCallback(
        (groupId: string) => dispatch({ type: "closeGroup", groupId }),
        []
    );
    const pair = useCallback(
        (id: string, anchorId: string) => dispatch({ type: "pair", id, anchorId }),
        []
    );
    const merge = useCallback(() => dispatch({ type: "merge" }), []);
    const focusGroup = useCallback(
        (groupId: string) => dispatch({ type: "focusGroup", groupId }),
        []
    );
    const focusAdjacentGroup = useCallback(
        (delta: -1 | 1) => dispatch({ type: "focusAdjacentGroup", delta }),
        []
    );
    const toggleZoom = useCallback(
        (groupId?: string) => dispatch({ type: "toggleZoom", groupId }),
        []
    );
    const resize = useCallback(
        (splitId: string, sizes: number[]) => dispatch({ type: "resize", splitId, sizes }),
        []
    );
    const restore = useCallback(
        (saved: PaneLayout) =>
            dispatch({ type: "restore", layout: saved, since: initialRef.current }),
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
        splitAtRoot,
        splitPane,
        closeGroup,
        pair,
        merge,
        focusGroup,
        focusAdjacentGroup,
        toggleZoom,
        resize,
        restore,
    };
}
