"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
    ArrowUpRight,
    FileText,
    Globe,
    HandCoins,
    Loader2,
    Phone,
    RefreshCw,
    Search,
    Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { ToolFrame, ToolMark, ToolNotFound } from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolPathname, type ToolHost } from "~/components/tool-app/nav";
import { PageHeader } from "~/components/tools/PageHeader";
import { copyText } from "~/lib/context-menu";

import {
    fundsMarkdown,
    introPrompt,
    peopleOf,
    PITCH_STARTER_KEYS,
    PITCH_STARTERS,
    raiseLine,
    resultSummary,
    sortFunds,
    US_STATES,
    websiteSearchUrl,
    WITHIN_OPTIONS,
    type FundProfile,
    type InvestorSearchResult,
} from "./investors";

export interface InvestorsPaneProps {
    /** What the workspace hands a tool's tab: focus, a location, memory. */
    host?: ToolHost;
    /**
     * Put a prompt in the chat composer and switch to the chat tab. Omitted
     * where there is no chat beside the pane; the prompt is copied instead.
     */
    onDraftInChat?: (prompt: string) => void;
    /** Open Add knowledge with this text, so the list becomes a source. */
    onSaveAsSource?: (markdown: string) => void;
}

interface SearchForm {
    q: string;
    state: string;
    withinDays: number;
    spvs: boolean;
}

const ALL_STATES = "all";
const DEFAULT_FORM: SearchForm = { q: "", state: "", withinDays: 90, spvs: false };

type SearchState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "done"; result: InvestorSearchResult; form: SearchForm };

/**
 * Investor relations: find the funds raising now, then pitch them with what
 * the workspace can prove.
 *
 * Finding reads SEC Form D filings — a venture fund raising a new vehicle
 * files one, and a fund that has just raised is about to invest. Pitching is
 * the chat's work: each starter drafts from the workspace's own sources and
 * says what is missing, so this pane holds prompts, not a second editor.
 *
 * Two screens in the same frame as every other tool: Find investors ("/")
 * and Pitch starters ("/pitch").
 */
export function InvestorsPane({ host, ...props }: InvestorsPaneProps) {
    return (
        <ToolNavProvider toolId="investors" roots={INVESTOR_ROOTS} host={host}>
            <InvestorsFrame {...props} />
        </ToolNavProvider>
    );
}

const INVESTOR_ROOTS = ["pitch"] as const;

