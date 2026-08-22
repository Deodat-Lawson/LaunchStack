"use client";

import React, { useMemo, useRef } from "react";

import { activePage, pageBounds, visibleNodes } from "../model/doc";
import { expandRect, nodeBounds } from "../model/geometry";
import type { EditorState } from "../model/store";
import type { Rect } from "../model/types";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * Minimap.
 *
 * Shapes are drawn as flat blocks in their own fill colour rather than through
 * the real renderer — at 180px wide a rounded corner or a text label is noise,
 * and running the full shape registry on every pan would be wasteful.
 */

const WIDTH = 184;
const HEIGHT = 124;

const selectViewport = (s: EditorState) => s.viewport;

export function Minimap({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const store = useStore();
    const doc = useCommittedDoc();
    const viewport = useEditor(selectViewport);
    const ref = useRef<SVGSVGElement | null>(null);

    const page = useMemo(() => activePage(doc), [doc]);
    const nodes = useMemo(() => visibleNodes(page), [page]);

    const viewRect: Rect = useMemo(
        () => ({
            x: viewport.x,
            y: viewport.y,
            w: Math.max(canvasSize.w, 1) / viewport.zoom,
            h: Math.max(canvasSize.h, 1) / viewport.zoom,
        }),
        [canvasSize.h, canvasSize.w, viewport.x, viewport.y, viewport.zoom]
    );

    // The world the minimap shows is content ∪ viewport, so the indicator can
    // never leave the frame even when the user pans into empty space.
    const world = useMemo(() => {
        const content = pageBounds(page);
        const union = content
            ? {
                  x: Math.min(content.x, viewRect.x),
                  y: Math.min(content.y, viewRect.y),
                  w:
                      Math.max(content.x + content.w, viewRect.x + viewRect.w) -
                      Math.min(content.x, viewRect.x),
                  h:
                      Math.max(content.y + content.h, viewRect.y + viewRect.h) -
                      Math.min(content.y, viewRect.y),
              }
            : viewRect;
        return expandRect(union, Math.max(union.w, union.h) * 0.05);
    }, [page, viewRect]);

    const scale = Math.min(WIDTH / Math.max(world.w, 1), HEIGHT / Math.max(world.h, 1));
    const offsetX = (WIDTH - world.w * scale) / 2;
    const offsetY = (HEIGHT - world.h * scale) / 2;
    const toMini = (x: number, y: number) => ({
        x: (x - world.x) * scale + offsetX,
        y: (y - world.y) * scale + offsetY,
    });

    const jumpTo = (clientX: number, clientY: number) => {
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        const worldX = (clientX - box.left - offsetX) / scale + world.x;
        const worldY = (clientY - box.top - offsetY) / scale + world.y;
        store.setViewport({
            x: worldX - viewRect.w / 2,
            y: worldY - viewRect.h / 2,
        });
    };

    const indicator = toMini(viewRect.x, viewRect.y);

    return (
        <svg
            ref={ref}
            width={WIDTH}
            height={HEIGHT}
            className="border-line bg-panel shadow-1 cursor-pointer rounded-lg border"
            onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                jumpTo(e.clientX, e.clientY);
            }}
            onPointerMove={e => {
                if (e.buttons === 1) jumpTo(e.clientX, e.clientY);
            }}
            aria-label="Minimap"
        >
            {nodes.map(node => {
                const b = nodeBounds(node);
                const p = toMini(b.x, b.y);
                return (
                    <rect
                        key={node.id}
                        x={p.x}
                        y={p.y}
                        width={Math.max(b.w * scale, 1.5)}
                        height={Math.max(b.h * scale, 1.5)}
                        rx={1}
                        fill={node.style.fill === "none" ? "var(--line)" : node.style.fill}
                        stroke={node.style.stroke === "none" ? "none" : node.style.stroke}
                        strokeWidth={0.5}
                        opacity={0.9}
                    />
                );
            })}
            <rect
                x={indicator.x}
                y={indicator.y}
                width={viewRect.w * scale}
                height={viewRect.h * scale}
                fill="var(--accent)"
                fillOpacity={0.1}
                stroke="var(--accent)"
                strokeWidth={1.5}
                rx={2}
            />
        </svg>
    );
}
