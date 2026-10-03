"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { copyText } from "~/lib/context-menu";

import {
    describeRaise,
    fundsMarkdown,
    introPrompt,
    peopleOf,
    PITCH_STARTERS,
    resultSummary,
    sortFunds,
    US_STATES,
    websiteSearchUrl,
    WITHIN_OPTIONS,
    type FundProfile,
    type InvestorSearchResult,
} from "./investors";

export interface InvestorsPaneProps {
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
 */
export function InvestorsPane({ onDraftInChat, onSaveAsSource }: InvestorsPaneProps) {
    const [form, setForm] = useState<SearchForm>(DEFAULT_FORM);
    const [search, setSearch] = useState<SearchState>({ status: "loading" });
    const [sortBy, setSortBy] = useState<"newest" | "largest">("newest");
    const inflight = useRef<AbortController | null>(null);

    const run = useCallback(async (next: SearchForm) => {
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
                    "error" in body && body.error ? body.error : `Search failed (${res.status})`;
                setSearch({ status: "error", message });
                return;
            }
            setSearch({ status: "done", result: body, form: next });
        } catch (err) {
            if (controller.signal.aborted) return;
            setSearch({
                status: "error",
                message: err instanceof Error ? err.message : "Search failed",
            });
        }
    }, []);

    // Something to look at on arrival: the last quarter, everywhere.
    useEffect(() => {
        void run(DEFAULT_FORM);
        return () => inflight.current?.abort();
    }, [run]);

    const draft = useCallback(
        async (prompt: string, what: string) => {
            if (onDraftInChat) {
                onDraftInChat(prompt);
                return;
            }
            if (await copyText(prompt)) toast.success(`${what} prompt copied — paste it into chat`);
            else toast.error("Couldn't copy");
        },
        [onDraftInChat]
    );

    return (
        <div className="h-full overflow-y-auto" data-testid="investors-pane">
            <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
                <header>
                    <h1 className="text-ink flex items-center gap-2 text-lg font-semibold">
                        <HandCoins className="text-brand-ink size-5" />
                        Investor relations
                    </h1>
                    <p className="text-ink-3 mt-0.5 text-[13px]">
                        Find the venture funds raising now, then pitch them with what your sources
                        can prove.
                    </p>
                </header>

                <Tabs defaultValue="find" className="gap-4">
                    <TabsList>
                        <TabsTrigger value="find">Find investors</TabsTrigger>
                        <TabsTrigger value="pitch">Pitch</TabsTrigger>
                    </TabsList>

                    <TabsContent value="find" className="flex flex-col gap-4">
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
                                        placeholder="Focus — climate, health, fintech…"
                                        aria-label="Focus: words in the fund's name"
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
                                        aria-label="Fund's state"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ALL_STATES}>Anywhere</SelectItem>
                                        {US_STATES.map(([code, name]) => (
                                            <SelectItem key={code} value={code}>
                                                {name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={String(form.withinDays)}
                                    onValueChange={v =>
                                        setForm(f => ({ ...f, withinDays: Number(v) }))
                                    }
                                >
                                    <SelectTrigger
                                        className="h-8 w-36 text-xs"
                                        aria-label="Filed within"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {WITHIN_OPTIONS.map(o => (
                                            <SelectItem key={o.days} value={String(o.days)}>
                                                {o.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={search.status === "loading"}
                                >
                                    {search.status === "loading" ? (
                                        <Loader2 className="animate-spin" />
                                    ) : (
                                        <Search />
                                    )}
                                    Search
                                </Button>
                            </div>
                            <div className="text-ink-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="investors-spvs"
                                        checked={form.spvs}
                                        onCheckedChange={v =>
                                            setForm(f => ({ ...f, spvs: v === true }))
                                        }
                                    />
                                    <Label
                                        htmlFor="investors-spvs"
                                        className="text-ink-3 text-[12px] font-normal"
                                    >
                                        Include single-deal SPVs and syndicates
                                    </Label>
                                </div>
                                <span>
                                    From SEC Form D filings — public, no account. A fund raising now
                                    is about to invest.
                                </span>
                            </div>
                        </form>

                        <Results
                            search={search}
                            sortBy={sortBy}
                            onSortBy={setSortBy}
                            onRetry={() => void run(form)}
                            onDraftIntro={fund =>
                                void draft(introPrompt(fund), `Intro to ${fund.name}`)
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
                            draftLabel={onDraftInChat ? "Draft intro" : "Copy intro prompt"}
                        />
                    </TabsContent>

                    <TabsContent value="pitch" className="flex flex-col gap-3">
                        <p className="text-ink-3 text-[13px]">
                            Each of these drafts in chat from your workspace sources, cites them,
                            and lists what is missing. Add your deck, financials and metrics as
                            sources first and the drafts get specific.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {PITCH_STARTERS.map(starter => (
                                <article
                                    key={starter.id}
                                    className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-4"
                                >
                                    <div>
                                        <h3 className="text-ink text-[13.5px] font-semibold">
                                            {starter.title}
                                        </h3>
                                        <p className="text-ink-3 mt-0.5 text-[12.5px]">
                                            {starter.desc}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="self-start"
                                        onClick={() => void draft(starter.prompt, starter.title)}
                                    >
                                        <Sparkles />
                                        {onDraftInChat ? "Draft in chat" : "Copy prompt"}
                                    </Button>
                                </article>
                            ))}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
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
    if (search.status === "loading") {
        return (
            <div
                className="flex flex-col gap-2"
                aria-busy="true"
                aria-label="Searching SEC filings"
            >
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
                    Try again
                </Button>
            </div>
        );
    }

    const { result } = search;
    if (result.funds.length === 0) {
        return (
            <div className="border-line text-ink-3 rounded-xl border border-dashed py-12 text-center text-[13px]">
                No venture funds filed with these words in this window. Try fewer words, another
                state, or a longer window.
            </div>
        );
    }

    const funds = sortFunds(result.funds, sortBy);
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-ink-3 font-mono text-[11px]" data-testid="investors-summary">
                    {resultSummary(result, funds.length)}
                </p>
                <div className="flex items-center gap-2">
                    <ToggleGroup
                        type="single"
                        size="sm"
                        variant="outline"
                        value={sortBy}
                        onValueChange={v => v && onSortBy(v as "newest" | "largest")}
                        aria-label="Sort funds"
                    >
                        <ToggleGroupItem value="newest" className="px-2.5 text-xs">
                            Newest
                        </ToggleGroupItem>
                        <ToggleGroupItem value="largest" className="px-2.5 text-xs">
                            Largest
                        </ToggleGroupItem>
                    </ToggleGroup>
                    {onSaveAsSource && (
                        <Button size="sm" variant="outline" onClick={onSaveAsSource}>
                            <FileText />
                            Save list as a source
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

const filedFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
});

function FundCard({
    fund,
    onDraftIntro,
    draftLabel,
}: {
    fund: FundProfile;
    onDraftIntro: () => void;
    draftLabel: string;
}) {
    const people = peopleOf(fund);
    const entities = fund.managers.filter(m => m.kind === "entity");
    const raise = describeRaise(fund);
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
                                Amended
                            </Badge>
                        )}
                    </h3>
                    <p className="text-ink-3 mt-0.5 text-[12.5px]">
                        {[fund.location, raise].filter(Boolean).join(" · ") ||
                            "Details unavailable — open the filing"}
                    </p>
                </div>
                <span className="text-ink-3 shrink-0 font-mono text-[11px]">
                    Filed {filedFormat.format(new Date(`${fund.filedAt}T00:00:00Z`))}
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
                        <span className="text-ink-3"> +{people.length - shown.length} more</span>
                    )}
                    {entities.length > 0 && (
                        <span className="text-ink-3">
                            {shown.length > 0 ? " · " : ""}via {entities[0]!.name}
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
                        Filing
                        <ArrowUpRight className="text-ink-3" />
                    </a>
                </Button>
                <Button size="sm" variant="ghost" asChild>
                    <a href={websiteSearchUrl(fund)} target="_blank" rel="noopener noreferrer">
                        <Globe />
                        Website
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
