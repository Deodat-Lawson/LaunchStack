"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { cn } from "~/lib/utils";

import type { EvidenceDto } from "../api";

/**
 * A superscript naming its evidence. Hover shows the source, the page and
 * the quote; the title opens the source in the Studio. The same component
 * cites a profile fact and a drafted answer.
 */
export function Cite({ n, evidence }: { n: number; evidence: EvidenceDto[] }) {
    const item = evidence.find(e => e.n === n);
    const sup = (
        <span
            className="text-brand-ink ml-px inline-block cursor-default rounded-sm px-0.5 align-super font-mono text-[10px] leading-none"
            aria-label={item ? `Source ${n}: ${item.title}` : `Source ${n}`}
        >
            {n}
        </span>
    );
    if (!item) return sup;
    return (
        <HoverCard openDelay={200} closeDelay={80}>
            <HoverCardTrigger asChild>{sup}</HoverCardTrigger>
            <HoverCardContent align="start" className="w-80 p-3">
                {item.href ? (
                    <Link
                        href={item.href}
                        className="text-ink hover:text-brand-ink inline-flex items-center gap-1 text-[13px] font-medium"
                    >
                        {item.title}
                        <ExternalLink className="size-3" />
                    </Link>
                ) : item.url ? (
                    <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink hover:text-brand-ink inline-flex items-center gap-1 text-[13px] font-medium"
                    >
                        {item.title}
                        <ExternalLink className="size-3" />
                    </a>
                ) : (
                    <div className="text-ink text-[13px] font-medium">{item.title}</div>
                )}
                {item.page && <div className="text-ink-3 mt-0.5 text-xs">Page {item.page}</div>}
                <p className="text-ink-2 mt-2 text-xs leading-relaxed">“{item.quote}”</p>
            </HoverCardContent>
        </HoverCard>
    );
}

/** "Sources: 1 2 5" under a draft. */
export function CiteList({
    cites,
    evidence,
    className,
}: {
    cites: number[];
    evidence: EvidenceDto[];
    className?: string;
}) {
    if (cites.length === 0) return null;
    return (
        <span className={cn("text-ink-3 inline-flex items-center gap-0.5 text-xs", className)}>
            Sources
            {cites.map(n => (
                <Cite key={n} n={n} evidence={evidence} />
            ))}
        </span>
    );
}

/** The evidence list under a profile or a draft: numbered rows, each a link. */
export function EvidenceRows({ evidence }: { evidence: EvidenceDto[] }) {
    if (evidence.length === 0) return null;
    return (
        <div className="border-line bg-panel overflow-hidden rounded-lg border">
            {evidence.map(e => (
                <div
                    key={e.n}
                    className="border-line-2 grid grid-cols-[28px_minmax(0,1fr)] gap-2 border-t px-4 py-2.5 text-[13px] first:border-t-0"
                >
                    <span className="text-ink-3 font-mono text-[11px] tabular-nums">{e.n}</span>
                    <span className="min-w-0">
                        {e.href ? (
                            <Link
                                href={e.href}
                                className="text-ink hover:text-brand-ink font-medium"
                            >
                                {e.title}
                            </Link>
                        ) : (
                            <span className="text-ink font-medium">{e.title}</span>
                        )}
                        {e.page && <span className="text-ink-3"> · p. {e.page}</span>}
                        <span className="text-ink-2 mt-0.5 block text-xs leading-relaxed">
                            “{e.quote}”
                        </span>
                    </span>
                </div>
            ))}
        </div>
    );
}
