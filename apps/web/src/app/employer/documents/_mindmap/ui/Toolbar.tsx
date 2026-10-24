"use client";

import React from "react";
import { useTranslations } from "next-intl";
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
    RectangleHorizontal,
    StickyNote,
    Type,
    type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

import type { ChromeDepth, EditorState } from "../model/store";
import type { DiagramKind, ShapeId, ToolId } from "../model/types";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

import { useEditor, useStore } from "./EditorContext";
import { ShapePalette } from "./ShapePalette";

/**
 * The tool strip.
 *
 * Vertical and always visible, so switching tools never costs a trip through a
 * menu. Each entry mirrors a single-key shortcut from `useKeyboard` — the
 * tooltip states it, which is how people graduate from clicking to typing.
 */

type ToolKey =
    | "select"
    | "hand"
    | "topic"
    | "connector"
    | "text"
    | "sticky"
    | "frame"
    | "ink"
    | "eraser"
    | "rectangle"
    | "ellipse"
    | "diamond";

/**
 * `id` names the tool in `mindmap.toolbar.tools`. `hint` is the key that
 * picks it; `hintKey` is a hint with words in it, from `toolbar.hints`.
 */
interface ToolEntry {
    id: ToolKey;
    tool: ToolId;
    shape?: ShapeId;
    Icon: LucideIcon;
    hint?: string;
    hintKey?: "hand" | "topic";
}

const TOOLS: readonly ToolEntry[] = [
    { id: "select", tool: "select", Icon: MousePointer2, hint: "V" },
    { id: "hand", tool: "hand", Icon: Hand, hintKey: "hand" },
    // The node and the connector are the two halves of "draw me a diagram", so
    // they sit together at the top rather than the topic hiding in the library.
    {
        id: "topic",
        tool: "shape",
        shape: "mind-branch",
        Icon: RectangleHorizontal,
        hintKey: "topic",
    },
    { id: "connector", tool: "connector", Icon: Spline, hint: "C" },
    { id: "text", tool: "text", Icon: Type, hint: "T" },
    { id: "sticky", tool: "sticky", Icon: StickyNote, hint: "N" },
    { id: "frame", tool: "frame", Icon: Frame, hint: "F" },
    { id: "ink", tool: "ink", Icon: PenLine, hint: "P" },
    { id: "eraser", tool: "eraser", Icon: Eraser, hint: "E" },
];

const QUICK_SHAPES: readonly ToolEntry[] = [
    { id: "rectangle", tool: "shape", shape: "rectangle", Icon: Square, hint: "R" },
    { id: "ellipse", tool: "shape", shape: "ellipse", Icon: Circle, hint: "O" },
    { id: "diamond", tool: "shape", shape: "diamond", Icon: Diamond, hint: "D" },
];

/**
 * Focus depth shows the tools this kind of diagram needs and nothing from the
 * others; the rest stay one click away behind "All shapes". Everything depth
 * shows the full rail regardless of kind.
 */
const TOOLSETS: Record<DiagramKind, ReadonlySet<ToolKey>> = {
    mindmap: new Set(["select", "topic", "connector", "text", "sticky"]),
    board: new Set(["select", "sticky", "text", "frame", "connector"]),
    flowchart: new Set(TOOLS.map(t => t.id)),
    freeform: new Set(TOOLS.map(t => t.id)),
};

const selectTool = (s: EditorState) => `${s.tool}:${s.pendingShape ?? ""}`;
const selectKind = (s: EditorState) => s.doc.settings.kind;

export function Toolbar({
    onOpenShapes,
    depth = "everything",
}: {
    onOpenShapes: () => void;
    depth?: ChromeDepth;
}) {
    const t = useTranslations("mindmap.toolbar");
    const store = useStore();
    const active = useEditor(selectTool);

    const isActive = (entry: ToolEntry) => active === `${entry.tool}:${entry.shape ?? ""}`;
    const kind = useEditor(selectKind);
    const focus = depth === "focus";
    const tools = focus ? TOOLS.filter(t => TOOLSETS[kind].has(t.id)) : TOOLS;

    return (
        // The editor is pinned to the viewport, so on a short window this strip
        // is the first thing that runs out of room. Scrolling it keeps every
        // tool reachable; without `shrink-0` on the buttons flex would instead
        // squash 13 icons into whatever height is left.
        <div className="border-line bg-panel flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-r px-1.5 py-2">
            {tools.map(entry => (
                <ToolButton
                    key={entry.id}
                    entry={entry}
                    active={isActive(entry)}
                    onClick={() => store.setTool(entry.tool, entry.shape ?? null)}
                />
            ))}

            <div className="bg-line my-1 h-px w-6 shrink-0" />

            {!focus &&
                QUICK_SHAPES.map(entry => (
                    <ToolButton
                        key={entry.id}
                        entry={entry}
                        active={isActive(entry)}
                        onClick={() => store.setTool(entry.tool, entry.shape ?? null)}
                    />
                ))}

            {focus ? (
                // No side panel in focus depth, so the library opens beside the
                // rail instead — one click, and the canvas keeps its width.
                <Popover>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex size-9 shrink-0 items-center justify-center rounded-md transition-colors"
                                    aria-label={t("allShapes")}
                                >
                                    <Shapes className="size-[18px]" />
                                </button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right">{t("allShapes")}</TooltipContent>
                    </Tooltip>
                    <PopoverContent
                        side="right"
                        align="start"
                        className="flex h-[460px] w-[300px] flex-col p-0"
                    >
                        <ShapePalette />
                    </PopoverContent>
                </Popover>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={onOpenShapes}
                            className="text-ink-2 hover:bg-brand-soft hover:text-brand-ink flex size-9 shrink-0 items-center justify-center rounded-md transition-colors"
                            aria-label={t("allShapes")}
                        >
                            <Shapes className="size-[18px]" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{t("allShapes")}</TooltipContent>
                </Tooltip>
            )}
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
    const t = useTranslations("mindmap.toolbar");
    const { Icon } = entry;
    const label = t(`tools.${entry.id}`);
    const hint = entry.hintKey ? t(`hints.${entry.hintKey}`) : entry.hint;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    aria-pressed={active}
                    aria-label={label}
                    className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors",
                        active
                            ? "bg-brand text-brand-fg"
                            : "text-ink-2 hover:bg-brand-soft hover:text-brand-ink"
                    )}
                >
                    <Icon className="size-[18px]" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="right">
                <span className="font-medium">{label}</span>
                <span className="text-ink-3 ml-2">{hint}</span>
            </TooltipContent>
        </Tooltip>
    );
}
