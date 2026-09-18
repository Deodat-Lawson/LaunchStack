import { tidyMenuItems, type ActionMenuItem } from "~/components/ui/action-menu";
import {
    addChildTopic,
    addSiblingTopic,
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
import type { EditorState, EditorStore } from "../model/store";
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

/**
 * The menu, at the depth the editor is showing.
 *
 * Everything depth is the full list below. Focus depth is the seven things
 * people do to a shape, in frequency order, then "More" holding the rest —
 * so Add child is first and Select connected is a level down instead of
 * sharing a row with it. Which seven depends on the document's kind: a
 * flowchart leads with Change shape, a mindmap with Add child. Nothing is
 * removed at either depth; see the README, "Chrome depths".
 */
export function buildCanvasMenuItems(
    store: EditorStore,
    extras: CanvasMenuExtras = {}
): ActionMenuItem[] {
    const state = store.getState();
    const everything = buildEverything(store, extras, state);
    if (state.chromeDepth !== "focus") return everything;
    return focusTier(store, state, everything);
}

function focusTier(
    store: EditorStore,
    state: EditorState,
    everything: ActionMenuItem[]
): ActionMenuItem[] {
    const page = activePage(state.doc);
    const nodeIds = state.selection.filter(s => s.kind === "node").map(s => s.id);
    const singleNode = nodeIds.length === 1 ? nodeById(page, nodeIds[0]!) : null;
    // With nothing, or several things, selected the full menu is already short.
    if (!singleNode) return everything;

    const kind = state.doc.settings.kind;
    const flow = kind === "flowchart" || kind === "freeform";
    const byId = new Map(everything.map(item => [item.id, item] as const));
    const pick = (id: string) => byId.get(id);

    const addSibling: ActionMenuItem = {
        type: "item",
        id: "add-sibling",
        label: "Add sibling topic",
        icon: "plus",
        shortcut: "↩",
        onSelect: () => addSiblingTopic(store, singleNode.id),
    };
    const addChild = pick("add-child");
    const connected: ActionMenuItem | undefined =
        addChild && addChild.type === "item"
            ? { ...addChild, label: "Add connected shape" }
            : addChild;

    const promoted: (ActionMenuItem | undefined)[] = flow
        ? [pick("ask"), pick("shape"), connected, pick("colour"), pick("duplicate"), pick("delete")]
        : [
              pick("ask"),
              addChild,
              addSibling,
              pick("colour"),
              pick("collapse"),
              pick("duplicate"),
              pick("delete"),
          ];
    const top = promoted.filter((item): item is ActionMenuItem => item !== undefined);
    const promotedIds = new Set(top.map(item => item.id));

    const rest = tidyMenuItems(everything.filter(item => !promotedIds.has(item.id)));
    return tidyMenuItems([
        ...top,
        { type: "separator", id: "sep-more" },
        { type: "submenu", id: "more", label: "More", items: rest },
    ]);
}

function buildEverything(
    store: EditorStore,
    extras: CanvasMenuExtras,
    state: EditorState
): ActionMenuItem[] {
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
