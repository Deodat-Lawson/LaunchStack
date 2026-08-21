"use client";

import React, { useMemo } from "react";

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "~/components/ui/context-menu";

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
import type { EditorState } from "../model/store";
import type { EdgeKind, ShapeCategory } from "../model/types";
import { useEditor, useStore } from "./EditorContext";

/**
 * Right-click menu.
 *
 * Radix's context menu wraps the canvas: it opens at the pointer for free and
 * handles focus and dismissal. The canvas's own `onContextMenu` runs first and
 * makes sure the shape under the cursor is selected, so the menu always acts
 * on what was clicked.
 */

const selectSelection = (s: EditorState) => s.selection;
const selectDoc = (s: EditorState) => s.doc;

export function CanvasContextMenu({ children }: { children: React.ReactNode }) {
    const store = useStore();
    const selection = useEditor(selectSelection);
    const doc = useEditor(selectDoc);
    const page = useMemo(() => activePage(doc), [doc]);

    const nodeIds = selection.filter(s => s.kind === "node").map(s => s.id);
    const edgeIds = selection.filter(s => s.kind === "edge").map(s => s.id);
    const hasSelection = nodeIds.length > 0 || edgeIds.length > 0;
    const singleNode = nodeIds.length === 1 ? nodeById(page, nodeIds[0]!) : null;
    const hasChildren = useMemo(() => {
        if (!singleNode) return false;
        return (graphIndex(page).out.get(singleNode.id) ?? []).length > 0;
    }, [page, singleNode]);

    const shapesByCategory = useMemo(() => {
        const map = new Map<ShapeCategory, typeof SHAPES>();
        for (const category of SHAPE_CATEGORIES) {
            map.set(
                category,
                SHAPES.filter(s => s.category === category)
            );
        }
        return map;
    }, []);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-60">
                {!hasSelection && (
                    <>
                        <ContextMenuItem onSelect={() => void pasteClipboard(store)}>
                            Paste
                            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuSub>
                            <ContextMenuSubTrigger>Auto-layout</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                                <ContextMenuItem
                                    onSelect={() => runLayout(store, { kind: "mindmap" })}
                                >
                                    Mindmap
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() =>
                                        runLayout(store, { kind: "tree", direction: "right" })
                                    }
                                >
                                    Tree — left to right
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={() => runLayout(store, { kind: "org" })}>
                                    Org chart — top down
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() => runLayout(store, { kind: "radial" })}
                                >
                                    Radial
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() => runLayout(store, { kind: "grid" })}
                                >
                                    Grid
                                </ContextMenuItem>
                            </ContextMenuSubContent>
                        </ContextMenuSub>
                    </>
                )}

                {hasSelection && (
                    <>
                        <ContextMenuItem onSelect={() => void cutSelection(store)}>
                            Cut
                            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => void copySelection(store)}>
                            Copy
                            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => duplicateSelection(store)}>
                            Duplicate
                            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                            onSelect={() => deleteSelection(store)}
                            className="text-danger"
                        >
                            Delete
                            <ContextMenuShortcut>⌫</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                )}

                {singleNode && (
                    <>
                        <ContextMenuItem onSelect={() => addChildTopic(store, singleNode.id)}>
                            Add child topic
                            <ContextMenuShortcut>⇥</ContextMenuShortcut>
                        </ContextMenuItem>
                        {hasChildren && (
                            <ContextMenuItem onSelect={() => toggleCollapse(store, singleNode.id)}>
                                {singleNode.collapsed ? "Expand branch" : "Collapse branch"}
                            </ContextMenuItem>
                        )}
                        {hasChildren && (
                            <>
                                <ContextMenuItem
                                    onSelect={() => deleteNodeReconnecting(store, singleNode.id)}
                                >
                                    Delete and reconnect
                                </ContextMenuItem>
                                <ContextMenuItem
                                    onSelect={() => deleteBranch(store, singleNode.id)}
                                    className="text-danger"
                                >
                                    Delete whole branch
                                </ContextMenuItem>
                            </>
                        )}
                        <ContextMenuSeparator />
                    </>
                )}

                {nodeIds.length > 0 && (
                    <>
                        <ContextMenuSub>
                            <ContextMenuSubTrigger>Colour</ContextMenuSubTrigger>
                            <ContextMenuSubContent className="w-44">
                                {SWATCHES.map(swatch => (
                                    <ContextMenuItem
                                        key={swatch.id}
                                        onSelect={() => applySwatch(store, swatch.id)}
                                    >
                                        <span
                                            className="border-line size-3 rounded-full border"
                                            style={{ background: swatch.stroke }}
                                        />
                                        {swatch.name}
                                    </ContextMenuItem>
                                ))}
                            </ContextMenuSubContent>
                        </ContextMenuSub>

                        <ContextMenuSub>
                            <ContextMenuSubTrigger>Change shape</ContextMenuSubTrigger>
                            <ContextMenuSubContent className="w-52">
                                {SHAPE_CATEGORIES.map(category => (
                                    <ContextMenuSub key={category}>
                                        <ContextMenuSubTrigger>{category}</ContextMenuSubTrigger>
                                        <ContextMenuSubContent className="max-h-80 w-52 overflow-y-auto">
                                            {(shapesByCategory.get(category) ?? []).map(def => (
                                                <ContextMenuItem
                                                    key={def.id}
                                                    onSelect={() => setShapeType(store, def.id)}
                                                >
                                                    {def.name}
                                                </ContextMenuItem>
                                            ))}
                                        </ContextMenuSubContent>
                                    </ContextMenuSub>
                                ))}
                            </ContextMenuSubContent>
                        </ContextMenuSub>

                        <ContextMenuItem onSelect={() => fitNodeToText(store, nodeIds)}>
                            Fit shape to text
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                )}

                {edgeIds.length > 0 && (
                    <>
                        <ContextMenuSub>
                            <ContextMenuSubTrigger>Connector route</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                                {(["straight", "elbow", "curved"] as EdgeKind[]).map(kind => (
                                    <ContextMenuItem
                                        key={kind}
                                        onSelect={() => setEdgeKind(store, kind)}
                                    >
                                        {kind[0]!.toUpperCase() + kind.slice(1)}
                                    </ContextMenuItem>
                                ))}
                            </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuItem onSelect={() => reverseEdges(store)}>
                            Reverse direction
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => clearWaypoints(store)}>
                            Reset route
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                )}

                {hasSelection && (
                    <>
                        <ContextMenuSub>
                            <ContextMenuSubTrigger>Order</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                                <ContextMenuItem onSelect={() => reorder(store, "front")}>
                                    Bring to front
                                    <ContextMenuShortcut>⇧⌘]</ContextMenuShortcut>
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={() => reorder(store, "forward")}>
                                    Bring forward
                                    <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={() => reorder(store, "backward")}>
                                    Send backward
                                    <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                                </ContextMenuItem>
                                <ContextMenuItem onSelect={() => reorder(store, "back")}>
                                    Send to back
                                    <ContextMenuShortcut>⇧⌘[</ContextMenuShortcut>
                                </ContextMenuItem>
                            </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuItem onSelect={() => groupSelection(store)}>
                            Group
                            <ContextMenuShortcut>⌘G</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => ungroupSelection(store)}>
                            Ungroup
                            <ContextMenuShortcut>⇧⌘G</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => toggleLock(store)}>
                            Lock / unlock
                            <ContextMenuShortcut>⌘L</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => selectSameShape(store)}>
                            Select all of this shape
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => selectConnected(store)}>
                            Select connected
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
