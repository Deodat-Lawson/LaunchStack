"use client";

import { ExternalLink, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, InlineError } from "~/components/tool-kit/EmptyState";
import { PageHeader } from "~/components/tool-kit/PageHeader";
import { SkeletonRows } from "~/components/tool-kit/SkeletonRows";
import { useResource } from "~/components/tool-kit/useResource";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import {
    EVIDENCE_KINDS,
    EVIDENCE_KIND_LABEL,
    vantageApi,
    type EvidenceDto,
    type VantageEvidenceKind,
} from "../api";
import { EvidenceDialog } from "../_components/EvidenceDialog";
import { KindPill, SharedMark } from "../_components/Primitives";
import { plural } from "../_lib/format";

type Filter = "all" | VantageEvidenceKind;

/**
 * The evidence inbox: everything the week's agenda can cite, newest first.
 * One list, a kind filter, a search box, and the add dialog. Rows expand
 * in place; nothing here is a card.
 */
export function EvidenceScreen() {
    const list = useResource("vantage:evidence", () => vantageApi.evidence());
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
            toast("Removed");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not remove it");
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
            toast.error(err instanceof Error ? err.message : "Could not change visibility");
        }
    };

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
            <PageHeader
                title="Everything the week"
                accent="can cite"
                sub={
                    list.data
                        ? `${plural(items.length, "item")} · newest first · private unless you share it`
                        : undefined
                }
                actions={
                    <Button size="sm" onClick={() => setAdding(true)}>
                        Add evidence
                    </Button>
                }
            />

            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}

            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Kind">
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
                            {k === "all" ? "All" : EVIDENCE_KIND_LABEL[k]}
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
                    placeholder="Search title, text, source"
                    aria-label="Search evidence"
                    className="h-8 w-full text-[13px] sm:ml-auto sm:w-64"
                />
            </div>

            {list.loading ? (
                <SkeletonRows rows={6} height={44} />
            ) : items.length === 0 ? (
                <EmptyState
                    title="Nothing here yet"
                    body="Paste a customer conversation, drop in a note from a call, keep a link, or record a claim from a deck so it can be checked against the numbers. Everything you add carries a date and a source, which is what makes it citable."
                    action={
                        <Button size="sm" onClick={() => setAdding(true)}>
                            Add the first item
                        </Button>
                    }
                />
            ) : filtered.length === 0 ? (
                <p className="text-ink-3 text-[13px]">Nothing matches that filter.</p>
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
                                    <span className="text-ink-3 hidden max-w-[200px] truncate text-[12px] sm:inline">
                                        {e.source ?? ""}
                                    </span>
                                    <span className="text-ink-3 shrink-0 font-mono text-[11.5px] tabular-nums">
                                        {e.observedAt}
                                    </span>
                                    <SharedMark
                                        shared={e.visibility === "shared"}
                                        className="hidden sm:inline-flex"
                                    />
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                aria-label={`Actions for ${e.title}`}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => setEditing(e)}>
                                                Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => void toggleShared(e)}>
                                                {e.visibility === "shared"
                                                    ? "Make private"
                                                    : "Share with the program"}
                                            </DropdownMenuItem>
                                            {e.sourceUrl && (
                                                <DropdownMenuItem asChild>
                                                    <a
                                                        href={e.sourceUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Open link{" "}
                                                        <ExternalLink className="ml-auto size-3" />
                                                    </a>
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                                className="text-danger"
                                                onSelect={() => void remove(e)}
                                            >
                                                Remove
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
                                            {e.source && <span>Source: {e.source}</span>}
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
                                                Added {new Date(e.createdAt).toLocaleDateString()}
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
                onSaved={() => void list.reload()}
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
