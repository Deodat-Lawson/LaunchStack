"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { cn } from "~/lib/utils";

import type { FoundVia, SourceKind } from "../api";
import { relativeTime } from "../../_lib/format";

const KIND_WORD: Record<SourceKind, string> = {
    api: "Directory or API",
    recipe: "Search-index listing",
    signal: "Signal",
};

/**
 * An outline chip naming the platform a company was seen on. A dashed
 * border marks a signal source (hiring, launches), which tells you something
 * about a company without being where it was found. Hover shows the listing.
 */
export function SourceChip({
    label,
    kind,
    url,
    at,
    className,
}: {
    label: string;
    kind: SourceKind;
    url?: string | null;
    at?: string | null;
    className?: string;
}) {
    const chip = (
        <span
            className={cn(
                "border-line text-ink-3 inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full border px-[7px] text-[11px] leading-none",
                kind === "signal" && "border-dashed",
                className
            )}
        >
            {label}
        </span>
    );
    if (!url && !at) return chip;
    return (
        <HoverCard openDelay={250} closeDelay={80}>
            <HoverCardTrigger asChild>
                <span className="inline-flex cursor-default">{chip}</span>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="w-72 p-3 text-xs">
                <div className="text-ink font-medium">{label}</div>
                <div className="text-ink-3 mt-0.5">{KIND_WORD[kind]}</div>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-ink mt-2 block truncate font-mono text-[11px] hover:underline"
                    >
                        {url.replace(/^https?:\/\//, "")}
                    </a>
                )}
                {at && <div className="text-ink-3 mt-1">Seen {relativeTime(at)}</div>}
            </HoverCardContent>
        </HoverCard>
    );
}

export function FoundViaChips({ items, max = 3 }: { items: FoundVia[]; max?: number }) {
    const shown = items.slice(0, max);
    const rest = items.length - shown.length;
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {shown.map(f => (
                <SourceChip key={f.sourceId} label={f.label} kind={f.kind} url={f.url} at={f.at} />
            ))}
            {rest > 0 && <span className="text-ink-3 text-[11px]">+{rest}</span>}
        </span>
    );
}
