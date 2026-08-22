"use client";

import React, { memo, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import { SHAPES, SHAPE_CATEGORIES, shapeGeometry, type ShapeDef } from "../model/shapes";
import type { EditorState } from "../model/store";
import type { ShapeCategory, ShapeId } from "../model/types";
import { useEditor, useStore } from "./EditorContext";

/**
 * The shape library.
 *
 * Previews are generated from the same `shapeGeometry` the canvas uses, so a
 * thumbnail can never show a shape the canvas would draw differently. Clicking
 * arms the shape tool; dragging drops it straight onto the canvas at the
 * pointer (handled by the editor shell's drop target).
 */

const selectPending = (s: EditorState) => (s.tool === "shape" ? s.pendingShape : null);

export function ShapePalette() {
    const store = useStore();
    const pending = useEditor(selectPending);
    const [query, setQuery] = useState("");

    const grouped = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matches = q
            ? SHAPES.filter(
                  s =>
                      s.name.toLowerCase().includes(q) ||
                      s.id.includes(q) ||
                      s.keywords.some(k => k.includes(q))
              )
            : SHAPES;
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

            <ScrollArea className="flex-1">
                <div className="px-3 pb-6 pt-3">
                    {grouped.length === 0 && (
                        <p className="text-ink-3 px-1 py-6 text-center text-[13px]">
                            No shapes match “{query}”.
                        </p>
                    )}
                    {grouped.map(group => (
                        <section key={group.category} className="mb-4">
                            <h3 className="text-ink-3 mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                                {group.category}
                            </h3>
                            <div className="grid grid-cols-4 gap-1">
                                {group.shapes.map(shape => (
                                    <ShapeTile
                                        key={shape.id}
                                        shape={shape}
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
    active,
    onSelect,
}: {
    shape: ShapeDef;
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
                "flex aspect-square items-center justify-center rounded-md border transition-colors",
                active
                    ? "border-brand bg-brand-soft"
                    : "hover:border-line hover:bg-panel-2 border-transparent"
            )}
        >
            <ShapePreview shapeId={shape.id} />
        </button>
    );
});

/** Small outline preview, drawn from the real shape geometry. */
export function ShapePreview({ shapeId, size = 1 }: { shapeId: ShapeId; size?: number }) {
    const w = TILE_W * size;
    const h = TILE_H * size;
    const geometry = useMemo(() => shapeGeometry(shapeId, w - 8, h - 8, 4), [shapeId, w, h]);

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
            <g transform="translate(4 4)">
                {geometry.backing?.map((d, i) => (
                    <path
                        key={`b${i}`}
                        d={d}
                        fill="var(--panel-2)"
                        stroke="var(--ink-3)"
                        strokeWidth={1}
                    />
                ))}
                {geometry.path ? (
                    <path
                        d={geometry.path}
                        fill="var(--panel-2)"
                        stroke="var(--ink-2)"
                        strokeWidth={1.2}
                        strokeLinejoin="round"
                    />
                ) : null}
                {geometry.decorations?.map((d, i) => (
                    <path
                        key={`d${i}`}
                        d={d}
                        fill="none"
                        stroke="var(--ink-2)"
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
