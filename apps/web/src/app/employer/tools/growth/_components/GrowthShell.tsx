"use client";

import { ArrowLeft, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ProspectsMark } from "~/components/icons/prospects";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { useGrowthPaths } from "../_lib/paths";
import { NewSegmentDialog } from "../prospects/_components/NewSegmentDialog";
import { RunSheet, runIsLive } from "../prospects/_components/RunSheet";
import { useProspects } from "../prospects/_lib/context";

interface NavItem {
    href: string;
    label: string;
    count?: number | null;
    exact?: boolean;
}

export function GrowthWordmark({ className }: { className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-2", className)}>
            <ProspectsMark size={15} tile />
            <span className="text-ink text-[13.5px] font-semibold tracking-[-0.02em]">Growth</span>
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

/** A group label in the rail: sentence case, quiet, not a tracked kicker. */
function GroupLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-ink-3 px-2 pb-1 text-[11.5px] font-medium">{children}</div>;
}

function SegmentSwitcher() {
    const { segments, segment, segmentId, setSegmentId, segmentsLoading } = useProspects();
    const [creating, setCreating] = useState(false);
    if (segmentsLoading && !segment) {
        return (
            <div className="border-line bg-panel rounded-lg border px-2.5 py-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="mt-2 h-2.5 w-1/2" />
            </div>
        );
    }
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="border-line bg-panel hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-[3px]"
                    aria-label="Switch segment"
                >
                    <span className="min-w-0 flex-1">
                        <span className="text-ink block truncate text-[13px] font-semibold">
                            {segment?.name ?? "No segment"}
                        </span>
                        <span className="text-ink-3 block truncate text-[11.5px]">
                            {segment?.subtitle ?? "Create one to start"}
                        </span>
                    </span>
                    <ChevronsUpDown className="text-ink-3 size-3.5 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[248px] p-1.5">
                <div className="text-ink-3 px-2 pb-1 pt-1 text-[11.5px]">Segments</div>
                {segments.map(s => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => setSegmentId(s.id)}
                        className="hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="text-ink block truncate text-[13px] font-medium">
                                {s.name}
                            </span>
                            <span className="text-ink-3 block truncate text-[11.5px]">
                                {s.status === "draft" ? "Draft · confirm to search" : s.subtitle}
                            </span>
                        </span>
                        {s.id === segmentId && <Check className="text-brand size-3.5" />}
                    </button>
                ))}
                <div className="border-line mt-1 border-t pt-1">
                    <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className="text-brand-ink hover:bg-panel-2 focus-visible:ring-brand/50 w-full rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-[3px]"
                    >
                        New segment
                    </button>
                </div>
            </PopoverContent>
            <NewSegmentDialog open={creating} onOpenChange={setCreating} />
        </Popover>
    );
}

/** The rail's one-line account of a run: which step is running, with its count. */
const RUNNING_VERB: Record<string, string> = {
    sources: "searching sources",
    shortlist: "shortlisting",
    profiles: "profiling",
    people: "finding people",
};

function RunIndicator() {
    const { activeRun, openRunSheet } = useProspects();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    const doing = current
        ? `${RUNNING_VERB[current.id] ?? current.label.toLowerCase()}${current.detail ? ` ${current.detail}` : ""}`
        : null;
    return (
        <button
            type="button"
            onClick={() => openRunSheet()}
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs outline-none focus-visible:ring-[3px]"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate">
                Finding companies{doing ? ` · ${doing}` : ""}
            </span>
        </button>
    );
}

/**
 * One rail for the two halves of growing a company. Brand has no unit of
 * navigation beyond the week, so its group is plain links; Prospects keeps
 * the segment switcher, since every screen there is about one segment. The
 * run sheet mounts here so any screen's "Find companies" can open it.
 */
export function GrowthShell({ children }: { children: React.ReactNode }) {
    const { segment } = useProspects();
    const paths = useGrowthPaths();
    const counts = segment?.counts;
    const brand: NavItem[] = [
        { href: paths.brand(""), label: "Overview", exact: true },
        { href: paths.brand("/compose"), label: "Compose" },
        { href: paths.brand("/calendar"), label: "Calendar" },
        { href: paths.brand("/campaigns"), label: "Campaigns" },
        { href: paths.brand("/accounts"), label: "Accounts" },
    ];
    const prospects: NavItem[] = [
        { href: paths.prospects(""), label: "Home", exact: true },
        { href: paths.prospects("/companies"), label: "Companies", count: counts?.companies },
        { href: paths.prospects("/people"), label: "People", count: counts?.people },
        { href: paths.prospects("/deals"), label: "Deals", count: counts?.deals },
        { href: paths.prospects("/runs"), label: "Runs" },
        { href: paths.prospects("/segment"), label: "Segment" },
        { href: paths.prospects("/sources"), label: "Sources", count: counts?.sources },
    ];
    return (
        <div className="bg-surface text-ink grid min-h-full w-full flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="bg-surface-2 border-line flex flex-col gap-4 border-b px-2.5 pb-16 pt-3.5 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r">
                <div className="px-1.5">
                    <GrowthWordmark />
                </div>
                <nav aria-label="Brand">
                    <GroupLabel>Brand</GroupLabel>
                    <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                        {brand.map(item => (
                            <NavLink key={item.href} item={item} />
                        ))}
                    </ul>
                </nav>
                <nav aria-label="Prospects" className="flex flex-col gap-2">
                    <GroupLabel>Prospects</GroupLabel>
                    <SegmentSwitcher />
                    <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                        {prospects.map(item => (
                            <NavLink key={item.href} item={item} />
                        ))}
                    </ul>
                    <RunIndicator />
                </nav>
                <div className="mt-auto">
                    <Link
                        href="/employer/documents"
                        className="text-ink-2 hover:text-ink hover:bg-panel/60 focus-visible:ring-brand/50 flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none transition-colors focus-visible:ring-[3px]"
                    >
                        <ArrowLeft className="size-3.5" />
                        Back to Studio
                    </Link>
                </div>
            </aside>
            <main className="min-w-0 px-5 pb-12 pt-6 md:px-8">{children}</main>
            <RunSheet />
        </div>
    );
}
