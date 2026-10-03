"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "~/lib/utils";

import type { VantageEvidenceRef } from "../api";
import { EvidenceChips } from "./Primitives";

/**
 * The one way Vantage shows something it prepared: a card that says it is a
 * suggestion, why, and from what, with the two answers on its face — take it
 * or leave it, one click either way. What the founder wrote or already took
 * never wears this; once accepted, a suggestion becomes an ordinary row.
 */

/** "✦ Suggested by Vantage" — the mark every suggestion carries. */
export function SuggestionMark({
    children = "Suggested by Vantage",
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "text-brand-ink inline-flex items-center gap-1.5 text-[11.5px] font-medium",
                className
            )}
        >
            <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
            {children}
        </span>
    );
}

const MAX_CHIPS = 3;

export function SuggestionCard({
    label,
    kicker,
    meta,
    title,
    reason,
    sources,
    unsupported,
    actions,
    details,
    detailsLabel = "Details",
    menu,
    className,
}: {
    /** Accessible name for the card, e.g. the topic title. */
    label: string;
    /** What kind of suggestion, after the ✦: "For the meeting", "Check in". */
    kicker: React.ReactNode;
    /** Right of the kicker: "1 day late", "AI draft". */
    meta?: React.ReactNode;
    title: React.ReactNode;
    reason?: React.ReactNode;
    sources?: VantageEvidenceRef[];
    unsupported?: boolean;
    /** The one-click answers; the first is the suggestion, then Ignore. */
    actions: React.ReactNode;
    /** The full reasoning, one click away. */
    details?: React.ReactNode;
    detailsLabel?: string;
    /** Everything else you can do with it (edit, share, delete), out of the way. */
    menu?: React.ReactNode;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const detailsId = useId();
    const refs = sources ?? [];
    const shown = refs.slice(0, MAX_CHIPS);
    const more = refs.length - shown.length;
    return (
        <article
            aria-label={label}
            className={cn(
                "border-line bg-panel shadow-1 hover:border-brand/40 relative overflow-hidden rounded-xl border transition-colors",
                className
            )}
        >
            <div
                aria-hidden="true"
                className="from-brand-soft pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent"
            />
            <div className="relative flex flex-col gap-2 px-4 pb-3.5 pt-3">
                <div className="flex min-h-5 items-center gap-2">
                    <SuggestionMark>{kicker}</SuggestionMark>
                    {meta && <span className="text-ink-3 ml-auto text-[11.5px]">{meta}</span>}
                    {menu && <div className={cn("-my-1 -mr-1.5", !meta && "ml-auto")}>{menu}</div>}
                </div>
                <div className="text-ink text-[14.5px] font-medium leading-snug">{title}</div>
                {reason && (
                    <p className="text-ink-2 max-w-[72ch] text-[13px] leading-[1.5]">{reason}</p>
                )}
                {(shown.length > 0 || unsupported) && (
                    <div className="flex flex-wrap items-center gap-1">
                        <EvidenceChips refs={shown} unsupported={unsupported} />
                        {more > 0 && <span className="text-ink-3 text-[11px]">+{more} more</span>}
                    </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    {actions}
                    {details && (
                        <button
                            type="button"
                            onClick={() => setOpen(o => !o)}
                            aria-expanded={open}
                            aria-controls={detailsId}
                            className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 ml-auto inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] outline-none focus-visible:ring-2"
                        >
                            {detailsLabel}
                            <ChevronDown
                                className={cn(
                                    "size-3.5 transition-transform motion-reduce:transition-none",
                                    open && "rotate-180"
                                )}
                                aria-hidden="true"
                            />
                        </button>
                    )}
                </div>
                {details && open && (
                    <div id={detailsId} className="border-line-2 mt-1 border-t pt-3">
                        {details}
                    </div>
                )}
            </div>
        </article>
    );
}

/** A small suggestion that fits on one line: a nudge with its two answers. */
export function SuggestionNudge({
    label,
    kicker = "Suggested by Vantage",
    title,
    actions,
    className,
}: {
    label: string;
    kicker?: React.ReactNode;
    title: React.ReactNode;
    actions: React.ReactNode;
    className?: string;
}) {
    return (
        <article
            aria-label={label}
            className={cn(
                "border-line bg-panel hover:border-brand/40 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition-colors",
                className
            )}
        >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <SuggestionMark>{kicker}</SuggestionMark>
                <div className="text-ink text-[13.5px]">{title}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </article>
    );
}

/** Every suggestion answered: say so, and what brings the next ones. */
export function AllCaughtUp({ body, className }: { body?: string; className?: string }) {
    return (
        <div
            className={cn(
                "border-line bg-panel flex items-start gap-3 rounded-xl border border-dashed px-4 py-4",
                className
            )}
        >
            <span className="bg-success-soft text-success mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full">
                <Check className="size-3.5" aria-hidden="true" />
            </span>
            <div>
                <div className="text-ink text-sm font-medium">You&apos;re all caught up</div>
                <p className="text-ink-2 mt-0.5 max-w-[60ch] text-[13px]">
                    {body ??
                        "Vantage suggests more as conversations, numbers and promises come in."}
                </p>
            </div>
        </div>
    );
}

/** While Vantage drafts: what it is reading, and where the suggestions will land. */
export function DraftingCard({ reading, className }: { reading?: string; className?: string }) {
    return (
        <div
            role="status"
            aria-live="polite"
            className={cn("border-line bg-panel overflow-hidden rounded-xl border", className)}
        >
            <div className="from-brand-soft flex flex-col gap-1 bg-gradient-to-b to-transparent px-4 pb-3 pt-3.5">
                <SuggestionMark>
                    <span className="animate-pulse motion-reduce:animate-none">
                        Vantage is drafting your week…
                    </span>
                </SuggestionMark>
                {reading && <p className="text-ink-2 text-[13px]">{reading}</p>}
            </div>
            <div className="flex flex-col gap-2.5 px-4 pb-4" aria-hidden="true">
                {[0, 1].map(i => (
                    <div
                        key={i}
                        className="border-line-2 flex flex-col gap-2 rounded-lg border p-3"
                    >
                        <div className="bg-panel-2 h-3.5 w-2/5 animate-pulse rounded motion-reduce:animate-none" />
                        <div className="bg-panel-2 h-3 w-4/5 animate-pulse rounded motion-reduce:animate-none" />
                        <div className="bg-panel-2 h-3 w-3/5 animate-pulse rounded motion-reduce:animate-none" />
                    </div>
                ))}
            </div>
        </div>
    );
}
