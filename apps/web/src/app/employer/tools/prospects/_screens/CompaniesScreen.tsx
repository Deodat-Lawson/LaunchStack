"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

import { prospectsApi, type CompaniesSort, type CompaniesView, type CompanyRow } from "../api";
import { useProspects } from "../_lib/context";
import { relativeTime } from "../_lib/format";
import { rememberListOrder } from "../_lib/listOrder";
import { useResource } from "../_lib/useResource";
import { BulkBar } from "../_components/BulkBar";
import { EmptyState, InlineError } from "../_components/EmptyState";
import { FitMeter } from "../_components/FitMeter";
import { PageHeader } from "../_components/PageHeader";
import { SkeletonRows } from "../_components/SkeletonRows";
import { FoundViaChips } from "../_components/SourceChip";
import { StagePill } from "../_components/StagePill";

const VIEWS: Array<{ id: CompaniesView; label: string }> = [
    { id: "all", label: "All" },
    { id: "new", label: "New" },
    { id: "highfit", label: "High fit" },
    { id: "uncontacted", label: "Not contacted" },
    { id: "excluded", label: "Excluded" },
];

function isView(v: string | null): v is CompaniesView {
    return VIEWS.some(x => x.id === v);
}
function isSort(v: string | null): v is CompaniesSort {
    return v === "fit" || v === "activity" || v === "name";
}

