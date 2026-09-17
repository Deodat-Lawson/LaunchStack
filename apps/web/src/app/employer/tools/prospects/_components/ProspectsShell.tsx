"use client";

import { ArrowLeft, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { useProspects } from "../_lib/context";
import { NewSegmentDialog } from "./NewSegmentDialog";
import { ProspectsWordmark } from "./ProspectsMark";
import { RunSheet, runIsLive } from "./RunSheet";

interface NavItem {
    path: string;
    label: string;
    count?: number | null;
    exact?: boolean;
}

function NavLink({ item }: { item: NavItem }) {
    const { href } = useProspects();
    const pathname = usePathname();
    const target = href(item.path);
    const active = item.exact ? pathname === target : pathname.startsWith(target);
    return (
        <li>
            <Link
                href={target}
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
                        className={cn(
                            "hover:bg-panel-2 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
                        )}
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

function RunIndicator() {
    const { activeRun, openRunSheet } = useProspects();
    if (!activeRun || !runIsLive(activeRun)) return null;
    const sources = activeRun.steps.find(s => s.id === "sources");
    return (
        <button
            type="button"
            onClick={() => openRunSheet()}
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 focus-visible:ring-brand/50 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs outline-none focus-visible:ring-[3px]"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0 flex-1 truncate">
                Finding companies{sources?.detail ? ` · ${sources.detail}` : ""}
            </span>
        </button>
    );
}

/**
 * The Studio's shape: a rail on the second neutral with the segment as the
 * unit of navigation, and one main column. The run sheet mounts here so any
 * screen's "Find companies" can open it.
 */
export function ProspectsShell({ children }: { children: React.ReactNode }) {
    const { segment } = useProspects();
    const counts = segment?.counts;
    const items: NavItem[] = [
        { path: "", label: "Home", exact: true },
        { path: "/companies", label: "Companies", count: counts?.companies },
        { path: "/people", label: "People", count: counts?.people },
        { path: "/deals", label: "Deals", count: counts?.deals },
        { path: "/runs", label: "Runs" },
        { path: "/segment", label: "Segment" },
        { path: "/sources", label: "Sources", count: counts?.sources },
    ];
    return (
        <div className="bg-surface text-ink grid min-h-full w-full flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="bg-surface-2 border-line flex flex-col gap-4 border-b px-2.5 pb-16 pt-3.5 md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
                <div className="px-1.5">
                    <ProspectsWordmark />
                </div>
                <SegmentSwitcher />
                <nav aria-label="Prospects">
                    <ul className="flex flex-row flex-wrap gap-0.5 md:flex-col">
                        {items.map(item => (
                            <NavLink key={item.path} item={item} />
                        ))}
                    </ul>
                </nav>
                <RunIndicator />
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
