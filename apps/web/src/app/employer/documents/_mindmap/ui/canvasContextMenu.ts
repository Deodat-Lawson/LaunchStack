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
    deleteTopicsOrSelection,
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
import {
    activePage,
    graphIndex,
    isCentreWithBranches,
    isTopicShape,
    nodeById,
    topicParent,
} from "../model/doc";
import { SWATCHES } from "../model/palette";
import { SHAPE_CATEGORIES, SHAPES } from "../model/shapes";
import type { EditorState, EditorStore } from "../model/store";
import type { EdgeKind } from "../model/types";
import { categoryName, shapeName, swatchName, type MindmapT } from "./EditorContext";

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
    /** `useTranslations("mindmap")` from the component that opens the menu. */
    t: MindmapT,
    extras: CanvasMenuExtras = {}
): ActionMenuItem[] {
    const state = store.getState();
    const everything = buildEverything(store, t, extras, state);
    if (state.chromeDepth !== "focus") return everything;
    return focusTier(store, t, state, everything);
}

function focusTier(
    store: EditorStore,
    t: MindmapT,
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

    // The centre has no siblings — Enter on it adds a child, which is the
    // item above — so the menu only offers a sibling where there can be one.
    const addSibling: ActionMenuItem | undefined = topicParent(page, singleNode.id)
        ? {
              type: "item",
              id: "add-sibling",
              label: t("contextMenu.addSibling"),
              icon: "plus",
              shortcut: "↩",
              onSelect: () => addSiblingTopic(store, singleNode.id),
          }
        : undefined;
    const addChild = pick("add-child");
    const connected: ActionMenuItem | undefined =
        addChild && addChild.type === "item"
            ? { ...addChild, label: t("contextMenu.addConnected") }
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
        { type: "submenu", id: "more", label: t("contextMenu.more"), items: rest },
    ]);
}

