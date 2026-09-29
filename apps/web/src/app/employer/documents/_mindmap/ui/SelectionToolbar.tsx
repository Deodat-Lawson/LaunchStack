"use client";

import React from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import {
    addChildTopic,
    applySwatch,
    deleteSelection,
    docMode,
    styleTextSelection,
} from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { nodesBounds, worldToScreen } from "../model/geometry";
import { SWATCHES, swatchFor } from "../model/palette";
import type { EditorState } from "../model/store";
import type { DiagramNode } from "../model/types";
import { useEditor, useStore } from "./EditorContext";

/**
 * The toolbar that sits on the selection.
 *
 * Focus depth has no inspector, so the handful of things people change all
 * the time — add a child, recolour, resize the text, delete — live here, a
 * few pixels above the shape they apply to, rather than in a panel across the
 * screen. "More" opens the full inspector for everything else.
 *
 * Positioned from the live document (not the committed one) so it follows a
 * shape mid-drag instead of snapping to it afterwards.
 */

const selectDoc = (s: EditorState) => s.doc;
const selectSelection = (s: EditorState) => s.selection;
const selectViewport = (s: EditorState) => s.viewport;
const selectDepth = (s: EditorState) => s.chromeDepth;
const selectPresenting = (s: EditorState) => s.presenting;

const TOOLBAR_HEIGHT = 36;
const GAP = 10;

export function SelectionToolbar({ onMore }: { onMore: () => void }) {
    const store = useStore();
    const doc = useEditor(selectDoc);
    const selection = useEditor(selectSelection);
    const viewport = useEditor(selectViewport);
    const depth = useEditor(selectDepth);
    const presenting = useEditor(selectPresenting);

    if (depth !== "focus" || presenting) return null;

    const page = activePage(doc);
    const nodes = selection
        .filter(s => s.kind === "node")
        .map(s => nodeById(page, s.id))
        .filter((nd): nd is DiagramNode => nd !== null && nd !== undefined);
    if (nodes.length === 0) return null;

    const bounds = nodesBounds(nodes);
    if (!bounds) return null;

    const top = worldToScreen(viewport, { x: bounds.x + bounds.w / 2, y: bounds.y });
    const bottom = worldToScreen(viewport, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h });
    // Above the shape unless that would leave the stage; then below it.
    const above = top.y - TOOLBAR_HEIGHT - GAP >= 6;
    const y = above ? top.y - TOOLBAR_HEIGHT - GAP : bottom.y + GAP;

    const first = nodes[0]!;
    const size = first.textStyle.size;
    const mode = docMode(store);

    return (
        <div
            role="toolbar"
            aria-label="Selection"
            data-export="omit"
            className="border-line bg-panel text-ink absolute z-20 flex h-9 -translate-x-1/2 items-center gap-0.5 rounded-lg border px-1 shadow-md"
            style={{ left: top.x, top: y }}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
        >
            <Tip label="Add child" hint="Tab">
                <button
                    type="button"
                    onClick={() => addChildTopic(store, first.id)}
                    className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex size-7 items-center justify-center rounded-md transition-colors"
                    aria-label="Add child topic"
                >
                    <Plus className="size-4" />
                </button>
            </Tip>

            <span className="bg-line mx-0.5 h-5 w-px" />

            <div className="flex items-center gap-1 px-1" role="group" aria-label="Colour">
                {SWATCHES.slice(0, 8).map(sw => {
                    const tone = swatchFor(sw.id, mode);
                    const active = first.style.stroke === tone.stroke;
                    return (
                        <Tip key={sw.id} label={sw.name}>
                            <button
                                type="button"
                                onClick={() => applySwatch(store, sw.id)}
                                aria-label={sw.name}
                                aria-pressed={active}
                                className={cn(
                                    "size-4 rounded-full border transition-transform hover:scale-110",
                                    active ? "ring-brand ring-2 ring-offset-1" : "border-black/10"
                                )}
                                // Diagram colours are document data, not tokens (README).
                                style={{ background: tone.stroke }}
                            />
                        </Tip>
                    );
                })}
            </div>

            <span className="bg-line mx-0.5 h-5 w-px" />

            <Tip label="Smaller text">
                <button
                    type="button"
                    onClick={() =>
                        styleTextSelection(store, { size: Math.max(9, size - 2) }, "Font size")
                    }
                    className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[11px] font-semibold transition-colors"
                    aria-label="Smaller text"
                >
                    A−
                </button>
            </Tip>
            <Tip label="Larger text">
                <button
                    type="button"
                    onClick={() =>
                        styleTextSelection(store, { size: Math.min(48, size + 2) }, "Font size")
                    }
                    className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[13px] font-semibold transition-colors"
                    aria-label="Larger text"
                >
                    A+
                </button>
            </Tip>

            <span className="bg-line mx-0.5 h-5 w-px" />

            <Tip label="Delete" hint="⌫">
                <button
                    type="button"
                    onClick={() => deleteSelection(store)}
                    className="text-ink-2 hover:bg-danger/10 hover:text-danger flex size-7 items-center justify-center rounded-md transition-colors"
                    aria-label="Delete"
                >
                    <Trash2 className="size-4" />
                </button>
            </Tip>
            <Tip label="Everything else">
                <button
                    type="button"
                    onClick={onMore}
                    className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex size-7 items-center justify-center rounded-md transition-colors"
                    aria-label="More options"
                >
                    <MoreHorizontal className="size-4" />
                </button>
            </Tip>
        </div>
    );
}

function Tip({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side="top">
                <span className="font-medium">{label}</span>
                {hint ? <span className="text-ink-3 ml-2">{hint}</span> : null}
            </TooltipContent>
        </Tooltip>
    );
}
