"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen } from "lucide-react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import { activePage, graphIndex, mapNodes, nodeById } from "../model/doc";
import { focusNode } from "../model/commands";
import { shapeDef } from "../model/shapes";
import { nonEmpty, trimmedOr } from "../model/strings";
import type { EditorState } from "../model/store";
import type { DiagramNode } from "../model/types";
import { useEditor, useStore } from "./EditorContext";

/**
 * The outline.
 *
 * A mindmap *is* an outline, so this panel is not a layers list bolted on: it
 * walks the connector graph, which means the tree here matches the tree on the
 * canvas. Anything not reachable from a root (a loose sticky, a legend box) is
 * listed under "Unlinked" rather than hidden.
 */

const selectDoc = (s: EditorState) => s.doc;
const selectSelection = (s: EditorState) => s.selection;

interface OutlineRow {
    node: DiagramNode;
    depth: number;
    hasChildren: boolean;
}

export function OutlinePanel({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const store = useStore();
    const doc = useEditor(selectDoc);
    const selection = useEditor(selectSelection);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const page = useMemo(() => activePage(doc), [doc]);

    const { rows, unlinked } = useMemo(() => {
        const idx = graphIndex(page);
        const roots = page.nodes.filter(nd => (idx.in.get(nd.id) ?? []).length === 0);

        // Reachability is computed ignoring the panel's collapse state — a
        // collapsed branch is still part of the tree, just not shown, and
        // must not fall through into "Unlinked".
        const reachable = new Set<string>();
        const mark = (id: string) => {
            if (reachable.has(id)) return;
            reachable.add(id);
            for (const child of idx.out.get(id) ?? []) mark(child);
        };
        for (const root of roots) mark(root.id);

        const out: OutlineRow[] = [];
        const emitted = new Set<string>();
        const walk = (id: string, depth: number) => {
            if (emitted.has(id) || depth > 40) return;
            emitted.add(id);
            const node = nodeById(page, id);
            if (!node) return;
            const children = idx.out.get(id) ?? [];
            out.push({ node, depth, hasChildren: children.length > 0 });
            if (collapsed.has(id)) return;
            for (const child of children) walk(child, depth + 1);
        };
        for (const root of roots) walk(root.id, 0);

        return { rows: out, unlinked: page.nodes.filter(nd => !reachable.has(nd.id)) };
    }, [collapsed, page]);

    const selectedIds = useMemo(
        () => new Set(selection.filter(s => s.kind === "node").map(s => s.id)),
        [selection]
    );

    const toggle = (id: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const renderRow = (row: OutlineRow) => {
        const { node, depth, hasChildren } = row;
        const isCollapsed = collapsed.has(node.id);
        return (
            <div
                key={node.id}
                className={cn(
                    "group flex items-center gap-1 rounded-md py-1 pr-1 text-[12px] transition-colors",
                    selectedIds.has(node.id)
                        ? "bg-brand-soft text-brand-ink"
                        : "text-ink-2 hover:bg-panel-2"
                )}
                style={{ paddingLeft: 4 + depth * 12 }}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => toggle(node.id)}
                        className="text-ink-3 flex size-4 shrink-0 items-center justify-center"
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                    >
                        {isCollapsed ? (
                            <ChevronRight className="size-3" />
                        ) : (
                            <ChevronDown className="size-3" />
                        )}
                    </button>
                ) : (
                    <span className="size-4 shrink-0" />
                )}

                <button
                    type="button"
                    onClick={() => focusNode(store, node.id, canvasSize)}
                    className="flex-1 truncate text-left"
                    title={trimmedOr(node.text, shapeDef(node.shape).name)}
                >
                    {nonEmpty(node.text.split("\n")[0]) ?? (
                        <span className="text-ink-3 italic">{shapeDef(node.shape).name}</span>
                    )}
                </button>

                <button
                    type="button"
                    aria-label={node.hidden ? "Show" : "Hide"}
                    onClick={() =>
                        store.updatePage(
                            p => mapNodes(p, [node.id], nd => ({ ...nd, hidden: !nd.hidden })),
                            { label: node.hidden ? "Show" : "Hide" }
                        )
                    }
                    className={cn(
                        "text-ink-3 hover:text-ink-2 shrink-0 transition-opacity",
                        node.hidden ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                >
                    {node.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
                <button
                    type="button"
                    aria-label={node.locked ? "Unlock" : "Lock"}
                    onClick={() =>
                        store.updatePage(
                            p => mapNodes(p, [node.id], nd => ({ ...nd, locked: !nd.locked })),
                            { label: node.locked ? "Unlock" : "Lock" }
                        )
                    }
                    className={cn(
                        "text-ink-3 hover:text-ink-2 shrink-0 transition-opacity",
                        node.locked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                >
                    {node.locked ? (
                        <Lock className="size-3.5" />
                    ) : (
                        <LockOpen className="size-3.5" />
                    )}
                </button>
            </div>
        );
    };

    return (
        <ScrollArea className="h-full">
            <div className="px-2 py-2">
                {rows.length === 0 && unlinked.length === 0 && (
                    <p className="text-ink-3 px-2 py-6 text-center text-[13px]">
                        Nothing on this page yet. Double-click the canvas to start.
                    </p>
                )}
                {rows.map(renderRow)}
                {unlinked.length > 0 && (
                    <>
                        <h4 className="text-ink-3 mb-1 mt-3 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                            Unlinked
                        </h4>
                        {unlinked.map(node => renderRow({ node, depth: 0, hasChildren: false }))}
                    </>
                )}
            </div>
        </ScrollArea>
    );
}
