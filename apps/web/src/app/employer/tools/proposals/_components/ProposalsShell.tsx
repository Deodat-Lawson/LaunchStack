"use client";

import { Loader2, PenLine } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { RailBackLink } from "~/app/employer/_chrome/RailBackLink";
import { STUDIO } from "~/app/employer/_chrome/backTarget";
import { cn } from "~/lib/utils";

import { runIsLive, useProposals } from "../_lib/context";
import { RUN_KIND_LABEL } from "../api";
import { ProposalRunSheet } from "./ProposalRunSheet";

interface NavItem {
    href: string;
    label: string;
    count?: number | null;
    exact?: boolean;
}

export function ProposalsWordmark({ className }: { className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-2", className)}>
            <span
                className="bg-brand text-brand-fg inline-flex size-[21px] shrink-0 items-center justify-center rounded-[27%]"
                aria-hidden
            >
                <PenLine className="size-3" strokeWidth={2.25} />
            </span>
            <span className="text-ink text-[13.5px] font-semibold tracking-[-0.02em]">
                Proposals
            </span>
        </span>
    );
}

function NavLink({ item }: { item: NavItem }) {
    const pathname = usePathname();
    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
    return (
        <li>
            <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                    "focus-visible:ring-brand/50 flex h-8 items-center justify-between gap-2 rounded-md px-2 text-[13px] outline-none transition-colors focus-visible:ring-[3px]",
                    active
                        ? "bg-panel text-ink shadow-1 font-medium"
                        : "text-ink-2 hover:bg-panel/60 hover:text-ink"
                )}
            >
                <span>{item.label}</span>
                {item.count !== undefined && item.count !== null && (
                    <span className="text-ink-3 font-mono text-[11px] tabular-nums">
                        {item.count}
                    </span>
                )}
            </Link>
        </li>
    );
}

/** The rail's one line about a run: what it is doing, with the current step. */
function RunIndicator() {
    const { activeRun, openRunSheet } = useProposals();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    return (
        <button
            type="button"
            onClick={() => openRunSheet()}
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs outline-none focus-visible:ring-[3px]"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate">
                {RUN_KIND_LABEL[activeRun.kind]}
                {current ? ` · ${current.label.toLowerCase()}` : ""}
            </span>
        </button>
    );
}

/**
 * One rail for the writing app. Write is the work; Funders is where it
 * starts; Profile and Library are what every draft draws on. The run sheet
 * mounts here so any screen's Draft or Find funders can open it.
 */
export function ProposalsShell({ children }: { children: React.ReactNode }) {
    const { counts, href } = useProposals();
    const items: NavItem[] = [
        { href: href(""), label: "Home", exact: true },
        { href: href("/write"), label: "Write", count: counts?.applications },
        { href: href("/funders"), label: "Funders", count: counts?.funders },
        { href: href("/profile"), label: "Profile" },
        { href: href("/library"), label: "Library", count: counts?.library },
    ];
    return (
        <div className="bg-surface text-ink grid min-h-full w-full flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="bg-surface-2 border-line flex flex-col gap-4 border-b px-2.5 pb-16 pt-3.5 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r">
                <div className="flex flex-col gap-2">
                    <RailBackLink target={STUDIO} />
                    <div className="px-1.5">
                        <ProposalsWordmark />
                    </div>
                </div>
                <nav aria-label="Proposals" className="flex flex-col gap-2">
                    <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                        {items.map(item => (
                            <NavLink key={item.href} item={item} />
                        ))}
                    </ul>
                    <RunIndicator />
                </nav>
                <div className="text-ink-3 mt-auto px-2 text-[11.5px] leading-relaxed">
                    Drafts cite your Sources. Approved answers go to the Library. A finished
                    proposal can be exported back into Sources.
                </div>
            </aside>
            <main className="min-w-0 px-5 pb-12 pt-6 md:px-8">{children}</main>
            <ProposalRunSheet />
        </div>
    );
}
