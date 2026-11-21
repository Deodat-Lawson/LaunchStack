"use client";

import React, { useRef } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { activePage } from "../../model/doc";
import { screenToWorld } from "../../model/geometry";
import { isDarkSurface, type ThemeMode } from "../../model/palette";
import { shapeGeometry } from "../../model/shapes";
import type { EditorState } from "../../model/store";
import styles from "../../ui/Canvas.module.css";
import { useCommittedDoc, useEditor, useStore } from "../../ui/EditorContext";
import { boardMode } from "../looks";
import { kindColours } from "./look";
import { openAt } from "./menu";
import { usePickMenu } from "./usePickMenu";

const selectViewport = (s: EditorState) => s.viewport;

/**
 * Where the canvas's <svg> sits inside the stage, px — rulers can push it
 * down and right, and a stage point has to be turned into a board point.
 */
function svgOffset(el: HTMLElement | null): { x: number; y: number } {
    const stage = el?.closest("[data-mindmap-stage]");
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) return { x: 0, y: 0 };
    const a = svg.getBoundingClientRect();
    const b = stage.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top };
}

/**
 * The empty page (C5): the gesture in one line and a picture of it, and a
 * button that opens the pick menu in the middle of the board. Painted in the
 * paper's colours, like the canvas under it; gone while the menu is open, so
 * the preview of the first box is not drawn over these words.
 */
export function EmptyHint({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const t = useTranslations("mindmap.variants.c");
    const store = useStore();
    const menu = usePickMenu(store);
    const doc = useCommittedDoc();
    const viewport = useEditor(selectViewport);
    const ref = useRef<HTMLDivElement | null>(null);

    if (menu) return null;
    const page = activePage(doc);
    const mode = boardMode(doc);

    const start = () => {
        const screen = { x: canvasSize.w / 2, y: canvasSize.h / 2 };
        const off = svgOffset(ref.current);
        const world = screenToWorld(viewport, { x: screen.x - off.x, y: screen.y - off.y });
        openAt(store, { world, screen });
    };

    return (
        <div
            ref={ref}
            data-c-empty=""
            data-export="omit"
            data-paper={isDarkSurface(page.background.color) ? "dark" : "light"}
            className={cn(
                styles.paper,
                "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-4 text-center"
            )}
        >
            <Picture mode={mode} />
            <div className="flex flex-col items-center gap-1">
                <p className="text-ink text-[15px]">{t("empty.title")}</p>
                <p className="text-ink-2 text-[13px]">{t("empty.body")}</p>
            </div>
            <Button
                type="button"
                variant="ghost"
                onClick={start}
                className="border-brand/50 text-brand hover:border-brand hover:bg-brand/10 hover:text-brand pointer-events-auto h-10 rounded-xl border-2 border-dashed px-5 text-[14px]"
            >
                <Plus />
                {t("empty.start")}
            </Button>
        </div>
    );
}

/**
 * The gesture, drawn: a step, an arrow pulled out of it, and the decision
 * waiting at its end — in this board's own colours.
 */
function Picture({ mode }: { mode: ThemeMode }) {
    const step = kindColours("process", mode).fill;
    const decision = kindColours("decision", mode).fill;
    const box = shapeGeometry("process", 72, 32, 8).path;
    const diamond = shapeGeometry("decision", 64, 44, 0).path;
    return (
        <svg width={208} height={56} viewBox="0 0 208 56" aria-hidden className="overflow-visible">
            <g className="drop-shadow-sm">
                <path d={box} transform="translate(4 12)" fill={step} />
            </g>
            <path
                d="M 78 28 C 104 28, 108 28, 128 28"
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeDasharray="5 4"
            />
            <path d="M 138 28 L 128 23 L 130.5 28 L 128 33 Z" fill="var(--accent)" />
            <g transform="translate(140 6)">
                <path d={diamond} fill={decision} fillOpacity={0.6} />
                <path
                    d={diamond}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                />
            </g>
            <circle
                cx={78}
                cy={28}
                r={4}
                fill="var(--panel)"
                stroke="var(--accent)"
                strokeWidth={2}
            />
        </svg>
    );
}