export function CompaniesScreen() {
    const { segmentId, href, startRun, activeRun } = useProspects();
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const view: CompaniesView = isView(params.get("view"))
        ? (params.get("view") as CompaniesView)
        : "all";
    const sort: CompaniesSort = isSort(params.get("sort"))
        ? (params.get("sort") as CompaniesSort)
        : "fit";
    const query = params.get("q") ?? "";
    const [draft, setDraft] = useState(query);
    useEffect(() => setDraft(query), [query]);

    const setParam = useCallback(
        (patch: Record<string, string | null>) => {
            const next = new URLSearchParams(params.toString());
            for (const [k, v] of Object.entries(patch)) {
                if (
                    v === null ||
                    v === "" ||
                    (k === "view" && v === "all") ||
                    (k === "sort" && v === "fit")
                )
                    next.delete(k);
                else next.set(k, v);
            }
            const s = next.toString();
            router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
        },
        [params, pathname, router]
    );

    // Debounced search → URL.
    useEffect(() => {
        if (draft === query) return;
        const id = window.setTimeout(() => setParam({ q: draft }), 220);
        return () => window.clearTimeout(id);
    }, [draft, query, setParam]);

    const list = useResource(
        segmentId ? `companies:${segmentId}:${view}:${sort}:${query}` : null,
        () => prospectsApi.companies({ segmentId: segmentId!, view, sort, q: query })
    );
    const finished = activeRun?.status === "completed";
    const reload = list.reload;
    useEffect(() => {
        if (finished) void reload();
    }, [finished, reload]);

    const companies = useMemo(() => list.data?.companies ?? [], [list.data]);
    useEffect(() => {
        if (companies.length) rememberListOrder(companies.map(c => c.id));
    }, [companies]);

    // Selection + keyboard triage.
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [cursor, setCursor] = useState<number>(-1);
    const searchRef = useRef<HTMLInputElement>(null);
    useEffect(() => setSelected(new Set()), [view, query, segmentId]);
    useEffect(() => {
        if (cursor >= companies.length) setCursor(companies.length - 1);
    }, [companies.length, cursor]);

    const toggle = useCallback((id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const open = useCallback((id: string) => router.push(href(`/companies/${id}`)), [href, router]);

    const outreach = useCallback(async (ids: string[]) => {
        if (ids.length === 0) return;
        try {
            const result = await prospectsApi.outreach({ companyIds: ids });
            toast.success(
                `Campaign drafted in Email for ${result.people} ${result.people === 1 ? "company" : "companies"}. Approve it there; nothing is sent from here.`
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not draft outreach");
        }
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing =
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable);
            if (e.key === "/" && !typing) {
                e.preventDefault();
                searchRef.current?.focus();
                return;
            }
            if (typing) {
                if (e.key === "Escape") (target as HTMLInputElement).blur();
                return;
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (companies.length === 0) return;
            if (e.key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(c => Math.min(companies.length - 1, c + 1));
            } else if (e.key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(c => Math.max(0, c - 1));
            } else if (e.key === "x" && cursor >= 0) {
                e.preventDefault();
                toggle(companies[cursor]!.id);
            } else if (e.key === "Enter" && cursor >= 0) {
                e.preventDefault();
                open(companies[cursor]!.id);
            } else if (e.key === "o") {
                e.preventDefault();
                const ids =
                    selected.size > 0 ? [...selected] : cursor >= 0 ? [companies[cursor]!.id] : [];
                void outreach(ids);
            } else if (e.key === "Escape") {
                setSelected(new Set());
                setCursor(-1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [companies, cursor, open, outreach, selected, toggle]);

    useEffect(() => {
        if (cursor < 0) return;
        document
            .querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

    const counts = list.data?.counts;
    const allChecked = companies.length > 0 && companies.every(c => selected.has(c.id));

    const bulk = async (action: "qualify" | "exclude" | "include") => {
        const ids = [...selected];
        try {
            if (action === "exclude" || action === "include") {
                await prospectsApi.setExcluded(ids, action === "exclude");
                toast.success(
                    action === "exclude"
                        ? `${ids.length} excluded from future runs`
                        : `${ids.length} back in the segment`
                );
            } else {
                const details = await Promise.all(ids.map(id => prospectsApi.company(id)));
                let moved = 0;
                const refused: string[] = [];
                for (const { company } of details) {
                    const move = company.deal.allowedMoves.find(m => m.stage === "qualified");
                    if (!move || move.reason) {
                        refused.push(company.name);
                        continue;
                    }
                    await prospectsApi.patchDeal(company.deal.id, { stage: "qualified" });
                    moved += 1;
                }
                if (moved) toast.success(`${moved} moved to Qualified`);
                if (refused.length)
                    toast(
                        `Not moved: ${refused.slice(0, 3).join(", ")}${refused.length > 3 ? "…" : ""}`
                    );
            }
            setSelected(new Set());
            await list.reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update");
        }
    };

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Companies"
                sub={
                    counts
                        ? `${counts.all} in this segment${counts.new ? ` · ${counts.new} new since the last run` : ""}`
                        : undefined
                }
                actions={
                    <Button
                        size="sm"
                        onClick={() =>
                            void startRun().catch((e: unknown) =>
                                toast.error(
                                    e instanceof Error ? e.message : "Could not start the run"
                                )
                            )
                        }
                        disabled={!segmentId}
                    >
                        Find companies
                    </Button>
                }
            />

            <div className="flex flex-wrap items-center gap-2.5">
                <ToggleGroup
                    type="single"
                    value={view}
                    onValueChange={v => v && setParam({ view: v })}
                    size="sm"
                    className="border-line bg-panel gap-0.5 rounded-md border p-0.5"
                    aria-label="View"
                >
                    {VIEWS.map(v => (
                        <ToggleGroupItem
                            key={v.id}
                            value={v.id}
                            className="data-[state=on]:shadow-1 h-7 rounded-[5px] px-2.5 text-xs"
                        >
                            {v.label}
                            {counts && (
                                <span className="text-ink-3 ml-1.5 text-[11px] tabular-nums">
                                    {counts[v.id]}
                                </span>
                            )}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <div className="relative">
                    <Search className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                    <Input
                        ref={searchRef}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder="Search companies"
                        aria-label="Search companies"
                        className="h-8 w-[240px] pl-8 pr-8 text-[13px]"
                    />
                    <kbd className="text-ink-4 border-line pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border px-1 font-mono text-[10px]">
                        /
                    </kbd>
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs">
                    <span className="text-ink-3">Sort</span>
                    <Select value={sort} onValueChange={v => setParam({ sort: v })}>
                        <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Sort by">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="fit">Fit</SelectItem>
                            <SelectItem value="activity">Last activity</SelectItem>
                            <SelectItem value="name">Name</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}

            {list.loading ? (
                <SkeletonRows rows={8} height={52} />
            ) : companies.length === 0 ? (
                <EmptyState
                    title={
                        query
                            ? `No companies match “${query}”`
                            : view === "all"
                              ? "No companies in this segment yet"
                              : `Nothing in ${VIEWS.find(v => v.id === view)?.label ?? view}`
                    }
                    body={
                        view === "all" && !query
                            ? "Run Find companies to search the sources this segment has on."
                            : "Clear the filter, or find more companies."
                    }
                    action={
                        <>
                            {(query || view !== "all") && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setDraft("");
                                        setParam({ q: null, view: null });
                                    }}
                                >
                                    Clear filter
                                </Button>
                            )}
                            <Button size="sm" onClick={() => void startRun()}>
                                Find companies
                            </Button>
                        </>
                    }
                />
            ) : (
                <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                    <Table className="text-[13px]">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-9 pl-3">
                                    <Checkbox
                                        aria-label="Select all"
                                        checked={allChecked}
                                        onCheckedChange={checked =>
                                            setSelected(
                                                checked
                                                    ? new Set(companies.map(c => c.id))
                                                    : new Set()
                                            )
                                        }
                                    />
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Company
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Why them
                                </TableHead>
                                <TableHead className="text-ink-3 w-[120px] text-xs font-medium">
                                    Fit
                                </TableHead>
                                <TableHead className="text-ink-3 w-[150px] text-xs font-medium">
                                    Stage
                                </TableHead>
                                <TableHead className="text-ink-3 w-[72px] text-right text-xs font-medium">
                                    People
                                </TableHead>
                                <TableHead className="text-ink-3 w-[120px] text-xs font-medium">
                                    Activity
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {companies.map((c, i) => (
                                <CompanyTableRow
                                    key={c.id}
                                    c={c}
                                    index={i}
                                    focused={i === cursor}
                                    checked={selected.has(c.id)}
                                    onToggle={() => toggle(c.id)}
                                    onOpen={() => open(c.id)}
                                    href={href(`/companies/${c.id}`)}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <p className="text-ink-4 text-[11.5px]">
                <kbd className="font-mono">j</kbd> <kbd className="font-mono">k</kbd> move ·{" "}
                <kbd className="font-mono">x</kbd> select · <kbd className="font-mono">Enter</kbd>{" "}
                open · <kbd className="font-mono">o</kbd> add to outreach ·{" "}
                <kbd className="font-mono">/</kbd> search
            </p>

            <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
                <Button size="sm" onClick={() => void outreach([...selected])}>
                    Add to outreach
                </Button>
                <Button size="sm" variant="outline" onClick={() => void bulk("qualify")}>
                    Move to Qualified
                </Button>
                {view === "excluded" ? (
                    <Button size="sm" variant="outline" onClick={() => void bulk("include")}>
                        Include again
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" onClick={() => void bulk("exclude")}>
                        Exclude
                    </Button>
                )}
            </BulkBar>
        </div>
    );
}

function CompanyTableRow({
    c,
    index,
    focused,
    checked,
    onToggle,
    onOpen,
    href,
}: {
    c: CompanyRow;
    index: number;
    focused: boolean;
    checked: boolean;
    onToggle: () => void;
    onOpen: () => void;
    href: string;
}) {
    return (
        <TableRow
            data-row-index={index}
            data-state={checked ? "selected" : undefined}
            className={cn(
                "cursor-pointer",
                checked && "bg-brand-soft/60 hover:bg-brand-soft/80",
                focused && "outline-brand outline outline-2 -outline-offset-2"
            )}
            onClick={e => {
                if ((e.target as HTMLElement).closest("[data-no-open]")) return;
                onOpen();
            }}
        >
            <TableCell className="pl-3" data-no-open>
                <Checkbox
                    aria-label={`Select ${c.name}`}
                    checked={checked}
                    onCheckedChange={onToggle}
                />
            </TableCell>
            <TableCell className="min-w-[240px] max-w-[300px] whitespace-normal">
                <Link
                    href={href}
                    className="text-ink block truncate font-medium hover:underline"
                    onClick={e => e.stopPropagation()}
                >
                    {c.name}
                    {c.isNew && (
                        <span className="bg-brand-soft text-brand-ink ml-2 rounded px-1.5 py-px align-middle text-[10.5px] font-medium">
                            new
                        </span>
                    )}
                </Link>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1" data-no-open>
                    {c.domain && (
                        <span className="text-ink-3 font-mono text-[11px]">{c.domain}</span>
                    )}
                    <FoundViaChips items={c.foundVia} max={2} />
                </span>
            </TableCell>
            <TableCell className="text-ink-2 min-w-[260px] max-w-[380px] whitespace-normal">
                <span className="line-clamp-2 leading-snug">{c.why}</span>
                {c.excluded && c.excludedReason && (
                    <span className="text-ink-3 mt-0.5 block text-xs">{c.excludedReason}</span>
                )}
            </TableCell>
            <TableCell>
                <FitMeter value={c.fit} threshold={c.fitThreshold} />
            </TableCell>
            <TableCell>
                <StagePill stage={c.stage} staleDays={c.staleDays} />
            </TableCell>
            <TableCell className="text-ink-2 text-right tabular-nums">{c.people}</TableCell>
            <TableCell className="text-ink-3 whitespace-normal text-xs">
                {c.isNew ? "found in the last run" : relativeTime(c.lastActivityAt)}
            </TableCell>
        </TableRow>
    );
}
