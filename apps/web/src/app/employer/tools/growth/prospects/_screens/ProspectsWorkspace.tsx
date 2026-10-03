"use client";

import { ChevronDown, Loader2, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ProspectsMark } from "~/components/icons/prospects";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

import {
    ProspectsApiError,
    prospectsApi,
    type CompaniesSort,
    type CompaniesView,
    type CompanyRow,
    type DealRow,
    type EmailStatusKind,
    type PersonRow,
    type SalesStage,
    type SourceYield,
} from "../api";
import { isRunLive, useProspects } from "../_lib/context";
import { withQuery } from "../../_lib/paths";
import { STAGE_LABELS } from "../_lib/stages";
import { plural, relativeTime } from "../../_lib/format";
import { useResource } from "../../_lib/useResource";
import { EmptyState, InlineError } from "../../_components/EmptyState";
import { SectionHeading } from "../../_components/PageHeader";
import { SkeletonRows } from "../../_components/SkeletonRows";
import { ToolHeader, ToolPage } from "../../_components/ToolHeader";
import { BulkBar } from "../_components/BulkBar";
import { CompaniesTable } from "../_components/CompaniesTable";
import { CompanyPanel } from "../_components/CompanyPanel";
import { DealsBoard } from "../_components/DealsBoard";
import { EMAIL_STATUS_LABEL, canOutreach } from "../_components/EmailStatus";
import { FitMeter } from "../_components/FitMeter";
import { FunnelBar } from "../_components/FunnelBar";
import { ListFooter } from "../_components/ListFooter";
import { PeopleTable } from "../_components/PeopleTable";
import { RunsPanel } from "../_components/RunsPanel";
import { SegmentPanel } from "../_components/SegmentPanel";
import { SegmentSwitcher } from "../_components/SegmentSwitcher";

type View = "companies" | "people" | "deals";
const VIEWS: Array<{ id: View; label: string }> = [
    { id: "companies", label: "Companies" },
    { id: "people", label: "People" },
    { id: "deals", label: "Deals" },
];
const COMPANY_FILTERS: Array<{ id: CompaniesView; label: string }> = [
    { id: "all", label: "All" },
    { id: "new", label: "New" },
    { id: "highfit", label: "High fit" },
    { id: "uncontacted", label: "Not contacted" },
    { id: "excluded", label: "Excluded" },
];
const PEOPLE_FILTERS: Array<{ id: "all" | EmailStatusKind; label: string }> = [
    { id: "all", label: "All" },
    { id: "found", label: EMAIL_STATUS_LABEL.found },
    { id: "generic", label: EMAIL_STATUS_LABEL.generic },
];
const PAGE = 50;

const isView = (v: string | null): v is View => VIEWS.some(x => x.id === v);
const isCompanyFilter = (v: string | null): v is CompaniesView =>
    COMPANY_FILTERS.some(x => x.id === v);
const isPeopleFilter = (v: string | null): v is "all" | EmailStatusKind =>
    PEOPLE_FILTERS.some(x => x.id === v);
const isSort = (v: string | null): v is CompaniesSort =>
    v === "fit" || v === "activity" || v === "name";

function reasonOf(e: unknown, fallback: string): string {
    if (
        e instanceof ProspectsApiError &&
        e.body &&
        typeof e.body === "object" &&
        "reason" in e.body
    )
        return String((e.body as { reason: unknown }).reason);
    return e instanceof Error ? e.message : fallback;
}

/** "/companies?view=new" from the to-do list, spelled as this page's URL state. */
function todoTarget(href: string): Record<string, string | null> {
    if (href.startsWith("/deals")) return { view: "deals", filter: null };
    const view = /view=([a-z]+)/.exec(href)?.[1] ?? null;
    return { view: "companies", filter: view && view !== "all" ? view : null };
}

function YieldRow({ y, max }: { y: SourceYield; max: number }) {
    const off = y.status === "off" || y.status === "skipped";
    return (
        <div className="border-line-2 grid grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-3 border-t py-1.5 text-[12.5px] first:border-t-0">
            <span className={cn("truncate", off ? "text-ink-3" : "text-ink")}>{y.label}</span>
            <span className="bg-line-2 relative h-1.5 overflow-hidden rounded-full" aria-hidden>
                {!off && (
                    <span
                        className="bg-ink-3 absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${max ? (y.found / max) * 100 : 0}%` }}
                    />
                )}
            </span>
            <span className="text-ink-2 text-right tabular-nums">
                {off ? (
                    <span className="text-ink-3 text-[11px]">{y.detail ?? "off"}</span>
                ) : (
                    y.found
                )}
            </span>
        </div>
    );
}

