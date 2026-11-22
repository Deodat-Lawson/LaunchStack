"use client";

import React, { useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ClipboardPaste, Keyboard, ListOrdered, MousePointerClick } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { activePage } from "../model/doc";
import { KINDS } from "../model/flowchart/look";
import { isDarkSurface } from "../model/palette";
import type { EditorState } from "../model/store";
import styles from "../ui/Canvas.module.css";
import { useCommittedDoc, useEditor, useStore } from "../ui/EditorContext";
import { startChart } from "./keys/actions";
import { setFirstStepAt } from "./keys/env";
import { keyCap } from "./keys/KeyLegend";
import { usePickMenu } from "./pick/usePickMenu";
import { focusStepsPanel } from "./steps/StepsPanel";

/**
 * A blank flowchart: the three ways to start it, in one card.
 *
 * - **Start typing** — a ghost of the first step, drawn as big as the real
 *   one will be and exactly where it will land, with a caret in it. Any
 *   character starts the chart with that character in the box (`keys.ts`);
 *   clicking the ghost starts it empty.
 * - **Double-click** anywhere to pick a shape (the "What goes here?" menu).
 * - **Write the steps** in the panel — this opens it and puts the caret there.
 *
 * Below them, the keys that grow the chart. The card is opaque, in the
 * paper's own colours (`.paper` + `data-paper`, as the canvas does), so it
 * reads on a light or a dark board whatever the app's theme. Gone while the
 * menu is open, so the preview of the first box is not drawn under it.
 */

const selectZoom = (s: EditorState) => s.viewport.zoom;

const KEYS = ["next", "branch", "decision"] as const;

export function EmptyFlowHint({ onPasteOutline }: { onPasteOutline: () => void }) {
    const t = useTranslations("mindmap.flow.empty");
    const store = useStore();
    const doc = useCommittedDoc();
    const zoom = useEditor(selectZoom);
    const menu = usePickMenu(store);
    const ghost = useRef<HTMLButtonElement | null>(null);
    const dark = isDarkSurface(activePage(doc).background.color);
    const size = KINDS.process!.size;

    // Type-to-start lands the first box on the ghost: publish where it is, in
    // px from the canvas's top-left, after every layout.
    useLayoutEffect(() => {
        const el = ghost.current;
        const svg = el?.closest("[data-mindmap-stage]")?.querySelector("svg");
        if (!el || !svg) return;
        const a = el.getBoundingClientRect();
        const b = svg.getBoundingClientRect();
        setFirstStepAt(store, {
            x: a.left - b.left + a.width / 2,
            y: a.top - b.top + a.height / 2,
        });
    });
    useLayoutEffect(() => () => setFirstStepAt(store, null), [store]);

    if (menu) return null;

    return (
        <div
            data-export="omit"
            data-flow-empty=""
            data-paper={dark ? "dark" : "light"}
            className={cn(
                styles.paper,
                "pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4"
            )}
        >
            <section
                data-flow-empty-card=""
                aria-label={t("title")}
                className="border-line bg-panel pointer-events-auto flex max-w-full flex-col items-center gap-4 rounded-2xl border px-7 pb-4 pt-5 shadow-sm"
            >
                <h2 className="text-ink text-[15px] font-medium">{t("title")}</h2>

                {/* As big as the first box, and where it will land. */}
                <Button
                    ref={ghost}
                    type="button"
                    variant="ghost"
                    onClick={() => startChart(store)}
                    aria-label={t("ghost")}
                    style={{ width: size.w * zoom, height: size.h * zoom }}
                    className="border-brand/60 hover:border-brand hover:bg-brand/5 rounded-[12px] border-[1.5px] border-dashed p-0"
                >
                    <span
                        aria-hidden
                        style={{ height: 15 * 1.35 * zoom }}
                        className="bg-brand inline-block w-[1.5px] animate-pulse motion-reduce:animate-none"
                    />
                </Button>

                <ul className="text-ink-2 grid gap-1.5 text-[13px]">
                    <li className="flex items-center gap-2.5">
                        <Keyboard className="text-ink-3 size-4 shrink-0" />
                        {t("type")}
                    </li>
                    <li className="flex items-center gap-2.5">
                        <MousePointerClick className="text-ink-3 size-4 shrink-0" />
                        {t("doubleClick")}
                    </li>
                    <li className="flex items-center gap-2.5">
                        <ListOrdered className="text-ink-3 size-4 shrink-0" />
                        <button
                            type="button"
                            onClick={() => focusStepsPanel(store)}
                            className="text-brand underline-offset-4 hover:underline"
                        >
                            {t("write")}
                        </button>
                    </li>
                </ul>

                <p className="text-ink-3 border-line flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t pt-3 text-[12px]">
                    {KEYS.map((key, i) => (
                        <React.Fragment key={key}>
                            {i > 0 && <span className="text-ink-4">·</span>}
                            <span className="flex items-center gap-1.5">
                                {t.rich(`keys.${key}`, { key: keyCap })}
                            </span>
                        </React.Fragment>
                    ))}
                </p>

                <button
                    type="button"
                    onClick={onPasteOutline}
                    className="text-ink-3 hover:text-brand -mt-1 flex items-center gap-1.5 text-[12px] underline-offset-4 hover:underline"
                >
                    <ClipboardPaste className="size-3.5" />
                    {t("paste")}
                </button>
            </section>
        </div>
    );
}