function buildEverything(
    store: EditorStore,
    t: MindmapT,
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
    const singleTopic = singleNode ? isTopicShape(singleNode.shape) : false;

    const items: ActionMenuItem[] = [];

    if (!hasSelection) {
        items.push(
            {
                type: "item",
                id: "paste",
                label: t("contextMenu.paste"),
                icon: "paste",
                shortcut: "⌘V",
                onSelect: () => void pasteClipboard(store),
            },
            { type: "separator", id: "sep-layout" },
            {
                type: "submenu",
                id: "layout",
                label: t("contextMenu.autoLayout"),
                icon: "mindmap",
                items: [
                    {
                        id: "mindmap",
                        label: t("contextMenu.layouts.mindmap"),
                        run: () => runLayout(store, { kind: "mindmap" }),
                    },
                    {
                        id: "tree",
                        label: t("contextMenu.layouts.tree"),
                        run: () => runLayout(store, { kind: "tree", direction: "right" }),
                    },
                    {
                        id: "org",
                        label: t("contextMenu.layouts.org"),
                        run: () => runLayout(store, { kind: "org" }),
                    },
                    {
                        id: "radial",
                        label: t("contextMenu.layouts.radial"),
                        run: () => runLayout(store, { kind: "radial" }),
                    },
                    {
                        id: "grid",
                        label: t("contextMenu.layouts.grid"),
                        run: () => runLayout(store, { kind: "grid" }),
                    },
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
            label: t("contextMenu.cut"),
            icon: "cut",
            shortcut: "⌘X",
            onSelect: () => void cutSelection(store),
        },
        {
            type: "item",
            id: "copy",
            label: t("contextMenu.copy"),
            icon: "copy",
            shortcut: "⌘C",
            onSelect: () => void copySelection(store),
        },
        {
            type: "item",
            id: "duplicate",
            label: t("contextMenu.duplicate"),
            icon: "plus",
            shortcut: "⌘D",
            onSelect: () => duplicateSelection(store),
        },
        {
            // The Delete key's command, so the item and the key agree: topics
            // go with their branch, anything else on its own.
            type: "item",
            id: "delete",
            label: t("contextMenu.delete"),
            icon: "delete",
            shortcut: "⌫",
            danger: true,
            onSelect: () => deleteTopicsOrSelection(store),
        },
        { type: "separator", id: "sep-selection" }
    );

    if (singleNode) {
        if (extras.onAskAboutNode && singleNode.text.trim()) {
            const text = singleNode.text.trim();
            items.push({
                type: "item",
                id: "ask",
                label: t("contextMenu.ask"),
                icon: "ask",
                onSelect: () => extras.onAskAboutNode?.(text),
            });
        }
        items.push({
            type: "item",
            id: "add-child",
            label: t("contextMenu.addChild"),
            icon: "plus",
            shortcut: "⇥",
            onSelect: () => addChildTopic(store, singleNode.id),
        });
        if (hasChildren) {
            items.push(
                {
                    type: "item",
                    id: "collapse",
                    label: singleNode.collapsed
                        ? t("contextMenu.expandBranch")
                        : t("contextMenu.collapseBranch"),
                    icon: singleNode.collapsed ? "open" : "hide",
                    shortcut: "⌘/",
                    onSelect: () => toggleCollapse(store, singleNode.id),
                },
                // Not on the centre: its branches have nowhere to go, and
                // keeping them would split the map (see `removeReconnecting`).
                ...(isCentreWithBranches(page, singleNode.id)
                    ? []
                    : [
                          {
                              type: "item" as const,
                              id: "delete-reconnect",
                              label: t("contextMenu.deleteReconnect"),
                              icon: "move" as const,
                              // ⌥⌫ is the topic binding; other shapes have no key for it.
                              shortcut: singleTopic ? "⌥⌫" : undefined,
                              onSelect: () => deleteNodeReconnecting(store, singleNode.id),
                          },
                      ])
            );
            // A topic's plain Delete already takes its branch.
            if (!singleTopic) {
                items.push({
                    type: "item",
                    id: "delete-branch",
                    label: t("contextMenu.deleteBranch"),
                    icon: "delete",
                    danger: true,
                    onSelect: () => deleteBranch(store, singleNode.id),
                });
            }
        }
        items.push({ type: "separator", id: "sep-node" });
    }

    if (nodeIds.length > 0) {
        items.push(
            {
                type: "submenu",
                id: "colour",
                label: t("contextMenu.colour"),
                icon: "palette",
                items: SWATCHES.map(swatch => ({
                    type: "item" as const,
                    id: `colour-${swatch.id}`,
                    label: swatchName(t, swatch),
                    swatch: swatch.stroke,
                    onSelect: () => applySwatch(store, swatch.id),
                })),
            },
            {
                type: "submenu",
                id: "shape",
                label: t("contextMenu.changeShape"),
                icon: "shapes",
                items: SHAPE_CATEGORIES.map(category => ({
                    type: "submenu" as const,
                    id: `shape-${category}`,
                    label: categoryName(t, category),
                    items: SHAPES.filter(
                        def => def.category === category && !def.paletteHidden
                    ).map(def => ({
                        type: "item" as const,
                        id: `shape-${def.id}`,
                        label: shapeName(t, def.id),
                        onSelect: () => setShapeType(store, def.id),
                    })),
                })),
            },
            {
                type: "item",
                id: "fit-text",
                label: t("contextMenu.fitText"),
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
                label: t("contextMenu.connectorRoute"),
                icon: "move",
                items: (["straight", "elbow", "curved"] as EdgeKind[]).map(kind => ({
                    type: "item" as const,
                    id: `route-${kind}`,
                    label: t(`inspector.routes.${kind}`),
                    onSelect: () => setEdgeKind(store, kind),
                })),
            },
            {
                type: "item",
                id: "reverse",
                label: t("contextMenu.reverse"),
                icon: "retry",
                onSelect: () => reverseEdges(store),
            },
            {
                type: "item",
                id: "reset-route",
                label: t("contextMenu.resetRoute"),
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
            label: t("contextMenu.order"),
            icon: "group",
            items: [
                { id: "front", shortcut: "⇧⌘]" },
                { id: "forward", shortcut: "⌘]" },
                { id: "backward", shortcut: "⌘[" },
                { id: "back", shortcut: "⇧⌘[" },
            ].map(entry => {
                const move = entry.id as "front" | "forward" | "backward" | "back";
                return {
                    type: "item" as const,
                    id: `order-${entry.id}`,
                    label: t(`contextMenu.orders.${move}`),
                    shortcut: entry.shortcut,
                    onSelect: () => reorder(store, move),
                };
            }),
        },
        {
            type: "item",
            id: "group",
            label: t("contextMenu.group"),
            icon: "group",
            shortcut: "⌘G",
            onSelect: () => groupSelection(store),
        },
        {
            type: "item",
            id: "ungroup",
            label: t("contextMenu.ungroup"),
            shortcut: "⇧⌘G",
            onSelect: () => ungroupSelection(store),
        },
        {
            type: "item",
            id: "lock",
            label: t("contextMenu.lock"),
            icon: "lock",
            shortcut: "⌘L",
            onSelect: () => toggleLock(store),
        },
        { type: "separator", id: "sep-select" },
        {
            type: "item",
            id: "select-shape",
            label: t("contextMenu.selectShape"),
            icon: "select",
            onSelect: () => selectSameShape(store),
        },
        {
            type: "item",
            id: "select-connected",
            label: t("contextMenu.selectConnected"),
            icon: "select",
            onSelect: () => selectConnected(store),
        }
    );
    return items;
}
