import type { ActionMenuItem } from "~/components/ui/action-menu";
import {
    addChildTopic,
    applySwatch,
    clearWaypoints,
    copySelection,
    cutSelection,
    deleteBranch,
    deleteNodeReconnecting,
    deleteSelection,
    duplicateSelection,
    fitNodeToText,
    groupSelection,
    pasteClipboard,
    reorder,
    reverseEdges,
    runLayout,
    selectConnected,
    selectSameShape,
    setEdgeKind,
    setShapeType,
    toggleCollapse,
    toggleLock,
    ungroupSelection,
} from "../model/commands";
import { activePage, graphIndex, nodeById } from "../model/doc";
import { SWATCHES } from "../model/palette";
import { SHAPE_CATEGORIES, SHAPES } from "../model/shapes";
import type { EditorStore } from "../model/store";
import type { EdgeKind } from "../model/types";

/**
 * The canvas's right-click menu as data. Read off the store at open time —
 * the canvas's own handler has already fixed the selection under the
 * cursor — so the menu always acts on what was clicked.
 *
 * Swatch colours are document data, not tokens (see the Mindmap README):
 * they ride on the item's `swatch`, which the menu draws as a dot.
 */
export interface CanvasMenuExtras {
    /** Take a topic's text to the chat — present only inside the workspace. */
    onAskAboutNode?: (text: string) => void;
}

