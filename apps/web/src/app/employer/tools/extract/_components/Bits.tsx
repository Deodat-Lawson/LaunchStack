"use client";

import {
    Calendar,
    File,
    FileImage,
    FileSpreadsheet,
    FileText,
    Hash,
    List,
    ToggleLeft,
    Type,
    type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { ExtractionFieldType, ExtractionTableSummary } from "~/lib/extraction/types";
import { cn } from "~/lib/utils";

import { isLive, progressOf } from "../_lib/cells";

/**
 * A table's state as a dot and a few words: "Queued", "Reading 18 of 24",
 * "Done", "Done · 2 failed", "Failed", "Cancelled".
 */
export function StatusPill({
    table,
    className,
}: {
    table: Pick<ExtractionTableSummary, "status" | "counts">;
    className?: string;
}) {
    const t = useTranslations("extract.words");
    const live = isLive(table.status);
    const { finished, total } = progressOf(table.counts);
    const someFailed = table.status === "done" && table.counts.failed > 0;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums",
                live
                    ? "text-brand-ink"
                    : table.status === "failed"
                      ? "text-danger"
                      : someFailed
                        ? "text-warn-ink"
                        : "text-ink-2",
                className
            )}
            data-status={table.status}
        >
            <span
                aria-hidden
                className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    table.status === "done" && (someFailed ? "bg-warn" : "bg-success"),
                    live && "bg-brand animate-pulse motion-reduce:animate-none",
                    table.status === "failed" && "bg-danger",
                    table.status === "cancelled" && "bg-ink-4"
                )}
            />
            {table.status === "running"
                ? t("readingProgress", { finished, total })
                : someFailed
                  ? t("doneWithFailed", { failed: table.counts.failed })
                  : t(`status.${table.status}`)}
        </span>
    );
}

const TYPE_ICON: Record<ExtractionFieldType, LucideIcon> = {
    text: Type,
    number: Hash,
    date: Calendar,
    boolean: ToggleLeft,
    list: List,
};

/** The small mark beside a column's name that says what kind of value it holds. */
export function TypeGlyph({ type, className }: { type: ExtractionFieldType; className?: string }) {
    const Icon = TYPE_ICON[type];
    return <Icon aria-hidden className={cn("text-ink-3 size-3.5 shrink-0", className)} />;
}

/** A file's icon by the kind the server names: "pdf", "image", "docx", … */
export function KindGlyph({ kind, className }: { kind: string; className?: string }) {
    const k = kind.toLowerCase();
    const Icon =
        k === "image"
            ? FileImage
            : k === "sheet" || k === "xlsx" || k === "xls" || k === "csv"
              ? FileSpreadsheet
              : k === "pdf" || k === "doc" || k === "docx" || k === "text" || k === "md"
                ? FileText
                : File;
    return <Icon aria-hidden className={cn("text-ink-3 size-4 shrink-0", className)} />;
}
