"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";
import {
    useToolActive,
    useToolPathname,
    useToolRouter,
    useToolSearchParams,
} from "~/components/tool-app/nav";

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
import { useCopyText } from "~/lib/tools/copyText";
import { useGrowthFormat } from "../../_lib/format";
import { useProspects } from "../_lib/context";
import { useErrorText } from "~/lib/tools/errorText";
import { rememberListOrder } from "../_lib/listOrder";
import { useResource } from "~/lib/tools/useResource";
import { BulkBar } from "../_components/BulkBar";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { FitMeter } from "~/components/tools/FitMeter";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { FoundViaChips } from "../_components/SourceChip";
import { StagePill } from "../_components/StagePill";

/** The list's views, in toggle order; each one's name is `companies.views.<view>`. */
const VIEWS: readonly CompaniesView[] = ["all", "new", "highfit", "uncontacted", "excluded"];

function isView(v: string | null): v is CompaniesView {
    return VIEWS.some(x => x === v);
}
function isSort(v: string | null): v is CompaniesSort {
    return v === "fit" || v === "activity" || v === "name";
}

export function CompaniesScreen() {
    const t = useTranslations("growth.prospects");
    const tc = useTranslations("common.actions");
    const { joinList } = useGrowthFormat();
    const errorText = useErrorText();
    const { segmentId, href, startRun, activeRun } = useProspects();
    const router = useToolRouter();
    const pathname = useToolPathname();
    const params = useToolSearchParams();
    const active = useToolActive();
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
            router.replace(s ? `${pathname}?${s}` : pathname);
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
    const tableRef = useRef<HTMLDivElement>(null);
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

    const outreach = useCallback(
        async (ids: string[]) => {
            if (ids.length === 0) return;
            try {
                const result = await prospectsApi.outreach({ companyIds: ids });
                toast.success(t("companies.drafted", { count: result.people }));
            } catch (e) {
                toast.error(errorText(e, t("common.outreachFailed")));
            }
        },
        [t, errorText]
    );

    // Tabs are hidden, not unmounted: only listen while this tab is the one
    // being used, or j/k would move this list from inside another tab.
    useEffect(() => {
        if (!active) return;
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
    }, [active, companies, cursor, open, outreach, selected, toggle]);

    // Looked up inside this table, not the document: other tabs stay mounted
    // and may have rows of their own.
    useEffect(() => {
        if (cursor < 0) return;
        tableRef.current
            ?.querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)
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
                        ? t("companies.excludedToast", { count: ids.length })
                        : t("companies.includedToast", { count: ids.length })
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
                if (moved) toast.success(t("companies.moved", { count: moved }));
                if (refused.length)
                    toast(
                        t("companies.notMoved", {
                            names: `${joinList(refused.slice(0, 3))}${refused.length > 3 ? "…" : ""}`,
                        })
                    );
            }
            setSelected(new Set());
            await list.reload();
        } catch (e) {
            toast.error(errorText(e, t("common.updateFailed")));
        }
    };

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
            <PageHeader
                size="md"
                title={t("common.companies")}
                sub={
                    counts
                        ? counts.new
                            ? t("companies.subNew", { count: counts.all, fresh: counts.new })
                            : t("companies.sub", { count: counts.all })
                        : undefined
                }
                actions={
                    <Button
                        size="sm"
                        onClick={() =>
                            void startRun().catch((e: unknown) =>
                                toast.error(errorText(e, t("common.startFailed")))
                            )
                        }
                        disabled={!segmentId}
                    >
                        {t("common.findCompanies")}
                    </Button>
                }
            />

            <div className="flex flex-wrap items-center gap-2.5">
                <ToggleGroup
                    type="single"
                    value={view}
                    onValueChange={v => v && setParam({ view: v })}
                    size="sm"
                    className="border-line bg-panel max-w-full justify-start gap-0.5 overflow-x-auto rounded-md border p-0.5"
                    aria-label={t("companies.viewAria")}
                >
                    {VIEWS.map(v => (
                        <ToggleGroupItem
                            key={v}
                            value={v}
                            className="data-[state=on]:shadow-1 h-7 shrink-0 rounded-[5px] px-2.5 text-xs"
                        >
                            {t(`companies.views.${v}`)}
                            {counts && (
                                <span className="text-ink-3 ml-1.5 text-[11px] tabular-nums">
                                    {counts[v]}
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
                        placeholder={t("companies.search")}
                        aria-label={t("companies.search")}
                        className="h-8 w-[240px] pl-8 pr-8 text-[13px]"
                    />
                    <kbd className="text-ink-4 border-line pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border px-1 font-mono text-[10px]">
                        /
                    </kbd>
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs">
                    <span className="text-ink-3">{t("companies.sort")}</span>
                    <Select value={sort} onValueChange={v => setParam({ sort: v })}>
                        <SelectTrigger
                            className="h-8 w-[130px] text-xs"
                            aria-label={t("companies.sortAria")}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="fit">{t("common.fit")}</SelectItem>
                            <SelectItem value="activity">{t("companies.sortActivity")}</SelectItem>
                            <SelectItem value="name">{t("companies.sortName")}</SelectItem>
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
                            ? t("companies.emptyQuery", { query })
                            : view === "all"
                              ? t("companies.emptyAll")
                              : t("companies.emptyView", { view: t(`companies.views.${view}`) })
                    }
                    body={
                        view === "all" && !query
                            ? t("companies.emptyAllBody")
                            : t("companies.emptyFilterBody")
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
                                    {t("companies.clearFilter")}
                                </Button>
                            )}
                            <Button size="sm" onClick={() => void startRun()}>
                                {t("common.findCompanies")}
                            </Button>
                        </>
                    }
                />
            ) : (
                <div
                    ref={tableRef}
                    className="border-line bg-panel overflow-x-auto rounded-lg border"
                >
                    <Table className="text-[13px]">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-9 pl-3">
                                    <Checkbox
                                        aria-label={tc("selectAll")}
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
                                    {t("common.company")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    {t("companies.why")}
                                </TableHead>
                                <TableHead className="text-ink-3 w-[120px] text-xs font-medium">
                                    {t("common.fit")}
                                </TableHead>
                                <TableHead className="text-ink-3 w-[150px] text-xs font-medium">
                                    {t("common.stage")}
                                </TableHead>
                                <TableHead className="text-ink-3 w-[72px] text-right text-xs font-medium">
                                    {t("common.people")}
                                </TableHead>
                                <TableHead className="text-ink-3 w-[120px] text-xs font-medium">
                                    {t("companies.activity")}
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
                {t.rich("companies.shortcuts", {
                    k: chunks => <kbd className="font-mono">{chunks}</kbd>,
                })}
            </p>

            <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
                <Button size="sm" onClick={() => void outreach([...selected])}>
                    {t("common.addToOutreach")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void bulk("qualify")}>
                    {t("companies.moveToQualified")}
                </Button>
                {view === "excluded" ? (
                    <Button size="sm" variant="outline" onClick={() => void bulk("include")}>
                        {t("common.includeAgain")}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" onClick={() => void bulk("exclude")}>
                        {t("common.exclude")}
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
    const t = useTranslations("growth.prospects");
    const { relativeTime } = useGrowthFormat();
    const word = useCopyText();
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
                    aria-label={t("common.select", { name: c.name })}
                    checked={checked}
                    onCheckedChange={onToggle}
                />
            </TableCell>
            <TableCell className="min-w-[240px] max-w-[300px] whitespace-normal">
                <ToolLink
                    href={href}
                    className="text-ink block truncate font-medium hover:underline"
                    onClick={e => e.stopPropagation()}
                >
                    {c.name}
                    {c.isNew && (
                        <span className="bg-brand-soft text-brand-ink ml-2 rounded px-1.5 py-px align-middle text-[10.5px] font-medium">
                            {t("companies.newBadge")}
                        </span>
                    )}
                </ToolLink>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1" data-no-open>
                    {c.domain && (
                        <span className="text-ink-3 font-mono text-[11px]">{c.domain}</span>
                    )}
                    <FoundViaChips items={c.foundVia} max={2} />
                </span>
            </TableCell>
            <TableCell className="text-ink-2 min-w-[260px] max-w-[380px] whitespace-normal">
                <span className="line-clamp-2 leading-snug">{word(c.whyCopy, c.why)}</span>
                {c.excluded && c.excludedReason && (
                    <span className="text-ink-3 mt-0.5 block text-xs">
                        {word(c.excludedReasonCopy, c.excludedReason)}
                    </span>
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
                {c.isNew ? t("companies.foundInLastRun") : relativeTime(c.lastActivityAt)}
            </TableCell>
        </TableRow>
    );
}