export function buildCanvasMenuItems(
    store: EditorStore,
    extras: CanvasMenuExtras = {}
): ActionMenuItem[] {
    const state = store.getState();
    const page = activePage(state.doc);
    const selection = state.selection;
    const nodeIds = selection.filter(s => s.kind === "node").map(s => s.id);
    const edgeIds = selection.filter(s => s.kind === "edge").map(s => s.id);
    const hasSelection = nodeIds.length > 0 || edgeIds.length > 0;
    const singleNode = nodeIds.length === 1 ? nodeById(page, nodeIds[0]!) : null;
    const hasChildren = singleNode
        ? (graphIndex(page).out.get(singleNode.id) ?? []).length > 0
        : false;

    const items: ActionMenuItem[] = [];

    if (!hasSelection) {
        items.push(
            {
                type: "item",
                id: "paste",
                label: "Paste",
                icon: "paste",
                shortcut: "⌘V",
                onSelect: () => void pasteClipboard(store),
            },
            { type: "separator", id: "sep-layout" },
            {
                type: "submenu",
                id: "layout",
                label: "Auto-layout",
                icon: "mindmap",
                items: [
                    {
                        id: "mindmap",
                        label: "Mindmap",
                        run: () => runLayout(store, { kind: "mindmap" }),
                    },
                    {
                        id: "tree",
                        label: "Tree — left to right",
                        run: () => runLayout(store, { kind: "tree", direction: "right" }),
                    },
                    {
                        id: "org",
                        label: "Org chart — top down",
                        run: () => runLayout(store, { kind: "org" }),
                    },
                    {
                        id: "radial",
                        label: "Radial",
                        run: () => runLayout(store, { kind: "radial" }),
                    },
                    { id: "grid", label: "Grid", run: () => runLayout(store, { kind: "grid" }) },
                ].map(entry => ({
                    type: "item" as const,
                    id: `layout-${entry.id}`,
                    label: entry.label,
                    onSelect: entry.run,
                })),
            }
        );
        return items;
    }

    items.push(
        {
            type: "item",
            id: "cut",
            label: "Cut",
            icon: "cut",
            shortcut: "⌘X",
            onSelect: () => void cutSelection(store),
        },
        {
            type: "item",
            id: "copy",
            label: "Copy",
            icon: "copy",
            shortcut: "⌘C",
            onSelect: () => void copySelection(store),
        },
        {
            type: "item",
            id: "duplicate",
            label: "Duplicate",
            icon: "plus",
            shortcut: "⌘D",
            onSelect: () => duplicateSelection(store),
        },
        {
            type: "item",
            id: "delete",
            label: "Delete",
            icon: "delete",
            shortcut: "⌫",
            danger: true,
            onSelect: () => deleteSelection(store),
        },
        { type: "separator", id: "sep-selection" }
    );

    if (singleNode) {
        if (extras.onAskAboutNode && singleNode.text.trim()) {
            const text = singleNode.text.trim();
            items.push({
                type: "item",
                id: "ask",
                label: "Ask about this in chat",
                icon: "ask",
                onSelect: () => extras.onAskAboutNode?.(text),
            });
        }
        items.push({
            type: "item",
            id: "add-child",
            label: "Add child topic",
            icon: "plus",
            shortcut: "⇥",
            onSelect: () => addChildTopic(store, singleNode.id),
        });
        if (hasChildren) {
            items.push(
                {
                    type: "item",
                    id: "collapse",
                    label: singleNode.collapsed ? "Expand branch" : "Collapse branch",
                    icon: singleNode.collapsed ? "open" : "hide",
                    onSelect: () => toggleCollapse(store, singleNode.id),
                },
                {
                    type: "item",
                    id: "delete-reconnect",
                    label: "Delete and reconnect",
                    icon: "move",
                    onSelect: () => deleteNodeReconnecting(store, singleNode.id),
                },
                {
                    type: "item",
                    id: "delete-branch",
                    label: "Delete whole branch",
                    icon: "delete",
                    danger: true,
                    onSelect: () => deleteBranch(store, singleNode.id),
                }
            );
        }
        items.push({ type: "separator", id: "sep-node" });
    }

    if (nodeIds.length > 0) {
        items.push(
            {
                type: "submenu",
                id: "colour",
                label: "Colour",
                icon: "palette",
                items: SWATCHES.map(swatch => ({
                    type: "item" as const,
                    id: `colour-${swatch.id}`,
                    label: swatch.name,
                    swatch: swatch.stroke,
                    onSelect: () => applySwatch(store, swatch.id),
                })),
            },
            {
                type: "submenu",
                id: "shape",
                label: "Change shape",
                icon: "shapes",
                items: SHAPE_CATEGORIES.map(category => ({
                    type: "submenu" as const,
                    id: `shape-${category}`,
                    label: category,
                    items: SHAPES.filter(
                        def => def.category === category && !def.paletteHidden
                    ).map(def => ({
                        type: "item" as const,
                        id: `shape-${def.id}`,
                        label: def.name,
                        onSelect: () => setShapeType(store, def.id),
                    })),
                })),
            },
            {
                type: "item",
                id: "fit-text",
                label: "Fit shape to text",
                icon: "expand",
                onSelect: () => fitNodeToText(store, nodeIds),
            },
            { type: "separator", id: "sep-shape" }
        );
    }

    if (edgeIds.length > 0) {
        items.push(
            {
                type: "submenu",
                id: "route",
                label: "Connector route",
                icon: "move",
                items: (["straight", "elbow", "curved"] as EdgeKind[]).map(kind => ({
                    type: "item" as const,
                    id: `route-${kind}`,
                    label: kind[0]!.toUpperCase() + kind.slice(1),
                    onSelect: () => setEdgeKind(store, kind),
                })),
            },
            {
                type: "item",
                id: "reverse",
                label: "Reverse direction",
                icon: "retry",
                onSelect: () => reverseEdges(store),
            },
            {
                type: "item",
                id: "reset-route",
                label: "Reset route",
                icon: "eraser",
                onSelect: () => clearWaypoints(store),
            },
            { type: "separator", id: "sep-edge" }
        );
    }

    items.push(
        {
            type: "submenu",
            id: "order",
            label: "Order",
            icon: "group",
            items: [
                { id: "front", label: "Bring to front", shortcut: "⇧⌘]" },
                { id: "forward", label: "Bring forward", shortcut: "⌘]" },
                { id: "backward", label: "Send backward", shortcut: "⌘[" },
                { id: "back", label: "Send to back", shortcut: "⇧⌘[" },
            ].map(entry => ({
                type: "item" as const,
                id: `order-${entry.id}`,
                label: entry.label,
                shortcut: entry.shortcut,
                onSelect: () =>
                    reorder(store, entry.id as "front" | "forward" | "backward" | "back"),
            })),
        },
        {
            type: "item",
            id: "group",
            label: "Group",
            icon: "group",
            shortcut: "⌘G",
            onSelect: () => groupSelection(store),
        },
        {
            type: "item",
            id: "ungroup",
            label: "Ungroup",
            shortcut: "⇧⌘G",
            onSelect: () => ungroupSelection(store),
        },
        {
            type: "item",
            id: "lock",
            label: "Lock / unlock",
            icon: "lock",
            shortcut: "⌘L",
            onSelect: () => toggleLock(store),
        },
        { type: "separator", id: "sep-select" },
        {
            type: "item",
            id: "select-shape",
            label: "Select all of this shape",
            icon: "select",
            onSelect: () => selectSameShape(store),
        },
        {
            type: "item",
            id: "select-connected",
            label: "Select connected",
            icon: "select",
            onSelect: () => selectConnected(store),
        }
    );
    return items;
}
