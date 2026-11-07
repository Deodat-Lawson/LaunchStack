"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clipboard, Download, Pencil, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { copyText } from "~/lib/context-menu";
import { downloadTextFile } from "./transcript";
import { ChatMarkdown } from "./ChatMarkdown";

export function ProposedPlan({
    text,
    onRefine,
    onImplement,
    active,
}: {
    text: string;
    onRefine: (text: string) => void;
    onImplement?: (text: string) => void;
    active?: boolean;
}) {
    const t = useTranslations("chat.plan");
    const [expanded, setExpanded] = useState(true);
    return (
        <section
            aria-label={t("title")}
            className="my-3 min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)]"
        >
            <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(v => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
            >
                <span>{t("title")}</span>
                <span aria-hidden>{expanded ? "−" : "+"}</span>
            </Button>
            {expanded && (
                <div className="border-t border-[var(--line)] px-4 py-2">
                    <ChatMarkdown text={text} />
                </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-3 py-2 text-xs">
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="flex items-center gap-1 rounded p-1"
                    onClick={() =>
                        void copyText(text).then(ok =>
                            ok ? toast.success(t("copied")) : toast.error(t("copyFailed"))
                        )
                    }
                >
                    <Clipboard size={13} />
                    {t("copy")}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="flex items-center gap-1 rounded p-1"
                    onClick={() => downloadTextFile("proposed-plan.md", text)}
                >
                    <Download size={13} />
                    {t("download")}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="flex items-center gap-1 rounded p-1"
                    onClick={() =>
                        onRefine(`Refine this proposed plan:\n\n${text}\n\nRequested changes: `)
                    }
                >
                    <Pencil size={13} />
                    {t("refine")}
                </Button>
                {onImplement && (
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        disabled={active}
                        className="ml-auto flex items-center gap-1 rounded bg-[var(--accent-soft)] p-1 text-[var(--accent)] disabled:opacity-50"
                        onClick={() => onImplement(text)}
                    >
                        <Play size={13} />
                        {t("implement")}
                    </Button>
                )}
            </div>
        </section>
    );
}
