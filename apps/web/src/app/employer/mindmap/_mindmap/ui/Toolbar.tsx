"use client";

import React from "react";
import {
    Circle,
    Diamond,
    Eraser,
    Frame,
    Hand,
    MousePointer2,
    PenLine,
    Shapes,
    Spline,
    Square,
    StickyNote,
    Type,
    type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

import type { EditorState } from "../model/store";
import type { ShapeId, ToolId } from "../model/types";
import { useEditor, useStore } from "./EditorContext";

/**
 * The tool strip.
 *
 * Vertical and always visible, so switching tools never costs a trip through a
 * menu. Each entry mirrors a single-key shortcut from `useKeyboard` — the
 * tooltip states it, which is how people graduate from clicking to typing.
 */

interface ToolEntry {
    id: string;
    tool: ToolId;
    shape?: ShapeId;
    Icon: LucideIcon;
    label: string;
    hint: string;
}

const TOOLS: readonly ToolEntry[] = [
    { id: "select", tool: "select", Icon: MousePointer2, label: "Select", hint: "V" },
    { id: "hand", tool: "hand", Icon: Hand, label: "Pan", hint: "H · hold Space" },
    { id: "connector", tool: "connector", Icon: Spline, label: "Connector", hint: "C" },
    { id: "text", tool: "text", Icon: Type, label: "Text", hint: "T" },
    { id: "sticky", tool: "sticky", Icon: StickyNote, label: "Sticky note", hint: "N" },
    { id: "frame", tool: "frame", Icon: Frame, label: "Frame", hint: "F" },
    { id: "ink", tool: "ink", Icon: PenLine, label: "Pen", hint: "P" },
    { id: "eraser", tool: "eraser", Icon: Eraser, label: "Eraser", hint: "E" },
];

const QUICK_SHAPES: readonly ToolEntry[] = [
    {
        id: "rectangle",
        tool: "shape",
        shape: "rectangle",
        Icon: Square,
        label: "Rectangle",
        hint: "R",
    },
    { id: "ellipse", tool: "shape", shape: "ellipse", Icon: Circle, label: "Ellipse", hint: "O" },
    { id: "diamond", tool: "shape", shape: "diamond", Icon: Diamond, label: "Diamond", hint: "D" },
];

const selectTool = (s: EditorState) => `${s.tool}:${s.pendingShape ?? ""}`;

export function Toolbar({ onOpenShapes }: { onOpenShapes: () => void }) {
    const store = useStore();
    const active = useEditor(selectTool);

    const isActive = (entry: ToolEntry) => active === `${entry.tool}:${entry.shape ?? ""}`;

    return (
        <div className="border-line bg-panel flex flex-col items-center gap-1 border-r px-1.5 py-2">
            {TOOLS.map(entry => (
                <ToolButton
                    key={entry.id}
                    entry={entry}
                    active={isActive(entry)}
                    onClick={() => store.setTool(entry.tool, entry.shape ?? null)}
                />
            ))}

            <div className="bg-line my-1 h-px w-6" />

            {QUICK_SHAPES.map(entry => (
                <ToolButton
                    key={entry.id}
                    entry={entry}
                    active={isActive(entry)}
                    onClick={() => store.setTool(entry.tool, entry.shape ?? null)}
                />
            ))}

            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={onOpenShapes}
                        className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex size-9 items-center justify-center rounded-md transition-colors"
                        aria-label="All shapes"
                    >
                        <Shapes className="size-[18px]" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="right">All shapes</TooltipContent>
            </Tooltip>
        </div>
    );
}

function ToolButton({
    entry,
    active,
    onClick,
}: {
    entry: ToolEntry;
    active: boolean;
    onClick: () => void;
}) {
    const { Icon } = entry;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    aria-pressed={active}
                    aria-label={entry.label}
                    className={cn(
                        "flex size-9 items-center justify-center rounded-md transition-colors",
                        active
                            ? "bg-brand text-brand-fg"
                            : "text-ink-2 hover:bg-brand-soft hover:text-brand-ink"
                    )}
                >
                    <Icon className="size-[18px]" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="right">
                <span className="font-medium">{entry.label}</span>
                <span className="text-ink-3 ml-2">{entry.hint}</span>
            </TooltipContent>
        </Tooltip>
    );
}
