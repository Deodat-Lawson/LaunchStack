"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { activePage } from "../../model/doc";
import type { EditorState } from "../../model/store";
import { useEditor } from "../../ui/EditorContext";

/**
 * The keys that draw a chart, in the stage's bottom-left corner: Tab, ⇧Tab,
 * "?", the arrows, Delete. Opaque app chrome like the selection toolbar, so
 * it reads the same on a light or a dark board. × folds it to a small
 * keyboard button (remembered in this browser); the button opens it again.
 * Hidden while the board is empty: the empty prompt says the same, bigger.
 */

const FOLDED_KEY = "mindmap.flow.keysFolded";

function readFolded(): boolean {
    try {
        return window.localStorage.getItem(FOLDED_KEY) === "1";
    } catch {
        return false;
    }
}

function writeFolded(folded: boolean): void {
    try {
        if (folded) window.localStorage.setItem(FOLDED_KEY, "1");
        else window.localStorage.removeItem(FOLDED_KEY);
    } catch {
        // A blocked store only means the choice is not remembered.
    }
}

const selectEmpty = (s: EditorState) => activePage(s.doc).nodes.length === 0;

/** The legend's rows: which message, in order. */
export const LEGEND_ROWS = ["next", "branch", "decision", "move", "remove"] as const;

export function KeyCap({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="border-line bg-panel-2 text-ink-2 inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] font-medium leading-none">
            {children}
        </kbd>
    );
}

export const keyCap = (chunks: React.ReactNode) => <KeyCap>{chunks}</KeyCap>;

/** The four arrows, drawn: the arrow characters run together in Inter. */
function ArrowKeys() {
    return (
        <span className="flex items-center gap-px">
            <ArrowUp className="size-3" />
            <ArrowDown className="size-3" />
            <ArrowLeft className="size-3" />
            <ArrowRight className="size-3" />
        </span>
    );
}

export function KeyLegend() {
    const t = useTranslations("mindmap.flow.keys");
    const empty = useEditor(selectEmpty);
    const [folded, setFolded] = useState(false);

    useEffect(() => setFolded(readFolded()), []);

    if (empty) return null;

    const fold = (next: boolean) => {
        setFolded(next);
        writeFolded(next);
    };

    if (folded) {
        return (
            <Button
                type="button"
                variant="ghost"
                size="icon"
                data-flow-legend="folded"
                onClick={() => fold(false)}
                title={t("legend.show")}
                aria-label={t("legend.show")}
                className="border-line bg-panel text-ink-2 absolute bottom-3 left-3 z-20 size-8 rounded-lg border shadow-md"
            >
                <Keyboard className="size-4" />
            </Button>
        );
    }

    return (
        <section
            data-flow-legend="open"
            aria-label={t("legend.label")}
            className="border-line bg-panel text-ink-2 absolute bottom-3 left-3 z-20 w-[216px] rounded-lg border p-1.5 pl-3 shadow-md"
        >
            <header className="flex items-center justify-between">
                <span className="text-ink-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                    <Keyboard className="size-3.5" />
                    {t("legend.title")}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fold(true)}
                    title={t("legend.hide")}
                    aria-label={t("legend.hide")}
                    className="text-ink-3 hover:text-ink size-6"
                >
                    <X className="size-3.5" />
                </Button>
            </header>
            <dl className="mt-0.5 grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 pb-1 pr-1.5 text-[12px] leading-5">
                {LEGEND_ROWS.map(row => (
                    <React.Fragment key={row}>
                        <dt className="flex">
                            <KeyCap>{row === "move" ? <ArrowKeys /> : t(`caps.${row}`)}</KeyCap>
                        </dt>
                        <dd className="text-ink-2 min-w-0">{t(`legend.${row}`)}</dd>
                    </React.Fragment>
                ))}
            </dl>
        </section>
    );
}