function RunPill() {
    const { activeRun, openPanel } = useProspects();
    if (!activeRun || !isRunLive(activeRun)) return null;
    const current = activeRun.steps.find(s => s.status === "running");
    const doing = activeRun.progress
        ? `${activeRun.progress.profiled} of ${activeRun.progress.shortlisted} profiled`
        : (current?.label.toLowerCase() ?? "starting");
    return (
        <button
            type="button"
            onClick={() => openPanel("runs")}
            className="bg-brand-soft text-brand-ink hover:bg-brand-soft/80 focus-visible:ring-brand/50 inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs outline-none focus-visible:ring-[3px]"
            aria-label="Open the run in progress"
        >
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span className="max-w-[220px] truncate">
                {activeRun.stopRequested ? "Stopping" : "Finding companies"} · {doing}
            </span>
        </button>
    );
}

/**
 * Prospects as one workspace: the segment in the header, what needs doing
 * beside the list, and the list itself in three views. A company opens in a
 * side panel; runs and the segment do too. The URL holds the view, the
 * filter, the search, the sort and the open company.
 */
export function ProspectsWorkspace() {
    const {
        segmentId,
        segment,
        segmentsLoading,
        segments,
        activeRun,
        nextMode,
        runsVersion,
        panel,
        openPanel,
        closePanel,
        startRun,
        samplePreferred,
        setSamplePreferred,
    } = useProspects();
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();

    const view: View = isView(params.get("view")) ? (params.get("view") as View) : "companies";
    const companyFilter: CompaniesView = isCompanyFilter(params.get("filter"))
        ? (params.get("filter") as CompaniesView)
        : "all";
    const peopleFilter: "all" | EmailStatusKind = isPeopleFilter(params.get("filter"))
        ? (params.get("filter") as "all" | EmailStatusKind)
        : "all";
    const sort: CompaniesSort = isSort(params.get("sort"))
        ? (params.get("sort") as CompaniesSort)
        : "fit";
    const query = params.get("q") ?? "";
    const openCompanyId = params.get("company");
    const panelParam = params.get("panel");

    const setParam = useCallback(
        (patch: Record<string, string | null>) => {
            const next = new URLSearchParams(params.toString());
            for (const [k, v] of Object.entries(patch)) {
                if (
                    v === null ||
                    v === "" ||
                    (k === "view" && v === "companies") ||
                    (k === "filter" && v === "all") ||
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

    // A panel named in the URL opens once, then the URL forgets it.
    useEffect(() => {
        if (panelParam === "runs" || panelParam === "segment") {
            openPanel(panelParam);
            setParam({ panel: null });
        }
    }, [panelParam, openPanel, setParam]);

    // Search: typed locally, written to the URL after a pause.
    const [draft, setDraft] = useState(query);
    useEffect(() => setDraft(query), [query]);
    useEffect(() => {
        if (draft === query) return;
        const id = window.setTimeout(() => setParam({ q: draft }), 220);
        return () => window.clearTimeout(id);
    }, [draft, query, setParam]);
    const searchRef = useRef<HTMLInputElement>(null);

    // ── Data ──────────────────────────────────────────────────────────────
    const home = useResource(segmentId ? `home:${segmentId}:${runsVersion}` : null, () =>
        prospectsApi.home(segmentId!)
    );

    const companiesKey =
        view === "companies" && segmentId
            ? `companies:${segmentId}:${companyFilter}:${sort}:${query}:${runsVersion}`
            : null;
    const companies = useResource(companiesKey, () =>
        prospectsApi.companies({
            segmentId: segmentId!,
            view: companyFilter,
            sort,
            q: query,
            limit: PAGE,
        })
    );
    const [moreCompanies, setMoreCompanies] = useState<CompanyRow[]>([]);
    useEffect(() => setMoreCompanies([]), [companiesKey]);

    const peopleKey =
        view === "people" && segmentId
            ? `people:${segmentId}:${peopleFilter}:${query}:${runsVersion}`
            : null;
    const people = useResource(peopleKey, () =>
        prospectsApi.people({
            segmentId: segmentId!,
            q: query || undefined,
            status: peopleFilter === "all" ? undefined : peopleFilter,
            limit: PAGE,
        })
    );
    const [morePeople, setMorePeople] = useState<PersonRow[]>([]);
    useEffect(() => setMorePeople([]), [peopleKey]);

    const dealsKey = view === "deals" && segmentId ? `deals:${segmentId}:${runsVersion}` : null;
    const deals = useResource(dealsKey, () => prospectsApi.deals(segmentId!));

    const companyRows = useMemo(
        () => [...(companies.data?.companies ?? []), ...moreCompanies],
        [companies.data, moreCompanies]
    );
    const peopleRows = useMemo(
        () => [...(people.data?.people ?? []), ...morePeople],
        [people.data, morePeople]
    );
    const [loadingMore, setLoadingMore] = useState(false);
    const loadMore = async () => {
        if (!segmentId) return;
        setLoadingMore(true);
        try {
            if (view === "companies") {
                const offset = companyRows.length;
                const page = await prospectsApi.companies({
                    segmentId,
                    view: companyFilter,
                    sort,
                    q: query,
                    limit: PAGE,
                    offset,
                });
                setMoreCompanies(prev => [...prev, ...page.companies]);
            } else if (view === "people") {
                const offset = peopleRows.length;
                const page = await prospectsApi.people({
                    segmentId,
                    q: query || undefined,
                    status: peopleFilter === "all" ? undefined : peopleFilter,
                    limit: PAGE,
                    offset,
                });
                setMorePeople(prev => [...prev, ...page.people]);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not load more");
        } finally {
            setLoadingMore(false);
        }
    };
    const companiesTotal = companies.data?.total ?? 0;
    const peopleTotal = people.data?.total ?? 0;
    const companiesHasMore = companyRows.length < companiesTotal;
    const peopleHasMore = peopleRows.length < peopleTotal;

    const reloadLists = useCallback(() => {
        void home.reload();
        if (view === "companies") void companies.reload();
        if (view === "people") void people.reload();
        if (view === "deals") void deals.reload();
    }, [home, companies, people, deals, view]);

    // ── Selection and keyboard ────────────────────────────────────────────
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [cursor, setCursor] = useState(-1);
    useEffect(() => {
        setSelected(new Set());
        setCursor(-1);
    }, [view, companyFilter, peopleFilter, query, segmentId]);
    useEffect(() => {
        if (cursor >= companyRows.length) setCursor(companyRows.length - 1);
    }, [companyRows.length, cursor]);

    const toggle = useCallback((id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const openCompany = useCallback((id: string) => setParam({ company: id }), [setParam]);
    const closeCompany = useCallback(() => setParam({ company: null }), [setParam]);

    // Previous and next for the open panel walk the list behind it.
    const panelIds = useMemo(() => {
        if (view === "companies") return companyRows.map(c => c.id);
        if (view === "people") return [...new Set(peopleRows.map(p => p.companyId))];
        return (deals.data?.deals ?? []).map(d => d.companyId);
    }, [view, companyRows, peopleRows, deals.data]);
    const panelIndex = openCompanyId ? panelIds.indexOf(openCompanyId) : -1;
    const prevId = panelIndex > 0 ? panelIds[panelIndex - 1]! : null;
    const nextId =
        panelIndex >= 0 && panelIndex < panelIds.length - 1 ? panelIds[panelIndex + 1]! : null;

    const outreach = useCallback(
        async (input: { personIds?: string[]; companyIds?: string[] }) => {
            try {
                const result = await prospectsApi.outreach(input);
                toast.success(
                    `Campaign drafted in Email for ${plural(result.people, input.personIds ? "person" : "company", input.personIds ? "people" : "companies")}. Approve it there; nothing is sent from here.${result.skipped.length ? ` ${result.skipped.length} skipped.` : ""}`
                );
                setSelected(new Set());
                reloadLists();
            } catch (e) {
                toast.error(reasonOf(e, "Could not draft outreach"));
            }
        },
        [reloadLists]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing =
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT" ||
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
            if (openCompanyId) {
                if (e.key === "ArrowDown" && nextId) {
                    e.preventDefault();
                    openCompany(nextId);
                } else if (e.key === "ArrowUp" && prevId) {
                    e.preventDefault();
                    openCompany(prevId);
                }
                return;
            }
            if (view !== "companies" || companyRows.length === 0) return;
            if (e.key === "j" || e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(c => Math.min(companyRows.length - 1, c + 1));
            } else if (e.key === "k" || e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(c => Math.max(0, c - 1));
            } else if (e.key === "x" && cursor >= 0) {
                e.preventDefault();
                toggle(companyRows[cursor]!.id);
            } else if (e.key === "Enter" && cursor >= 0) {
                e.preventDefault();
                openCompany(companyRows[cursor]!.id);
            } else if (e.key === "o") {
                e.preventDefault();
                const ids =
                    selected.size > 0
                        ? [...selected]
                        : cursor >= 0
                          ? [companyRows[cursor]!.id]
                          : [];
                if (ids.length > 0) void outreach({ companyIds: ids });
            } else if (e.key === "Escape") {
                setSelected(new Set());
                setCursor(-1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [
        companyRows,
        cursor,
        openCompany,
        openCompanyId,
        nextId,
        prevId,
        outreach,
        selected,
        toggle,
        view,
    ]);

    useEffect(() => {
        if (cursor < 0) return;
        document
            .querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [cursor]);

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
            reloadLists();
        } catch (e) {
            toast.error(reasonOf(e, "Could not update"));
        }
    };

    const moveDeal = async (deal: DealRow, stage: SalesStage) => {
        try {
            const { deal: updated } = await prospectsApi.patchDeal(deal.id, { stage });
            deals.mutate(current => ({
                deals: current.deals.map(d => (d.id === deal.id ? { ...d, ...updated } : d)),
            }));
            void home.reload();
        } catch (e) {
            toast.error(reasonOf(e, "Could not move the deal"));
        }
    };

    const find = async (sample?: boolean) => {
        try {
            await startRun(sample === undefined ? undefined : { sample });
        } catch (e) {
            toast.error(reasonOf(e, "Could not start the run"));
        }
    };

    // ── Render ────────────────────────────────────────────────────────────
    const d = home.data;
    const counts = segment?.counts;
    const live = isRunLive(activeRun);
    const noSegment = !segmentsLoading && segments.length === 0;
    const maxFound = d ? Math.max(1, ...d.yield.map(y => y.found)) : 1;
    const eligiblePeople = peopleRows.filter(p => canOutreach(p.emailStatus) && !p.blockedReason);

    return (
        <ToolPage>
            <ToolHeader
                icon={<ProspectsMark size={18} />}
                title="Prospects"
                description={
                    segment
                        ? `${segment.headline}. ${plural(segment.counts.companies, "company", "companies")}, ${plural(segment.counts.deals, "deal")}${d?.lastRunAt ? `, last run ${relativeTime(d.lastRunAt)}` : ", no run yet"}.`
                        : "Find the companies that would buy what you sell, profile them with evidence, and run the deals."
                }
                actions={
                    <>
                        <RunPill />
                        <SegmentSwitcher />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openPanel("segment")}
                            disabled={!segmentId}
                        >
                            Segment
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openPanel("runs")}
                            disabled={!segmentId}
                        >
                            Runs
                        </Button>
                        <span className="inline-flex">
                            <Button
                                size="sm"
                                className="rounded-r-none"
                                disabled={!segmentId || live}
                                onClick={() => void find()}
                            >
                                Find companies
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        size="sm"
                                        className="border-brand-fg/20 rounded-l-none border-l px-1.5"
                                        disabled={!segmentId}
                                        aria-label="Run options"
                                    >
                                        <ChevronDown className="size-3.5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuCheckboxItem
                                        checked={samplePreferred}
                                        onCheckedChange={v => setSamplePreferred(v === true)}
                                    >
                                        Use sample data
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        disabled={live}
                                        onSelect={() => void find(true)}
                                    >
                                        Run once with sample data
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => openPanel("runs")}>
                                        Open runs
                                    </DropdownMenuItem>
                                    {nextMode && (
                                        <div className="text-ink-3 px-2 py-1.5 text-[11.5px]">
                                            Next run uses{" "}
                                            {samplePreferred
                                                ? "sample data"
                                                : nextMode === "keyless"
                                                  ? "public sources, no keys"
                                                  : "live providers"}
                                            .
                                        </div>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </span>
                    </>
                }
            />

            {noSegment ? (
                <EmptyState
                    mark
                    title="Create a segment to start"
                    body="A segment is who you sell to and where. Find companies searches for it, profiles the best matches with cited evidence, and finds people to contact."
                    action={
                        <span className="text-ink-3 text-xs">Use the segment switcher above.</span>
                    }
                />
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="flex min-w-0 flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <ToggleGroup
                                type="single"
                                value={view}
                                onValueChange={v =>
                                    v && setParam({ view: v, filter: null, q: null })
                                }
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
                            {view === "companies" && (
                                <ToggleGroup
                                    type="single"
                                    value={companyFilter}
                                    onValueChange={v => v && setParam({ filter: v })}
                                    size="sm"
                                    className="flex-wrap gap-1"
                                    aria-label="Filter"
                                >
                                    {COMPANY_FILTERS.map(f => (
                                        <ToggleGroupItem
                                            key={f.id}
                                            value={f.id}
                                            className="border-line data-[state=on]:bg-panel-2 data-[state=on]:text-ink text-ink-2 h-7 rounded-full border px-2.5 text-xs"
                                        >
                                            {f.label}
                                            {companies.data?.counts && (
                                                <span className="text-ink-3 ml-1.5 text-[11px] tabular-nums">
                                                    {companies.data.counts[f.id]}
                                                </span>
                                            )}
                                        </ToggleGroupItem>
                                    ))}
                                </ToggleGroup>
                            )}
                            {view === "people" && (
                                <ToggleGroup
                                    type="single"
                                    value={peopleFilter}
                                    onValueChange={v => v && setParam({ filter: v })}
                                    size="sm"
                                    className="flex-wrap gap-1"
                                    aria-label="Email status"
                                >
                                    {PEOPLE_FILTERS.map(f => (
                                        <ToggleGroupItem
                                            key={f.id}
                                            value={f.id}
                                            className="border-line data-[state=on]:bg-panel-2 data-[state=on]:text-ink text-ink-2 h-7 rounded-full border px-2.5 text-xs"
                                        >
                                            {f.label}
                                        </ToggleGroupItem>
                                    ))}
                                </ToggleGroup>
                            )}
                            {view !== "deals" && (
                                <div className="relative">
                                    <Search className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                                    <Input
                                        ref={searchRef}
                                        value={draft}
                                        onChange={e => setDraft(e.target.value)}
                                        placeholder={
                                            view === "companies"
                                                ? "Search companies"
                                                : "Search people"
                                        }
                                        aria-label={
                                            view === "companies"
                                                ? "Search companies"
                                                : "Search people"
                                        }
                                        className="h-8 w-[220px] pl-8 pr-8 text-[13px]"
                                    />
                                    <kbd className="text-ink-4 border-line pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border px-1 font-mono text-[10px]">
                                        /
                                    </kbd>
                                </div>
                            )}
                            {view === "companies" && (
                                <div className="ml-auto flex items-center gap-2 text-xs">
                                    <span className="text-ink-3">Sort</span>
                                    <Select value={sort} onValueChange={v => setParam({ sort: v })}>
                                        <SelectTrigger
                                            className="h-8 w-[130px] text-xs"
                                            aria-label="Sort by"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="fit">Fit</SelectItem>
                                            <SelectItem value="activity">Last activity</SelectItem>
                                            <SelectItem value="name">Name</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        {view === "companies" && (
                            <>
                                {companies.error && (
                                    <InlineError
                                        message={companies.error}
                                        onRetry={() => void companies.reload()}
                                    />
                                )}
                                {companies.loading ? (
                                    <SkeletonRows rows={8} height={52} />
                                ) : companyRows.length === 0 ? (
                                    <EmptyState
                                        title={
                                            query
                                                ? `No companies match “${query}”`
                                                : companyFilter === "all"
                                                  ? "No companies in this segment yet"
                                                  : `Nothing in ${COMPANY_FILTERS.find(f => f.id === companyFilter)?.label ?? companyFilter}`
                                        }
                                        body={
                                            companyFilter === "all" && !query
                                                ? "Run Find companies to search the sources this segment has on."
                                                : "Clear the filter, or find more companies."
                                        }
                                        action={
                                            <>
                                                {(query || companyFilter !== "all") && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            setDraft("");
                                                            setParam({ q: null, filter: null });
                                                        }}
                                                    >
                                                        Clear filter
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    onClick={() => void find()}
                                                    disabled={live}
                                                >
                                                    Find companies
                                                </Button>
                                            </>
                                        }
                                    />
                                ) : (
                                    <>
                                        <CompaniesTable
                                            rows={companyRows}
                                            selected={selected}
                                            cursor={cursor}
                                            activeId={openCompanyId}
                                            onToggle={toggle}
                                            onToggleAll={checked =>
                                                setSelected(
                                                    checked
                                                        ? new Set(companyRows.map(c => c.id))
                                                        : new Set()
                                                )
                                            }
                                            onOpen={openCompany}
                                        />
                                        <ListFooter
                                            shown={companyRows.length}
                                            total={companiesTotal}
                                            noun="companies"
                                            hasMore={companiesHasMore}
                                            loadingMore={loadingMore}
                                            onMore={() => void loadMore()}
                                        />
                                        <p className="text-ink-4 text-[11.5px]">
                                            <kbd className="font-mono">j</kbd>{" "}
                                            <kbd className="font-mono">k</kbd> move ·{" "}
                                            <kbd className="font-mono">x</kbd> select ·{" "}
                                            <kbd className="font-mono">Enter</kbd> open ·{" "}
                                            <kbd className="font-mono">o</kbd> add to outreach ·{" "}
                                            <kbd className="font-mono">/</kbd> search
                                        </p>
                                    </>
                                )}
                            </>
                        )}

                        {view === "people" && (
                            <>
                                {people.error && (
                                    <InlineError
                                        message={people.error}
                                        onRetry={() => void people.reload()}
                                    />
                                )}
                                {people.loading ? (
                                    <SkeletonRows rows={8} height={48} />
                                ) : peopleRows.length === 0 ? (
                                    <EmptyState
                                        title={
                                            query ? `No people match “${query}”` : "No people yet"
                                        }
                                        body="People are the public mailboxes found on each company's own pages during a run. Run Find companies, or open a company to see who was found."
                                        action={
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    setParam({
                                                        view: "companies",
                                                        filter: null,
                                                        q: null,
                                                    })
                                                }
                                            >
                                                Open companies
                                            </Button>
                                        }
                                    />
                                ) : (
                                    <>
                                        <PeopleTable
                                            rows={peopleRows}
                                            selected={selected}
                                            onToggle={toggle}
                                            onToggleAll={checked =>
                                                setSelected(
                                                    checked
                                                        ? new Set(eligiblePeople.map(p => p.id))
                                                        : new Set()
                                                )
                                            }
                                            onOpenCompany={openCompany}
                                        />
                                        <ListFooter
                                            shown={peopleRows.length}
                                            total={peopleTotal}
                                            noun="people"
                                            hasMore={peopleHasMore}
                                            loadingMore={loadingMore}
                                            onMore={() => void loadMore()}
                                        />
                                    </>
                                )}
                            </>
                        )}

                        {view === "deals" && (
                            <>
                                {deals.error && (
                                    <InlineError
                                        message={deals.error}
                                        onRetry={() => void deals.reload()}
                                    />
                                )}
                                {deals.loading ? (
                                    <SkeletonRows rows={6} height={64} />
                                ) : (deals.data?.deals ?? []).filter(x => x.stage !== "lead")
                                      .length === 0 ? (
                                    <EmptyState
                                        title="No deals in motion"
                                        body="Qualify a company from the Companies list, or move one from its panel. Leads stay in Companies until you do."
                                        action={
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    setParam({
                                                        view: "companies",
                                                        filter: "uncontacted",
                                                    })
                                                }
                                            >
                                                See leads not yet qualified
                                            </Button>
                                        }
                                    />
                                ) : (
                                    <DealsBoard
                                        deals={deals.data?.deals ?? []}
                                        onMove={(deal, stage) => void moveDeal(deal, stage)}
                                        onOpen={openCompany}
                                    />
                                )}
                            </>
                        )}
                    </div>

                    <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
                        <section>
                            <SectionHeading
                                title="To do"
                                aside={d ? plural(d.todo.length, "item") : undefined}
                            />
                            {home.error && (
                                <InlineError
                                    message={home.error}
                                    onRetry={() => void home.reload()}
                                />
                            )}
                            {home.loading ? (
                                <SkeletonRows rows={2} height={52} />
                            ) : d && d.todo.length === 0 ? (
                                <p className="text-ink-3 text-[13px]">
                                    {d.lastRunAt
                                        ? "Nothing waiting on you. New high-fit companies, steps due and quiet deals show up here."
                                        : "Run Find companies to start; what needs doing shows up here."}
                                </p>
                            ) : (
                                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                                    {d?.todo.map(item => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() =>
                                                setParam({
                                                    ...todoTarget(item.action.href),
                                                    q: null,
                                                })
                                            }
                                            className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 block w-full border-t px-3 py-2.5 text-left outline-none first:border-t-0 focus-visible:ring-[3px]"
                                        >
                                            <span className="text-ink block text-[13px] font-medium">
                                                {item.title}
                                            </span>
                                            <span className="text-ink-3 block truncate text-xs">
                                                {item.detail}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section>
                            <SectionHeading
                                title="Deals"
                                aside={
                                    d?.medianDays
                                        ? `median ${d.medianDays.days} days ${STAGE_LABELS[d.medianDays.from]} to ${STAGE_LABELS[d.medianDays.to]}`
                                        : undefined
                                }
                            />
                            {home.loading || !d ? (
                                <Skeleton className="h-8 w-full" />
                            ) : (
                                <FunnelBar
                                    counts={d.funnel}
                                    hrefFor={() => withQuery(pathname, { view: "deals" })}
                                />
                            )}
                        </section>

                        <section>
                            <SectionHeading
                                title="Where companies come from"
                                aside={
                                    d?.lastRunAt
                                        ? `last run ${relativeTime(d.lastRunAt)}`
                                        : undefined
                                }
                            />
                            {home.loading || !d ? (
                                <SkeletonRows rows={4} height={32} />
                            ) : d.yield.length === 0 ? (
                                <p className="text-ink-3 text-[13px]">
                                    Each source&apos;s yield shows here after the first run.
                                </p>
                            ) : (
                                <div className="border-line bg-panel rounded-lg border px-3 py-1">
                                    {d.yield.map(y => (
                                        <YieldRow key={y.sourceId} y={y} max={maxFound} />
                                    ))}
                                </div>
                            )}
                        </section>

                        {d && d.fresh.length > 0 && (
                            <section>
                                <SectionHeading title="New and worth a look" />
                                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                                    {d.fresh.map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => openCompany(c.id)}
                                            className="border-line-2 hover:bg-panel-2 focus-visible:ring-brand/50 grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t px-3 py-2 text-left outline-none first:border-t-0 focus-visible:ring-[3px]"
                                        >
                                            <span className="min-w-0">
                                                <span className="text-ink block truncate text-[13px] font-medium">
                                                    {c.name}
                                                </span>
                                                <span className="text-ink-3 block truncate text-xs">
                                                    {c.why}
                                                </span>
                                            </span>
                                            <FitMeter value={c.fit} threshold={c.fitThreshold} />
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}
                    </aside>
                </div>
            )}

            {view === "companies" && (
                <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
                    <Button size="sm" onClick={() => void outreach({ companyIds: [...selected] })}>
                        Add to outreach
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void bulk("qualify")}>
                        Move to Qualified
                    </Button>
                    {companyFilter === "excluded" ? (
                        <Button size="sm" variant="outline" onClick={() => void bulk("include")}>
                            Include again
                        </Button>
                    ) : (
                        <Button size="sm" variant="outline" onClick={() => void bulk("exclude")}>
                            Exclude
                        </Button>
                    )}
                </BulkBar>
            )}
            {view === "people" && (
                <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
                    <Button size="sm" onClick={() => void outreach({ personIds: [...selected] })}>
                        Add to outreach
                    </Button>
                </BulkBar>
            )}

            <CompanyPanel
                id={openCompanyId}
                onClose={closeCompany}
                onPrev={prevId ? () => openCompany(prevId) : null}
                onNext={nextId ? () => openCompany(nextId) : null}
                onChanged={reloadLists}
            />
            <RunsPanel
                open={panel === "runs"}
                onOpenChange={o => (o ? openPanel("runs") : closePanel())}
            />
            <SegmentPanel
                open={panel === "segment"}
                onOpenChange={o => (o ? openPanel("segment") : closePanel())}
            />
        </ToolPage>
    );
}
