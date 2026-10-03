"use client";

import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { ToolLink } from "~/components/tool-app/ToolLink";

import { CiteList } from "~/components/tools/Cite";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { plural, relativeTime } from "~/lib/tools/format";
import { useResource } from "~/lib/tools/useResource";
import { useProposals } from "../_lib/context";
import { proposalsApi, type LibraryItemDto } from "../api";

function ItemDialog({
    open,
    onOpenChange,
    item,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    item: LibraryItemDto | null;
    onSaved: () => void;
}) {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [tags, setTags] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!open) return;
        setQuestion(item?.question ?? "");
        setAnswer(item?.answer ?? "");
        setTags(item?.tags.join(", ") ?? "");
    }, [open, item]);
    const valid = question.trim().length > 0 && answer.trim().length > 0 && !busy;
    const submit = async () => {
        setBusy(true);
        try {
            const input = {
                question: question.trim(),
                answer: answer.trim(),
                tags: tags
                    .split(",")
                    .map(t => t.trim())
                    .filter(Boolean),
            };
            if (item) await proposalsApi.patchLibraryItem(item.id, input);
            else await proposalsApi.createLibraryItem(input);
            toast.success(item ? "Answer updated" : "Answer saved");
            onSaved();
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save the answer");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{item ? "Edit answer" : "Save an answer"}</DialogTitle>
                    <DialogDescription>
                        Drafts reuse a saved answer when a funder asks the same question.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-3"
                    onSubmit={e => {
                        e.preventDefault();
                        if (valid) void submit();
                    }}
                >
                    <div className="grid gap-1.5">
                        <Label htmlFor="lib-question" className="text-xs">
                            Question
                        </Label>
                        <Input
                            id="lib-question"
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="lib-answer" className="text-xs">
                            Answer
                        </Label>
                        <Textarea
                            id="lib-answer"
                            value={answer}
                            onChange={e => setAnswer(e.target.value)}
                            rows={8}
                            className="text-[13px]"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="lib-tags" className="text-xs">
                            Tags, comma-separated
                        </Label>
                        <Input
                            id="lib-tags"
                            value={tags}
                            onChange={e => setTags(e.target.value)}
                            placeholder="mission, history"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!valid}>
                            {item ? "Save changes" : "Save answer"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function ItemRow({
    item,
    onEdit,
    onDelete,
    href,
}: {
    item: LibraryItemDto;
    onEdit: () => void;
    onDelete: () => void;
    href: (path: string) => string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-line-2 border-t first:border-t-0">
            <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 rounded-sm outline-none focus-visible:ring-2"
                    aria-label={open ? "Hide answer" : "Show answer"}
                    aria-expanded={open}
                >
                    {open ? (
                        <ChevronDown className="size-4" />
                    ) : (
                        <ChevronRight className="size-4" />
                    )}
                </button>
                <span className="min-w-0">
                    <span className="text-ink block truncate text-sm font-medium">
                        {item.question}
                    </span>
                    <span className="text-ink-3 block truncate text-xs">
                        {item.uses === 0 ? "not reused yet" : `reused ${plural(item.uses, "time")}`}
                        {item.sourceApplicationTitle
                            ? ` · from ${item.sourceApplicationTitle}`
                            : ""}
                        {item.tags.length ? ` · ${item.tags.join(", ")}` : ""} ·{" "}
                        {relativeTime(item.updatedAt)}
                    </span>
                </span>
                <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={onEdit}>
                        Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onDelete}>
                        Delete
                    </Button>
                </span>
            </div>
            {open && (
                <div className="px-3 pb-4 pl-[44px]">
                    <p className="text-ink max-w-[70ch] whitespace-pre-wrap text-[13.5px] leading-relaxed">
                        {item.answer}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                        <CiteList cites={item.evidence.map(e => e.n)} evidence={item.evidence} />
                        {item.sourceApplicationId && (
                            <ToolLink
                                href={href(`/write/${item.sourceApplicationId}`)}
                                className="text-brand-ink text-xs hover:underline"
                            >
                                Open the application it came from
                            </ToolLink>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Answers worth reusing: what was approved before, findable by the question it answered. */
export function LibraryScreen() {
    const { href, finishedTick } = useProposals();
    const res = useResource("proposals:library", () => proposalsApi.library());
    const reload = res.reload;
    useEffect(() => {
        if (finishedTick > 0) void reload();
    }, [finishedTick, reload]);
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<LibraryItemDto | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState<LibraryItemDto | null>(null);

    const items = useMemo(() => res.data?.items ?? [], [res.data]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            i =>
                i.question.toLowerCase().includes(q) ||
                i.answer.toLowerCase().includes(q) ||
                i.tags.some(t => t.toLowerCase().includes(q))
        );
    }, [items, query]);

    const remove = async () => {
        if (!deleting) return;
        try {
            await proposalsApi.deleteLibraryItem(deleting.id);
            res.mutate(current => ({ items: current.items.filter(i => i.id !== deleting.id) }));
            toast("Answer deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not delete the answer");
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
            <PageHeader
                title="Answers worth"
                accent="reusing"
                sub={
                    res.data
                        ? `${plural(items.length, "saved answer")} · reused automatically when a question matches`
                        : undefined
                }
                actions={
                    <Button
                        size="sm"
                        onClick={() => {
                            setEditing(null);
                            setDialogOpen(true);
                        }}
                    >
                        Save an answer
                    </Button>
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            <div className="relative max-w-sm">
                <Search className="text-ink-4 absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search questions, answers, tags"
                    aria-label="Search the library"
                    className="h-8 pl-8 text-[13px]"
                />
            </div>
            {res.loading ? (
                <SkeletonRows rows={4} height={52} />
            ) : shown.length === 0 ? (
                <EmptyState
                    title={items.length === 0 ? "Nothing saved yet" : "No answers match"}
                    body={
                        items.length === 0
                            ? "Approve a section in an application and save it here; the next application that asks the same question starts from it."
                            : "Try other words."
                    }
                />
            ) : (
                <div className="border-line bg-panel rounded-lg border">
                    {shown.map(item => (
                        <ItemRow
                            key={item.id}
                            item={item}
                            href={href}
                            onEdit={() => {
                                setEditing(item);
                                setDialogOpen(true);
                            }}
                            onDelete={() => setDeleting(item)}
                        />
                    ))}
                </div>
            )}
            <ItemDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                item={editing}
                onSaved={() => void res.reload()}
            />
            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={open => !open && setDeleting(null)}
                title="Delete this answer?"
                description="Drafts will no longer reuse it. The applications it came from keep their text."
                confirmLabel="Delete"
                destructive
                onConfirm={() => void remove()}
            />
        </div>
    );
}
