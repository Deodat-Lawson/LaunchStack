"use client";

import { ExternalLink, MoreHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { useResource } from "~/lib/tools/useResource";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { useErrorText } from "~/lib/tools/errorText";

import { EVIDENCE_KINDS, vantageApi, type EvidenceDto, type VantageEvidenceKind } from "../api";
import { EvidenceDialog } from "../_components/EvidenceDialog";
import { KindPill, SharedMark } from "../_components/Primitives";
import { WeekSuggestions } from "../_components/WeekSuggestions";
import { useOneClick } from "../_lib/actions";
import { todayIso } from "../_lib/format";
import { useHiddenSuggestions } from "../_lib/hidden";
import { weekSuggestions } from "../_lib/suggestions";

type Filter = "all" | VantageEvidenceKind;

/**
 * The evidence inbox: everything the week's agenda can cite, newest first.
 * One list, a kind filter, a search box, and the add dialog. Rows expand
 * in place; nothing here is a card — except Vantage's nudge when nothing
 * has been logged for over a week.
 */
export function EvidenceScreen() {
    const errorText = useErrorText();
    const t = useTranslations("vantage.evidence");
    const tk = useTranslations("vantage.evidenceKind");
    const tc = useTranslations("common");
    const format = useFormatter();
    const list = useResource("vantage:evidence", () => vantageApi.evidence());
    const overview = useResource("vantage:overview", () => vantageApi.overview());
    const hidden = useHiddenSuggestions();
    const { act, gone } = useOneClick(overview.reload);
    const nudges = useMemo(
        () =>
            overview.data
                ? weekSuggestions(overview.data, { today: todayIso(), hidden })
                      .filter(g => g.id === "record")
                      .map(g => ({ ...g, items: g.items.filter(x => x.kind === "log-evidence") }))
                      .filter(g => g.items.length > 0)
                : [],
        [overview.data, hidden]
    );
    const [filter, setFilter] = useState<Filter>("all");
    const [q, setQ] = useState("");
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<EvidenceDto | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);

    const items = useMemo(() => list.data?.evidence ?? [], [list.data]);
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return items.filter(
            e =>
                (filter === "all" || e.kind === filter) &&
                (!needle || `${e.title} ${e.body} ${e.source ?? ""}`.toLowerCase().includes(needle))
        );
    }, [items, filter, q]);

    const counts = useMemo(() => {
        const m = new Map<string, number>();
        for (const e of items) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
        return m;
    }, [items]);

    const remove = async (e: EvidenceDto) => {
        try {
            await vantageApi.deleteEvidence(e.id);
            list.mutate(current => ({ evidence: current.evidence.filter(x => x.id !== e.id) }));
            toast(t("removed"));
        } catch (err) {
            toast.error(errorText(err, t("removeError")));
        }
    };

    const toggleShared = async (e: EvidenceDto) => {
        try {
            const next = e.visibility === "shared" ? "private" : "shared";
            const { evidence } = await vantageApi.patchEvidence(e.id, { visibility: next });
            list.mutate(current => ({
                evidence: current.evidence.map(x => (x.id === e.id ? evidence : x)),
            }));
        } catch (err) {
            toast.error(errorText(err, t("visibilityError")));
        }
    };

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={list.data ? t("sub", { count: items.length }) : undefined}
                actions={
                    <Button size="sm" onClick={() => setAdding(true)}>
                        {t("add")}
                    </Button>
                }
            />

            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}

            {nudges.length > 0 && (
                <WeekSuggestions
                    groups={nudges}
                    act={act}
                    gone={gone}
                    onDecide={() => undefined}
                    onLogEvidence={() => setAdding(true)}
                />
            )}

            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("kindLabel")}>
                    {(["all", ...EVIDENCE_KINDS] as Filter[]).map(k => (
                        <button
                            key={k}
                            type="button"
                            role="tab"
                            aria-selected={filter === k}
                            onClick={() => setFilter(k)}
                            className={cn(
                                "focus-visible:ring-brand/50 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-[3px]",
                                filter === k
                                    ? "bg-panel text-ink shadow-1 font-medium"
                                    : "text-ink-2 hover:bg-panel/60 hover:text-ink"
                            )}
                        >
                            {k === "all" ? tc("status.all") : tk(`label.${k}`)}
                            {k !== "all" && counts.get(k) ? (
                                <span className="text-ink-3 font-mono text-[11px] tabular-nums">
                                    {counts.get(k)}
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
                <Input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("searchLabel")}
                    // 16rem, not `w-64`: uploadthing's stylesheet redefines
                    // `.w-64` after ours, which would beat `@max-sm:w-full`.
                    className="@max-sm:ml-0 @max-sm:w-full ml-auto h-8 w-[16rem] text-[13px]"
                />
            </div>

            {list.loading ? (
                <SkeletonRows rows={6} height={44} />
            ) : items.length === 0 ? (
                <EmptyState
                    title={t("emptyTitle")}
                    body={t("emptyBody")}
                    action={
                        <Button size="sm" onClick={() => setAdding(true)}>
                            {t("addFirst")}
                        </Button>
                    }
                />
            ) : filtered.length === 0 ? (
                <p className="text-ink-3 text-[13px]">{t("noMatch")}</p>
            ) : (
                <div className="border-line bg-panel rounded-lg border">
                    {filtered.map(e => {
                        const expanded = openId === e.id;
                        return (
                            <div key={e.id} className="border-line-2 border-t first:border-t-0">
                                <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                                    <button
                                        type="button"
                                        onClick={() => setOpenId(expanded ? null : e.id)}
                                        aria-expanded={expanded}
                                        className="focus-visible:ring-brand/50 flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2"
                                    >
                                        <KindPill kind={e.kind} />
                                        <span className="text-ink min-w-0 flex-1 truncate text-[13px] font-medium">
                                            {e.title}
                                        </span>
                                    </button>
                                    <span className="text-ink-3 @max-sm:hidden inline max-w-[200px] truncate text-[12px]">
                                        {e.source ?? ""}
                                    </span>
                                    <span className="text-ink-3 shrink-0 font-mono text-[11.5px] tabular-nums">
                                        {e.observedAt}
                                    </span>
                                    <SharedMark
                                        shared={e.visibility === "shared"}
                                        className="@max-sm:hidden"
                                    />
                                    {/* Not modal: its items open dialogs, and a modal menu that hands off to a
                                        dialog leaves the page unclickable once the dialog closes. */}
                                    <DropdownMenu modal={false}>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={t("actionsFor", { title: e.title })}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => setEditing(e)}>
                                                {tc("actions.edit")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => void toggleShared(e)}>
                                                {e.visibility === "shared"
                                                    ? t("makePrivate")
                                                    : t("share")}
                                            </DropdownMenuItem>
                                            {e.sourceUrl && (
                                                <DropdownMenuItem asChild>
                                                    <a
                                                        href={e.sourceUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        {t("openLink")}{" "}
                                                        <ExternalLink className="ml-auto size-3" />
                                                    </a>
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                                className="text-danger"
                                                onSelect={() => void remove(e)}
                                            >
                                                {tc("actions.remove")}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                                {expanded && (
                                    <div className="px-4 pb-3 pl-[calc(1rem+3.25rem)]">
                                        <p className="text-ink-2 max-w-[70ch] whitespace-pre-wrap text-[13px] leading-[1.5]">
                                            {e.body}
                                        </p>
                                        <div className="text-ink-3 mt-2 flex flex-wrap gap-x-3 text-[11.5px]">
                                            {e.source && (
                                                <span>{t("source", { source: e.source })}</span>
                                            )}
                                            {e.sourceUrl && (
                                                <a
                                                    href={e.sourceUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="hover:text-ink underline underline-offset-2"
                                                >
                                                    {e.sourceUrl}
                                                </a>
                                            )}
                                            <span>
                                                {t("addedOn", {
                                                    date: format.dateTime(new Date(e.createdAt), {
                                                        year: "numeric",
                                                        month: "numeric",
                                                        day: "numeric",
                                                    }),
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <EvidenceDialog
                open={adding}
                onOpenChange={setAdding}
                onSaved={() => {
                    void list.reload();
                    void overview.reload();
                }}
            />
            <EvidenceDialog
                open={editing !== null}
                onOpenChange={o => !o && setEditing(null)}
                initial={editing}
                onSaved={() => void list.reload()}
            />
        </div>
    );
}
