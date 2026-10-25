"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ClipboardPaste } from "lucide-react";

import { cn } from "~/lib/utils";

import { insertShape, styleTextSelection } from "../model/commands";
import { activePage } from "../model/doc";
import { screenToWorld } from "../model/geometry";
import { isDarkSurface } from "../model/palette";
import type { EditorState } from "../model/store";
import styles from "./Canvas.module.css";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * What a blank canvas says.
 *
 * Nothing, today. This puts a ghost topic where the first one will go, and
 * the three keys that grow it, so the first question — "where do I type?" —
 * is answered on the canvas instead of in a side panel. Focus depth only, and
 * only while the page has no shapes; the first node removes it.
 *
 * It is HTML laid over the board rather than part of the <svg>, so it opts
 * into the paper's colours itself (`.paper` + `data-paper`, as the canvas
 * does). Painted in the app's theme instead, a dark-mode viewer got pale
 * violet on a cream board and a light-mode viewer dark violet on a black one.
 * Only `brand` (the paper's `--accent`) and the ink/line/panel names are
 * rebound — `brand-ink` and `brand-soft` are not, so they are not used here.
 */

/** The shape a mindmap's centre is drawn with. */
const CENTRAL_SHAPE = "mind-root";

const selectDepth = (s: EditorState) => s.chromeDepth;
const selectPresenting = (s: EditorState) => s.presenting;
const selectViewport = (s: EditorState) => s.viewport;

export function EmptyCanvasHint({
    canvasSize,
    onPasteOutline,
}: {
    canvasSize: { w: number; h: number };
    onPasteOutline: () => void;
}) {
    const t = useTranslations("mindmap.emptyCanvas");
    const store = useStore();
    const doc = useCommittedDoc();
    const depth = useEditor(selectDepth);
    const presenting = useEditor(selectPresenting);
    const viewport = useEditor(selectViewport);

    if (depth !== "focus" || presenting) return null;
    const page = activePage(doc);
    if (page.nodes.length > 0) return null;

    const start = () => {
        const at = screenToWorld(viewport, { x: canvasSize.w / 2, y: canvasSize.h / 2 });
        const id = insertShape(store, CENTRAL_SHAPE, at, { w: 210, h: 78 });
        styleTextSelection(store, { size: 18, bold: true, align: "center" }, "Central topic");
        store.setEditing({ kind: "node", id });
    };

    return (
        <div
            data-export="omit"
            data-paper={isDarkSurface(page.background.color) ? "dark" : "light"}
            className={cn(
                styles.paper,
                "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-5"
            )}
        >
            <button
                type="button"
                onClick={start}
                className="border-brand/50 text-brand hover:border-brand hover:bg-brand/10 pointer-events-auto rounded-xl border-2 border-dashed px-8 py-4 text-lg font-semibold transition-colors"
            >
                {t("start")}
            </button>

            <p className="text-ink-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-[12.5px]">
                <span>{t.rich("enter", { key })}</span>
                <span className="text-line">·</span>
                <span>{t.rich("tab", { key })}</span>
                <span className="text-line">·</span>
                <span>{t.rich("palette", { key })}</span>
            </p>

            <button
                type="button"
                onClick={onPasteOutline}
                className="text-ink-2 hover:text-brand pointer-events-auto flex items-center gap-1.5 text-[12.5px] underline-offset-4 hover:underline"
            >
                <ClipboardPaste className="size-3.5" />
                {t("paste")}
            </button>
        </div>
    );
}

const key = (chunks: React.ReactNode) => <Key>{chunks}</Key>;

function Key({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="border-line bg-panel text-ink-2 rounded border px-1.5 py-0.5 font-mono text-[11px]">
            {children}
        </kbd>
    );
}
