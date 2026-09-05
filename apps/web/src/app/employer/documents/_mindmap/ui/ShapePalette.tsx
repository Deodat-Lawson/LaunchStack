"use client";

import React, { memo, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import { createNode } from "../model/factory";
import { themeMode, type ThemeMode } from "../model/palette";
import { SHAPE_CATEGORIES, searchShapes, shapeGeometry, type ShapeDef } from "../model/shapes";
import type { EditorState } from "../model/store";
import type { NodeStyle, ShapeCategory, ShapeId } from "../model/types";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * The shape library.
 *
 * Previews are generated from the same `shapeGeometry` *and* the same
 * `createNode` presets the canvas uses, so a thumbnail can never show a shape
 * the canvas would draw differently — a Topic looks like a Topic here, not
 * like the rounded rectangle it shares an outline with. Clicking arms the
 * shape tool; dragging drops it straight onto the canvas at the pointer
 * (handled by the editor shell's drop target).
 *
 * Every tile is captioned. Sixty untitled grey outlines is not a library, it
 * is a memory test — and the two shapes people most need to tell apart
 * (`Topic` and `Rounded rectangle`) are exactly the two an outline cannot
 * distinguish.
 */

const selectPending = (s: EditorState) => (s.tool === "shape" ? s.pendingShape : null);

/** Said once per group, where the grouping is doing real work. */
const CATEGORY_BLURB: Partial<Record<ShapeCategory, string>> = {
    Nodes: "Type in them, connect them, let auto-layout arrange them.",
    Annotate: "Marks on the canvas. Not part of the diagram's structure.",
};

export function ShapePalette() {
    const store = useStore();
    const pending = useEditor(selectPending);
    const doc = useCommittedDoc();
    const [query, setQuery] = useState("");

    // Previews carry the board's own theme, so a tile shows the colour you are
    // about to get rather than a light-mode idea of it.
    const mode = themeMode(doc.settings.paletteId);

    const grouped = useMemo(() => {
        const matches = searchShapes(query);
        const byCategory = new Map<ShapeCategory, ShapeDef[]>();
        for (const shape of matches) {
            const list = byCategory.get(shape.category);
            if (list) list.push(shape);
            else byCategory.set(shape.category, [shape]);
        }
        return SHAPE_CATEGORIES.map(category => ({
            category,
            shapes: byCategory.get(category) ?? [],
        })).filter(g => g.shapes.length > 0);
    }, [query]);

    return (
        <div className="flex h-full flex-col">
            <div className="border-line relative border-b px-3 py-2.5">
                <Search className="text-ink-3 pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2" />
                <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search shapes…"
                    className="h-8 pl-7 text-[13px]"
                />
            </div>

            <ScrollArea className="min-h-0 flex-1">
                <div className="px-3 pb-6 pt-3">
                    {grouped.length === 0 && (
                        <p className="text-ink-3 px-1 py-6 text-center text-[13px]">
                            No shapes match “{query}”.
                        </p>
                    )}
                    {grouped.map(group => (
                        <section key={group.category} className="mb-5">
                            <h3 className="text-ink-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                                {group.category}
                            </h3>
                            {CATEGORY_BLURB[group.category] && (
                                <p className="text-ink-3 mb-2 mt-0.5 text-[11px] leading-snug">
                                    {CATEGORY_BLURB[group.category]}
                                </p>
                            )}
                            <div
                                className={cn(
                                    "grid grid-cols-3 gap-1",
                                    !CATEGORY_BLURB[group.category] && "mt-2"
                                )}
                            >
                                {group.shapes.map(shape => (
                                    <ShapeTile
                                        key={shape.id}
                                        shape={shape}
                                        mode={mode}
                                        active={pending === shape.id}
                                        onSelect={() => store.setTool("shape", shape.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

const TILE_W = 44;
const TILE_H = 32;

const ShapeTile = memo(function ShapeTile({
    shape,
    mode,
    active,
    onSelect,
}: {
    shape: ShapeDef;
    mode: ThemeMode;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            title={shape.name}
            aria-label={shape.name}
            aria-pressed={active}
            draggable
            onDragStart={e => {
                e.dataTransfer.setData("application/x-launchstack-shape", shape.id);
                e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={onSelect}
            className={cn(
                "flex flex-col items-center gap-1 rounded-md border px-1 pb-1 pt-1.5 transition-colors",
                active
                    ? "border-brand bg-brand-soft"
                    : "hover:border-line hover:bg-panel-2 border-transparent"
            )}
        >
            <ShapePreview shapeId={shape.id} mode={mode} />
            {/* Two lines rather than an ellipsis: "Rounded rect…" and
                "Predefined pro…" are the names most in need of reading. */}
            <span className="text-ink-3 line-clamp-2 w-full text-center text-[10px] leading-tight">
                {shape.name}
            </span>
        </button>
    );
});

/**
 * The style a freshly created node of this shape gets. Read from `createNode`
 * rather than restated, so the swatch on the tile is the colour that will
 * land on the canvas. Cached because `createNode` mints an id each call.
 */
const previewStyleCache = new Map<string, { style: NodeStyle }>();
function previewStyle(shapeId: ShapeId, mode: ThemeMode): { style: NodeStyle } {
    const key = `${shapeId}:${mode}`;
    let cached = previewStyleCache.get(key);
    if (!cached) {
        cached = { style: createNode({ shape: shapeId, mode, x: 0, y: 0 }).style };
        previewStyleCache.set(key, cached);
    }
    return cached;
}

/** Small preview, drawn from the real shape geometry and its real preset. */
export function ShapePreview({
    shapeId,
    mode = "light",
    size = 1,
}: {
    shapeId: ShapeId;
    mode?: ThemeMode;
    size?: number;
}) {
    const w = TILE_W * size;
    const h = TILE_H * size;
    const geometry = useMemo(() => shapeGeometry(shapeId, w - 8, h - 8, 4), [shapeId, w, h]);
    const { style } = previewStyle(shapeId, mode);

    // A tile sits on the panel, not on the board, so an unfilled or unstroked
    // preset falls back to *chrome* ink rather than the document's. Painting
    // the board's paper behind each preview was the faithful alternative and
    // looked like sixty loose cards; the theme still shows through every
    // shape that has a fill of its own.
    const fill = style.fill === "none" ? "var(--panel-2)" : style.fill;
    const stroke = style.stroke === "none" ? "var(--ink-3)" : style.stroke;

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
            <g transform="translate(4 4)">
                {geometry.backing?.map((d, i) => (
                    <path key={`b${i}`} d={d} fill={fill} stroke={stroke} strokeWidth={1} />
                ))}
                {geometry.path ? (
                    <path
                        d={geometry.path}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={1.2}
                        strokeLinejoin="round"
                    />
                ) : null}
                {geometry.decorations?.map((d, i) => (
                    <path
                        key={`d${i}`}
                        d={d}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={1.2}
                        strokeLinecap="round"
                    />
                ))}
                {!geometry.path && !geometry.decorations?.length && (
                    <text
                        x={(w - 8) / 2}
                        y={(h - 8) / 2 + 4}
                        textAnchor="middle"
                        fontSize={12}
                        fill="var(--ink-2)"
                    >
                        T
                    </text>
                )}
            </g>
        </svg>
    );
}