function InvestorsFrame({ onDraftInChat, onSaveAsSource }: Omit<InvestorsPaneProps, "host">) {
    const t = useTranslations("team.investors");
    const tc = useTranslations("common");
    const path = useToolPathname();
    // The search lives above the screens, so a trip to the pitch starters
    // and back finds the results where they were.
    const [form, setForm] = useState<SearchForm>(DEFAULT_FORM);
    const [search, setSearch] = useState<SearchState>({ status: "loading" });
    const [sortBy, setSortBy] = useState<"newest" | "largest">("newest");
    const inflight = useRef<AbortController | null>(null);

    const run = useCallback(
        async (next: SearchForm) => {
            inflight.current?.abort();
            const controller = new AbortController();
            inflight.current = controller;
            setSearch({ status: "loading" });
            const params = new URLSearchParams({ within: String(next.withinDays) });
            if (next.q.trim()) params.set("q", next.q.trim());
            if (next.state) params.set("state", next.state);
            if (next.spvs) params.set("spvs", "1");
            try {
                const res = await fetch(`/api/investors/search?${params.toString()}`, {
                    signal: controller.signal,
                });
                const body = (await res.json().catch(() => ({}))) as
                    | InvestorSearchResult
                    | { error?: string };
                if (!res.ok || !("funds" in body)) {
                    const message =
                        "error" in body && body.error
                            ? body.error
                            : t("searchFailedStatus", { status: res.status });
                    setSearch({ status: "error", message });
                    return;
                }
                setSearch({ status: "done", result: body, form: next });
            } catch (err) {
                if (controller.signal.aborted) return;
                setSearch({
                    status: "error",
                    message: err instanceof Error ? err.message : t("searchFailed"),
                });
            }
        },
        [t]
    );

    // Something to look at on arrival: the last quarter, everywhere.
    useEffect(() => {
        void run(DEFAULT_FORM);
        return () => inflight.current?.abort();
    }, [run]);

    /** `copied` is the toast once the prompt is on the clipboard. */
    const draft = useCallback(
        async (prompt: string, copied: string) => {
            if (onDraftInChat) {
                onDraftInChat(prompt);
                return;
            }
            if (await copyText(prompt)) toast.success(copied);
            else toast.error(t("copyFailed"));
        },
        [onDraftInChat, t]
    );

    const screen =
        path === "/" ? (
            <div className="flex flex-col gap-4">
                <PageHeader title={t("find.title")} sub={t("find.sub")} />
                <form
                    className="flex flex-col gap-2.5"
                    onSubmit={e => {
                        e.preventDefault();
                        void run(form);
                    }}
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-52 flex-1">
                            <Search className="text-ink-4 absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                            <Input
                                value={form.q}
                                onChange={e => setForm(f => ({ ...f, q: e.target.value }))}
                                placeholder={t("find.focusPlaceholder")}
                                aria-label={t("find.focusLabel")}
                                className="h-8 pl-8 text-[13px]"
                            />
                        </div>
                        <Select
                            value={form.state || ALL_STATES}
                            onValueChange={v =>
                                setForm(f => ({ ...f, state: v === ALL_STATES ? "" : v }))
                            }
                        >
                            <SelectTrigger
                                className="h-8 w-40 text-xs"
                                aria-label={t("find.stateLabel")}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_STATES}>{t("find.anywhere")}</SelectItem>
                                {US_STATES.map(([code, name]) => (
                                    <SelectItem key={code} value={code}>
                                        {name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select
                            value={String(form.withinDays)}
                            onValueChange={v => setForm(f => ({ ...f, withinDays: Number(v) }))}
                        >
                            <SelectTrigger
                                className="h-8 w-36 text-xs"
                                aria-label={t("find.withinLabel")}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {WITHIN_OPTIONS.map(o => (
                                    <SelectItem key={o.days} value={String(o.days)}>
                                        {t(`within.d${o.days}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button type="submit" size="sm" disabled={search.status === "loading"}>
                            {search.status === "loading" ? (
                                <Loader2 className="animate-spin" />
                            ) : (
                                <Search />
                            )}
                            {tc("actions.search")}
                        </Button>
                    </div>
                    <div className="text-ink-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="investors-spvs"
                                checked={form.spvs}
                                onCheckedChange={v => setForm(f => ({ ...f, spvs: v === true }))}
                            />
                            <Label
                                htmlFor="investors-spvs"
                                className="text-ink-3 text-[12px] font-normal"
                            >
                                {t("find.spvs")}
                            </Label>
                        </div>
                        <span>{t("find.sourceNote")}</span>
                    </div>
                </form>

                <Results
                    search={search}
                    sortBy={sortBy}
                    onSortBy={setSortBy}
                    onRetry={() => void run(form)}
                    onDraftIntro={fund =>
                        void draft(introPrompt(fund), t("copiedIntro", { fund: fund.name }))
                    }
                    onSaveAsSource={
                        onSaveAsSource && search.status === "done"
                            ? () =>
                                  onSaveAsSource(
                                      fundsMarkdown(
                                          sortFunds(search.result.funds, sortBy),
                                          search.form
                                      )
                                  )
                            : undefined
                    }
                    draftLabel={onDraftInChat ? t("draftIntro") : t("copyIntro")}
                />
            </div>
        ) : path === "/pitch" ? (
            <div className="flex flex-col gap-4">
                <PageHeader title={t("pitch.title")} sub={t("pitch.sub")} />
                <div className="@max-md:grid-cols-1 grid grid-cols-2 gap-3">
                    {PITCH_STARTERS.map(starter => {
                        const key = PITCH_STARTER_KEYS[starter.id];
                        const title = t(`starters.${key}.title`);
                        return (
                            <article
                                key={starter.id}
                                className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-4"
                            >
                                <div>
                                    <h3 className="text-ink text-[13.5px] font-semibold">
                                        {title}
                                    </h3>
                                    <p className="text-ink-3 mt-0.5 text-[12.5px]">
                                        {t(`starters.${key}.desc`)}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="self-start"
                                    onClick={() =>
                                        void draft(starter.prompt, t("copiedStarter", { title }))
                                    }
                                >
                                    <Sparkles />
                                    {onDraftInChat ? t("pitch.draftInChat") : t("pitch.copyPrompt")}
                                </Button>
                            </article>
                        );
                    })}
                </div>
            </div>
        ) : (
            <ToolNotFound home="/" homeLabel={t("find.title")} />
        );

    return (
        <ToolFrame
            title={t("title")}
            mark={<ToolMark icon={HandCoins} />}
            contentClassName="max-w-[960px]"
            groups={[
                {
                    id: "investors",
                    items: [
                        { to: "/", label: t("find.title"), icon: Search, exact: true },
                        { to: "/pitch", label: t("pitch.title"), icon: Sparkles },
                    ],
                },
            ]}
        >
            <div data-testid="investors-pane">{screen}</div>
        </ToolFrame>
    );
}

interface ResultsProps {
    search: SearchState;
    sortBy: "newest" | "largest";
    onSortBy: (by: "newest" | "largest") => void;
    onRetry: () => void;
    onDraftIntro: (fund: FundProfile) => void;
    onSaveAsSource?: () => void;
    draftLabel: string;
}

function Results({
    search,
    sortBy,
    onSortBy,
    onRetry,
    onDraftIntro,
    onSaveAsSource,
    draftLabel,
}: ResultsProps) {
    const t = useTranslations("team.investors");
    const tc = useTranslations("common");
    if (search.status === "loading") {
        return (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("searching")}>
                {[0, 1, 2].map(i => (
                    <Skeleton key={i} className="h-[104px] rounded-xl" />
                ))}
            </div>
        );
    }

    if (search.status === "error") {
        return (
            <div className="border-line flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
                <p className="text-ink-2 text-[13px]">{search.message}</p>
                <Button size="sm" variant="outline" onClick={onRetry}>
                    <RefreshCw />
                    {tc("actions.tryAgain")}
                </Button>
            </div>
        );
    }

    const { result } = search;
    if (result.funds.length === 0) {
        return (
            <div className="border-line text-ink-3 rounded-xl border border-dashed py-12 text-center text-[13px]">
                {t("empty")}
            </div>
        );
    }

    const funds = sortFunds(result.funds, sortBy);
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-ink-3 font-mono text-[11px]" data-testid="investors-summary">
                    {resultSummary(t, result, funds.length)}
                </p>
                <div className="flex items-center gap-2">
                    <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        value={sortBy}
                        onValueChange={v => v && onSortBy(v as "newest" | "largest")}
                        aria-label={t("sortLabel")}
                    >
                        <ToggleGroupItem value="newest" className="px-2.5 text-xs">
                            {t("newest")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="largest" className="px-2.5 text-xs">
                            {t("largest")}
                        </ToggleGroupItem>
                    </ToggleGroup>
                    {onSaveAsSource && (
                        <Button size="sm" variant="outline" onClick={onSaveAsSource}>
                            <FileText />
                            {t("saveAsSource")}
                        </Button>
                    )}
                </div>
            </div>
            <ul className="flex flex-col gap-2.5">
                {funds.map(fund => (
                    <FundCard
                        key={fund.cik}
                        fund={fund}
                        onDraftIntro={() => onDraftIntro(fund)}
                        draftLabel={draftLabel}
                    />
                ))}
            </ul>
        </div>
    );
}

function FundCard({
    fund,
    onDraftIntro,
    draftLabel,
}: {
    fund: FundProfile;
    onDraftIntro: () => void;
    draftLabel: string;
}) {
    const t = useTranslations("team.investors");
    const format = useFormatter();
    const people = peopleOf(fund);
    const entities = fund.managers.filter(m => m.kind === "entity");
    const raise = raiseLine(t, fund);
    const shown = people.slice(0, 3);

    return (
        <li
            className="border-line bg-panel flex flex-col gap-2 rounded-xl border p-4"
            data-testid="investor-fund"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-ink flex min-w-0 items-center gap-2 text-[14px] font-semibold">
                        <span className="truncate">{fund.name}</span>
                        {fund.amendment && (
                            <Badge variant="secondary" className="shrink-0 text-[10.5px]">
                                {t("amended")}
                            </Badge>
                        )}
                    </h3>
                    <p className="text-ink-3 mt-0.5 text-[12.5px]">
                        {[fund.location, raise].filter(Boolean).join(" · ") ||
                            t("detailsUnavailable")}
                    </p>
                </div>
                <span className="text-ink-3 shrink-0 font-mono text-[11px]">
                    {t("filed", {
                        date: format.dateTime(new Date(`${fund.filedAt}T00:00:00Z`), {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                        }),
                    })}
                </span>
            </div>

            {(shown.length > 0 || entities.length > 0) && (
                <p className="text-ink-2 text-[12.5px] leading-relaxed">
                    {shown.map((p, i) => (
                        <span key={`${p.name}-${i}`}>
                            {i > 0 && ", "}
                            <span className="text-ink font-medium">{p.name}</span>
                            {p.title && <span className="text-ink-3"> — {p.title}</span>}
                        </span>
                    ))}
                    {people.length > shown.length && (
                        <span className="text-ink-3">
                            {" "}
                            {t("more", { count: people.length - shown.length })}
                        </span>
                    )}
                    {entities.length > 0 && (
                        <span className="text-ink-3">
                            {shown.length > 0 ? " · " : ""}
                            {t("via", { name: entities[0]!.name })}
                        </span>
                    )}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Button size="sm" onClick={onDraftIntro}>
                    <Sparkles />
                    {draftLabel}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                    <a href={fund.filingUrl} target="_blank" rel="noopener noreferrer">
                        <FileText />
                        {t("filing")}
                        <ArrowUpRight className="text-ink-3" />
                    </a>
                </Button>
                <Button size="sm" variant="ghost" asChild>
                    <a href={websiteSearchUrl(fund)} target="_blank" rel="noopener noreferrer">
                        <Globe />
                        {t("website")}
                        <ArrowUpRight className="text-ink-3" />
                    </a>
                </Button>
                {fund.phone && (
                    <Button size="sm" variant="ghost" asChild>
                        <a href={`tel:${fund.phone.replace(/[^\d+]/g, "")}`}>
                            <Phone />
                            {fund.phone}
                        </a>
                    </Button>
                )}
            </div>
        </li>
    );
}
