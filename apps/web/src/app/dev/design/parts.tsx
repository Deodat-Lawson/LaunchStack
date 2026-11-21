"use client";

/**
 * The design library's own page furniture: a section, a specimen box, a
 * rule, a do/don't pair. Developer documentation, so its prose is English
 * (like the guide it mirrors); the template tool it shows is fully
 * translated, because that is the part people copy.
 */

import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export function DocSection({
    id,
    title,
    lead,
    guide,
    children,
}: {
    id: string;
    title: string;
    lead?: ReactNode;
    /** The DESIGN.md heading this section mirrors. */
    guide?: string;
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            className="border-line flex scroll-mt-20 flex-col gap-6 border-t pt-10 first:border-t-0 first:pt-0"
        >
            <header className="flex flex-col gap-1.5">
                <h2 className="display text-ink text-[26px] leading-[1.1] tracking-[-0.02em]">
                    {title}
                </h2>
                {lead && (
                    <div className="text-ink-2 max-w-[72ch] text-sm leading-relaxed">{lead}</div>
                )}
                {guide && (
                    <div className="text-ink-3 text-xs">
                        Guide: <code className="font-mono">apps/web/DESIGN.md</code> › {guide}
                    </div>
                )}
            </header>
            {children}
        </section>
    );
}

export function SubSection({
    id,
    title,
    children,
}: {
    id?: string;
    title: string;
    children: ReactNode;
}) {
    return (
        <div id={id} className="flex scroll-mt-20 flex-col gap-3">
            <h3 className="text-ink text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
            {children}
        </div>
    );
}

/** A live specimen on the panel surface, with where it comes from underneath. */
export function Specimen({
    children,
    source,
    note,
    className,
    padded = true,
}: {
    children: ReactNode;
    /** Import path or class recipe. */
    source?: string;
    note?: ReactNode;
    className?: string;
    padded?: boolean;
}) {
    return (
        <figure className="border-line m-0 overflow-hidden rounded-lg border">
            <div className={cn("bg-panel", padded && "p-5", className)}>{children}</div>
            {(source !== undefined || note !== undefined) && (
                <figcaption className="border-line bg-panel-2 text-ink-3 flex flex-col gap-0.5 border-t px-4 py-2 text-xs">
                    {source && <code className="text-ink-2 font-mono text-[12px]">{source}</code>}
                    {note && <span className="leading-normal">{note}</span>}
                </figcaption>
            )}
        </figure>
    );
}

/** One rule, stated as an instruction, with its reason. */
export function Rule({ children, why }: { children: ReactNode; why?: ReactNode }) {
    return (
        <li className="text-ink text-sm leading-relaxed">
            {children}
            {why && <span className="text-ink-3"> {why}</span>}
        </li>
    );
}

export function Rules({ children }: { children: ReactNode }) {
    return <ul className="m-0 flex max-w-[80ch] list-disc flex-col gap-1.5 pl-5">{children}</ul>;
}

/** A do and a don't, side by side; they stack in a narrow column. */
export function DoDont({
    good,
    bad,
    goodNote,
    badNote,
}: {
    good: ReactNode;
    bad: ReactNode;
    goodNote: string;
    badNote: string;
}) {
    return (
        <div className="@max-md:grid-cols-1 grid grid-cols-2 gap-3">
            {[
                { ok: true, body: good, note: goodNote },
                { ok: false, body: bad, note: badNote },
            ].map(item => (
                <figure
                    key={String(item.ok)}
                    className="border-line m-0 overflow-hidden rounded-lg border"
                >
                    <div className="bg-panel p-5">{item.body}</div>
                    <figcaption
                        className={cn(
                            "flex items-start gap-2 border-t px-4 py-2 text-xs leading-normal",
                            item.ok
                                ? "border-success/30 bg-success-soft text-success-ink"
                                : "border-danger/30 bg-danger-soft text-danger-ink"
                        )}
                    >
                        {item.ok ? (
                            <Check aria-hidden className="mt-px size-3.5 shrink-0" />
                        ) : (
                            <X aria-hidden className="mt-px size-3.5 shrink-0" />
                        )}
                        <span>
                            <span className="font-semibold">{item.ok ? "Do. " : "Don't. "}</span>
                            {item.note}
                        </span>
                    </figcaption>
                </figure>
            ))}
        </div>
    );
}

/** A compact two-or-more column reference table. */
export function RefTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
    return (
        <div className="border-line overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                    <tr className="bg-panel-2">
                        {head.map(h => (
                            <th
                                key={h}
                                className="text-ink-3 border-line border-b px-3 py-2 text-xs font-medium"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="bg-panel">
                    {rows.map((row, i) => (
                        <tr key={i} className="border-line-2 border-t first:border-t-0">
                            {row.map((cell, j) => (
                                <td
                                    key={j}
                                    className="text-ink-2 px-3 py-2 align-top leading-normal"
                                >
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function Code({ children }: { children: ReactNode }) {
    return (
        <code className="bg-panel-2 text-ink rounded-sm px-1 py-px font-mono text-[12px]">
            {children}
        </code>
    );
}
