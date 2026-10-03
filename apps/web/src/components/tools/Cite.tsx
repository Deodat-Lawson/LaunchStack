"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import { cn } from "~/lib/utils";

/**
 * One numbered excerpt something cites. Structural on purpose: the company
 * profile's evidence and a Proposals draft's evidence both fit it, and
 * neither has to know about the other.
 */
export interface CiteEvidence {
    n: number;
    title: string;
    page: number | null;
    quote: string;
    /** Where the source opens in the Studio; null when it cannot be opened there. */
    href: string | null;
    /** A web page, for evidence that did not come from a source. */
    url?: string | null;
}

/**
 * A link to a source. Inside a tool's tab it is a `ToolLink`, so a plain
 * click stays in the workspace; anywhere else (Settings) it is a plain
 * client-side link to the same Studio URL.
 */
export function SourceLink({
    href,
    className,
    children,
}: {
    href: string;
    className?: string;
    children: React.ReactNode;
}) {
    const nav = useOptionalToolNav();
    if (nav) {
        return (
            <ToolLink href={href} className={className}>
                {children}
            </ToolLink>
        );
    }
    return (
        <Link href={href} className={className}>
            {children}
        </Link>
    );
}

/**
 * A superscript naming its evidence. Hover shows the source, the page and
 * the quote; the title opens the source in the Studio. The same component
 * cites a profile fact and a drafted answer.
 */
export function Cite({ n, evidence }: { n: number; evidence: CiteEvidence[] }) {
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
                    <SourceLink
                        href={item.href}
                        className="text-ink hover:text-brand-ink inline-flex items-center gap-1 text-[13px] font-medium"
                    >
                        {item.title}
                        <ExternalLink className="size-3" />
                    </SourceLink>
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
    evidence: CiteEvidence[];
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
export function EvidenceRows({ evidence }: { evidence: CiteEvidence[] }) {
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
                            <SourceLink
                                href={e.href}
                                className="text-ink hover:text-brand-ink font-medium"
                            >
                                {e.title}
                            </SourceLink>
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
