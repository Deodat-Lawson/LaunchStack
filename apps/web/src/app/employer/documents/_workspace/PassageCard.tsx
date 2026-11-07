"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TextQuote, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { ChatPassage } from "~/lib/chat-passages";
import { cn } from "~/lib/utils";

interface PassageCardProps {
    passage: Pick<ChatPassage, "title" | "page" | "text">;
    /** Shows the passage where it lives in its document. */
    onOpen?: () => void;
    /** Takes the passage off the message being written. */
    onRemove?: () => void;
    className?: string;
}

/**
 * A passage someone selected in a document and is asking about, drawn as the
 * excerpt it is: where it came from (title and page) over the words
 * themselves, clamped to three lines with a way to read the rest.
 *
 * It replaces a Markdown quote pasted into the message, which showed up as
 * raw `>` lines and a machine link in the composer and in the transcript.
 */
export function PassageCard({ passage, onOpen, onRemove, className }: PassageCardProps) {
    const t = useTranslations("chat.passage");
    const tc = useTranslations("common");
    const [expanded, setExpanded] = useState(false);
    const [clamped, setClamped] = useState(false);
    const body = useRef<HTMLQuoteElement>(null);

    useLayoutEffect(() => {
        const element = body.current;
        if (!element || expanded) return;
        const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [passage.text, expanded]);

    return (
        <figure
            data-testid="passage-card"
            className={cn(
                "border-line bg-panel-2 m-0 min-w-0 rounded-lg border px-3 py-2",
                className
            )}
        >
            <figcaption className="text-ink-3 flex min-w-0 items-center gap-1.5 text-xs">
                <TextQuote className="text-brand size-3.5 shrink-0" aria-hidden />
                {onOpen ? (
                    <Button
                        variant="link"
                        className="text-ink-2 hover:text-brand h-auto min-w-0 justify-start p-0 text-xs font-medium"
                        title={t("showInDocument")}
                        onClick={onOpen}
                    >
                        <span className="truncate">{passage.title}</span>
                    </Button>
                ) : (
                    <span className="text-ink-2 min-w-0 truncate font-medium">{passage.title}</span>
                )}
                {passage.page ? (
                    <span className="mono shrink-0 text-[11px]">
                        {t("page", { page: passage.page })}
                    </span>
                ) : null}
                {onRemove ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-ink-3 -my-1 -mr-1.5 ml-auto size-6 shrink-0"
                        aria-label={t("remove", { title: passage.title })}
                        onClick={onRemove}
                    >
                        <X className="size-3.5" />
                    </Button>
                ) : null}
            </figcaption>
            <blockquote
                ref={body}
                data-testid="passage-text"
                className={cn(
                    "border-brand-soft text-ink-2 mb-0 mt-1.5 whitespace-pre-wrap break-words border-l-2 pl-2.5 text-[13px] leading-relaxed",
                    !expanded && "line-clamp-3"
                )}
            >
                {passage.text}
            </blockquote>
            {clamped || expanded ? (
                <Button
                    variant="link"
                    className="mt-1 h-auto p-0 text-xs"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(value => !value)}
                >
                    {expanded ? tc("actions.showLess") : t("showAll")}
                </Button>
            ) : null}
        </figure>
    );
}
