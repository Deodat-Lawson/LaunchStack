"use client";

import React, { useMemo } from "react";

import { docMode } from "../../model/commands";
import { nodeById } from "../../model/doc";
import { routeEdge } from "../../model/routing";
import { shapeGeometry } from "../../model/shapes";
import type { EditorState } from "../../model/store";
import type { DiagramEdge } from "../../model/types";
import { EdgeView } from "../../ui/EdgeView";
import { useEditor, usePage, useStore } from "../../ui/EditorContext";
import { flowchartLook } from "../../model/flowchart/look";
import { menuPicks } from "./menu";
import { planPick } from "./place";
import { usePickMenu } from "./usePickMenu";

const selectZoom = (s: EditorState) => s.viewport.zoom;

/**
 * While the pick menu is open, what a pick would add, drawn on the board:
 * the arrow from the box it came out of (dashed, routed exactly as the real
 * one will be) and the outline of the highlighted shape where it will land
 * — or, for "Just the arrow", the arrow alone.
 * Moving through the menu moves the preview with it. Chrome, not document:
 * it lives in the canvas's chrome layer and is never exported.
 */
export function GhostLayer() {
    const store = useStore();
    const menu = usePickMenu(store);
    const page = usePage();
    const zoom = useEditor(selectZoom);

    const plan = useMemo(() => {
        if (!menu || menu.pageId !== page.id) return null;
        const source = menu.sourceId ? (nodeById(page, menu.sourceId) ?? null) : null;
        if (menu.sourceId && !source) return null;
        const picks = menuPicks(menu);
        const choice = picks[menu.active] ?? picks[0]!;
        return planPick(flowchartLook, docMode(store), source, menu.at, choice);
    }, [menu, page, store]);

    const routed = useMemo(() => {
        if (!plan?.edge) return null;
        const ghost = plan.node;
        const lookup = (id: string) => (ghost && id === ghost.id ? ghost : nodeById(page, id));
        return routeEdge(plan.edge, lookup);
    }, [plan, page]);

    if (!plan) return null;
    const px = (v: number) => v / zoom;
    const node = plan.node;
    const path = node ? shapeGeometry(node.shape, node.w, node.h, node.style.radius).path : null;
    const edge: DiagramEdge | null = plan.edge
        ? {
              ...plan.edge,
              style: { ...plan.edge.style, stroke: "var(--accent)", strokeStyle: "dashed" },
          }
        : null;

    return (
        <g data-pick-ghost="" data-export="omit" style={{ pointerEvents: "none" }}>
            {node && path ? (
                <g transform={`translate(${node.x} ${node.y})`}>
                    <path d={path} fill={node.style.fill} fillOpacity={0.6} stroke="none" />
                    <path
                        d={path}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth={px(1.5)}
                        strokeDasharray={`${px(6)} ${px(4)}`}
                        strokeLinejoin="round"
                    />
                </g>
            ) : null}
            {edge && routed ? (
                <EdgeView
                    edge={edge}
                    routed={routed}
                    selected={false}
                    hovered={false}
                    withLabels={false}
                />
            ) : null}
        </g>
    );
}
