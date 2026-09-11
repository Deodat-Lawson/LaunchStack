"use client";

import { useMemo, useState } from "react";
import {
    Check,
    CornerDownLeft,
    Loader2,
    MessageSquare,
    MinusCircle,
    PlusCircle,
    Type,
    X,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import type { ReviewEntry } from "./useDocxEditor";

type Filter = "all" | "changes" | "comments";

interface ReviewPaneProps {
    entries: ReviewEntry[];
    pending: Set<string>;
    busy: boolean;
    onResolve: (entry: ReviewEntry, decision: "ACCEPT" | "REJECT") => void;
    onReply: (entry: ReviewEntry, text: string) => void;
}

const KIND_META: Record<ReviewEntry["kind"], { label: string; Icon: typeof Check; tone: string }> =
    {
        replacement: { label: "Replacement", Icon: Type, tone: "text-brand" },
        insert: { label: "Insertion", Icon: PlusCircle, tone: "text-success" },
        delete: { label: "Deletion", Icon: MinusCircle, tone: "text-danger" },
        format: { label: "Formatting", Icon: Type, tone: "text-info" },
        comment: { label: "Comment", Icon: MessageSquare, tone: "text-warn" },
    };

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function whenLabel(raw?: string | null): string | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CommentReply({
    entry,
    disabled,
    onReply,
}: {
    entry: ReviewEntry;
    disabled: boolean;
    onReply: (entry: ReviewEntry, text: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");

    if (!open) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className="text-ink-3 hover:text-ink h-7 justify-start px-2 text-xs"
                disabled={disabled}
                onClick={() => setOpen(true)}
            >
                <CornerDownLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Reply
            </Button>
        );
    }

    const submit = () => {
        const body = text.trim();
        if (!body) return;
        onReply(entry, body);
        setText("");
        setOpen(false);
    };

    return (
        <div className="flex flex-col gap-2">
            <Textarea
                autoFocus
                rows={2}
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Write a reply…"
                className="min-h-0 resize-none text-xs"
                onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                    if (e.key === "Escape") setOpen(false);
                }}
            />
            <div className="flex items-center gap-2">
                <Button size="sm" className="h-7 text-xs" disabled={!text.trim()} onClick={submit}>
                    Reply
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-ink-3 h-7 text-xs"
                    onClick={() => setOpen(false)}
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function ReviewCard({
    entry,
    isPending,
    busy,
    onResolve,
    onReply,
}: {
    entry: ReviewEntry;
    isPending: boolean;
    busy: boolean;
    onResolve: ReviewPaneProps["onResolve"];
    onReply: ReviewPaneProps["onReply"];
}) {
    const meta = KIND_META[entry.kind];
    const when = whenLabel(entry.date);
    const disabled = busy || isPending;

    return (
        <article
            className={cn(
                "border-line bg-panel relative rounded-lg border p-3 transition-opacity",
                isPending && "opacity-60"
            )}
            aria-busy={isPending}
        >
            <header className="mb-2 flex items-start gap-2">
                <span
                    className="bg-panel-2 text-ink-2 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                    aria-hidden="true"
                >
                    {initials(entry.author)}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-xs font-medium">{entry.author}</p>
                    <div className="text-ink-3 flex items-center gap-1.5 text-[11px]">
                        <meta.Icon className={cn("h-3 w-3", meta.tone)} aria-hidden="true" />
                        <span>{meta.label}</span>
                        {when && (
                            <>
                                <span aria-hidden="true">·</span>
                                <span>{when}</span>
                            </>
                        )}
                    </div>
                </div>
                {isPending && (
                    <Loader2
                        className="text-ink-3 h-3.5 w-3.5 shrink-0 animate-spin"
                        aria-label="Applying"
                    />
                )}
            </header>

            <div className="mb-2.5 text-xs leading-relaxed">
                {entry.kind === "replacement" ? (
                    <div className="flex flex-col gap-1">
                        <span className="text-danger bg-danger-soft rounded px-1.5 py-1 line-through decoration-1">
                            {entry.oldText || "—"}
                        </span>
                        <span className="text-success bg-success-soft rounded px-1.5 py-1">
                            {entry.newText || "—"}
                        </span>
                    </div>
                ) : entry.kind === "delete" ? (
                    <span className="text-danger bg-danger-soft inline-block rounded px-1.5 py-1 line-through decoration-1">
                        {entry.text || "—"}
                    </span>
                ) : entry.kind === "insert" ? (
                    <span className="text-success bg-success-soft inline-block rounded px-1.5 py-1">
                        {entry.text || "—"}
                    </span>
                ) : entry.kind === "comment" ? (
                    <div className="flex flex-col gap-1.5">
                        <p className="text-ink whitespace-pre-wrap">{entry.text}</p>
                        {entry.anchorText && (
                            <p className="text-ink-3 border-line border-l-2 pl-2 italic">
                                on “{entry.anchorText}”
                            </p>
                        )}
                    </div>
                ) : (
                    <span className="text-ink-2">{entry.text || "Formatting changed"}</span>
                )}
            </div>

            {entry.context && entry.kind !== "comment" && (
                <p className="text-ink-4 mb-2.5 line-clamp-2 text-[11px] leading-snug">
                    {entry.context}
                </p>
            )}

            {entry.kind === "comment" ? (
                <CommentReply entry={entry} disabled={disabled} onReply={onReply} />
            ) : (
                <div className="flex items-center gap-1.5">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-success hover:bg-success-soft hover:text-success h-7 px-2 text-xs"
                        disabled={disabled}
                        onClick={() => onResolve(entry, "ACCEPT")}
                    >
                        <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Accept
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger-soft hover:text-danger h-7 px-2 text-xs"
                        disabled={disabled}
                        onClick={() => onResolve(entry, "REJECT")}
                    >
                        <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Reject
                    </Button>
                </div>
            )}
        </article>
    );
}

export function ReviewPane({ entries, pending, busy, onResolve, onReply }: ReviewPaneProps) {
    const [filter, setFilter] = useState<Filter>("all");

    const changeCount = useMemo(() => entries.filter(e => e.kind !== "comment").length, [entries]);
    const commentCount = entries.length - changeCount;

    const visible = useMemo(() => {
        if (filter === "changes") return entries.filter(e => e.kind !== "comment");
        if (filter === "comments") return entries.filter(e => e.kind === "comment");
        return entries;
    }, [entries, filter]);

    const tabs: Array<{ id: Filter; label: string; count: number }> = [
        { id: "all", label: "All", count: entries.length },
        { id: "changes", label: "Changes", count: changeCount },
        { id: "comments", label: "Comments", count: commentCount },
    ];

    return (
        <aside className="border-line bg-surface-2 flex h-full min-h-0 flex-col border-l">
            <div className="border-line flex shrink-0 items-center gap-1 border-b px-2 py-2">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilter(tab.id)}
                        aria-pressed={filter === tab.id}
                        className={cn(
                            "focus-visible:ring-brand flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
                            filter === tab.id
                                ? "bg-brand-soft text-brand-ink"
                                : "text-ink-3 hover:text-ink hover:bg-panel-2"
                        )}
                    >
                        {tab.label}
                        <Badge
                            variant="secondary"
                            className="h-4 min-w-4 justify-center px-1 text-[10px] tabular-nums"
                        >
                            {tab.count}
                        </Badge>
                    </button>
                ))}
            </div>

            {visible.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                    <div className="bg-panel-2 flex h-10 w-10 items-center justify-center rounded-full">
                        <Check className="text-ink-3 h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="text-ink text-sm font-medium">
                        {entries.length === 0 ? "No tracked changes" : "Nothing in this view"}
                    </p>
                    <p className="text-ink-3 max-w-[24ch] text-xs">
                        {entries.length === 0
                            ? "This document has no revisions or comments to review."
                            : "Switch tabs to see the other items."}
                    </p>
                </div>
            ) : (
                <ScrollArea className="min-h-0 flex-1">
                    <div className="flex flex-col gap-2 p-2">
                        {visible.map(entry => (
                            <ReviewCard
                                key={entry.id}
                                entry={entry}
                                isPending={entry.ids.some(id => pending.has(id))}
                                busy={busy}
                                onResolve={onResolve}
                                onReply={onReply}
                            />
                        ))}
                    </div>
                </ScrollArea>
            )}
        </aside>
    );
}
