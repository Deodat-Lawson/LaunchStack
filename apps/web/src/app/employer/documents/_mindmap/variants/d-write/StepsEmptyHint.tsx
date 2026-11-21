"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";

import { cn } from "~/lib/utils";

import { activePage } from "../../model/doc";
import { isDarkSurface } from "../../model/palette";
import styles from "../../ui/Canvas.module.css";
import { useCommittedDoc, useStore } from "../../ui/EditorContext";
import { fillExample } from "./StepsPanel";

/**
 * What an empty board says under direction D: the chart is written, not
 * drawn, so it points at the panel instead of offering a first box. HTML over
 * the paper, so it takes the paper's colours (`.paper` + `data-paper`), as the
 * editor's own prompt does.
 */
export function StepsEmptyHint({ canvasSize }: { canvasSize: { w: number; h: number } }) {
    const t = useTranslations("mindmap.variants.d");
    const store = useStore();
    const doc = useCommittedDoc();
    const page = activePage(doc);

    return (
        <div
            data-export="omit"
            data-steps-hint=""
            data-paper={isDarkSurface(page.background.color) ? "dark" : "light"}
            className={cn(
                styles.paper,
                "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 px-6 text-center"
            )}
        >
            <p className="text-ink-2 flex items-center gap-2 text-[15px] font-medium">
                <ArrowLeft className="size-4" />
                {t("hint.title")}
            </p>
            <p className="text-ink-3 text-[12.5px]">{t("hint.body")}</p>
            <button
                type="button"
                onClick={() => fillExample(store, t("panel.example"), canvasSize)}
                className="text-brand pointer-events-auto mt-2 text-[12.5px] underline-offset-4 hover:underline"
            >
                {t("hint.useExample")}
            </button>
        </div>
    );
}
