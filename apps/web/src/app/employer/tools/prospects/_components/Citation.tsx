"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/components/ui/hover-card";

import type { Claim, EvidenceItem } from "../api";

export function evidenceAnchorId(n: number): string {
    return `evidence-${n}`;
}

/**
 * A superscript that names its evidence row. Click scrolls to the row and
 * flashes it; hover shows the page, host and quote. Replaces the old
 * "E12" token that had nowhere to go.
 */
export function Citation({ n, evidence }: { n: number; evidence: EvidenceItem[] }) {
    const item = evidence.find(e => e.n === n);
    const jump = () => {
        const el = document.getElementById(evidenceAnchorId(n));
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.setAttribute("data-flash", "1");
        window.setTimeout(() => el.removeAttribute("data-flash"), 900);
    };
    const sup = (
        <button
            type="button"
            onClick={jump}
            className="text-brand-ink focus-visible:ring-brand/50 ml-px rounded-sm px-0.5 align-super font-mono text-[10px] leading-none outline-none hover:underline focus-visible:ring-2"
            aria-label={item ? `Evidence ${n}: ${item.title}` : `Evidence ${n}`}
        >
            {n}
        </button>
    );
    if (!item) return sup;
    return (
        <HoverCard openDelay={200} closeDelay={80}>
            <HoverCardTrigger asChild>{sup}</HoverCardTrigger>
            <HoverCardContent align="start" className="w-80 p-3">
                <div className="text-ink text-[13px] font-medium">{item.title}</div>
                <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-ink mt-0.5 block truncate font-mono text-[11px] hover:underline"
                >
                    {item.host}
                </a>
                <p className="text-ink-2 mt-2 text-xs leading-relaxed">“{item.quote}”</p>
            </HoverCardContent>
        </HoverCard>
    );
}

/** A sentence with its citations rendered inline. */
export function ClaimText({ claim, evidence }: { claim: Claim; evidence: EvidenceItem[] }) {
    return (
        <>
            {claim.text}
            {claim.cites.map(n => (
                <Citation key={n} n={n} evidence={evidence} />
            ))}
        </>
    );
}
