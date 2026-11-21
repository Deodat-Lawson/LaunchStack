"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { activePage } from "../../model/doc";
import { isDarkSurface } from "../../model/palette";
import type { EditorState } from "../../model/store";
import styles from "../../ui/Canvas.module.css";
import { useCommittedDoc, useEditor, useStore } from "../../ui/EditorContext";
import { startChart } from "./actions";
import { STEP_SIZE } from "../../model/flowchart/arrange";
import { keyCap } from "./KeyLegend";

/**
 * A blank board, direction A: a ghost of the first step, drawn where and as
 * big as the real one will be, with a caret in it — "where do I type?" is
 * answered by typing. Any character starts the chart with that character
 * already in the box (`ui.tsx`); clicking the ghost starts it empty. Below
 * it, the three keys that grow the chart.
 *
 * Like the editor's own empty prompt it opts into the paper's colours
 * (`.paper` + `data-paper`), since it is drawn on the board, not on chrome.
 */

const selectZoom = (s: EditorState) => s.viewport.zoom;

const HINTS = ["next", "branch", "decision"] as const;

export function EmptyHint() {
    const t = useTranslations("mindmap.variants.a");
    const store = useStore();
    const doc = useCommittedDoc();
    const zoom = useEditor(selectZoom);
    const dark = isDarkSurface(activePage(doc).background.color);

    return (
        <div
            data-export="omit"
            data-flow-a-empty=""
            data-paper={dark ? "dark" : "light"}
            className={cn(
                styles.paper,
                "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center"
            )}
        >
            {/* The ghost sits exactly where, and as big as, the first box will. */}
            <div className="relative">
                <p className="text-ink-2 absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap text-[15px] font-medium">
                    {t("empty.prompt")}
                </p>
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => startChart(store)}
                    aria-label={t("empty.prompt")}
                    style={{ width: STEP_SIZE.w * zoom, height: STEP_SIZE.h * zoom }}
                    className="border-brand/60 hover:border-brand hover:bg-brand/5 pointer-events-auto rounded-[8px] border-[1.5px] border-dashed p-0"
                >
                    <span
                        aria-hidden
                        style={{ height: 14 * 1.35 * zoom }}
                        className="bg-brand inline-block w-[1.5px] animate-pulse motion-reduce:animate-none"
                    />
                </Button>
                <p className="text-ink-2 absolute left-1/2 top-full mt-5 flex w-max max-w-[min(90vw,640px)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[12.5px]">
                    {HINTS.map((hint, i) => (
                        <React.Fragment key={hint}>
                            {i > 0 && <span className="text-ink-4">·</span>}
                            <span className="flex items-center gap-1.5">
                                {t.rich(`empty.${hint}`, { key: keyCap })}
                            </span>
                        </React.Fragment>
                    ))}
                </p>
            </div>
        </div>
    );
}
