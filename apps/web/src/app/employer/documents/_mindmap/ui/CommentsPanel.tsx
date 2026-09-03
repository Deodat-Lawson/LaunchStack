"use client";

import React, { useMemo, useState } from "react";
import { Check, MessageSquarePlus, Trash2, Undo2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import {
    addComment,
    deleteComment,
    focusNode,
    replyToComment,
    resolveComment,
} from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { trimmedOr } from "../model/strings";
import type { EditorState } from "../model/store";
import { useCommittedDoc, useEditor, useStore } from "./EditorContext";

/**
 * Comment threads.
 *
 * Threads pin to a shape when one is selected and to the canvas otherwise, and
 * they live inside the document rather than a side table — so exporting,
 * duplicating or restoring a version carries the discussion with it.
 */

const selectSelection = (s: EditorState) => s.selection;

export function CommentsPanel({
    author,
    canvasSize,
}: {
    author: string;
    canvasSize: { w: number; h: number };
}) {
    const store = useStore();
    const doc = useCommittedDoc();
    const selection = useEditor(selectSelection);
    const [draft, setDraft] = useState("");
    const [replyTo, setReplyTo] = useState<string | null>(null);
    const [replyDraft, setReplyDraft] = useState("");
    const [showResolved, setShowResolved] = useState(false);

    const page = useMemo(() => activePage(doc), [doc]);
    const threads = useMemo(
        () =>
            doc.comments
                .filter(c => c.pageId === page.id)
                .filter(c => showResolved || !c.resolved)
                .slice()
                .reverse(),
        [doc.comments, page.id, showResolved]
    );

    const anchorNodeId = selection.find(s => s.kind === "node")?.id ?? null;
    const anchorNode = anchorNodeId ? nodeById(page, anchorNodeId) : null;

    const submit = () => {
        const body = draft.trim();
        if (!body) return;
        const at = anchorNode
            ? { x: anchorNode.x + anchorNode.w, y: anchorNode.y }
            : { x: store.getState().viewport.x + 200, y: store.getState().viewport.y + 200 };
        addComment(store, { nodeId: anchorNodeId, at, author, body });
        setDraft("");
    };

    return (
        <div className="flex h-full flex-col">
            <div className="border-line border-b p-3">
                <Textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                    }}
                    placeholder={
                        anchorNode
                            ? `Comment on “${trimmedOr(anchorNode.text.split("\n")[0], "this shape")}”…`
                            : "Comment on this page…"
                    }
                    className="min-h-[64px] resize-none text-[13px]"
                />
                <div className="mt-2 flex items-center justify-between">
                    <span className="text-ink-3 text-[11px]">⌘↵ to post</span>
                    <Button size="sm" onClick={submit} disabled={!draft.trim()}>
                        <MessageSquarePlus className="size-3.5" />
                        Comment
                    </Button>
                </div>
            </div>

            <div className="border-line flex items-center justify-between border-b px-3 py-1.5">
                <span className="text-ink-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                    {threads.length} thread{threads.length === 1 ? "" : "s"}
                </span>
                <button
                    type="button"
                    onClick={() => setShowResolved(v => !v)}
                    className="text-ink-3 hover:text-ink-2 text-[11px] underline-offset-2 hover:underline"
                >
                    {showResolved ? "Hide resolved" : "Show resolved"}
                </button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-2 p-3">
                    {threads.length === 0 && (
                        <p className="text-ink-3 py-6 text-center text-[13px]">No comments yet.</p>
                    )}
                    {threads.map(thread => (
                        <article
                            key={thread.id}
                            className={cn(
                                "border-line bg-panel rounded-lg border p-2.5",
                                thread.resolved && "opacity-60"
                            )}
                        >
                            <header className="mb-1 flex items-center gap-2">
                                <span className="text-ink text-[12px] font-semibold">
                                    {thread.author}
                                </span>
                                <time className="text-ink-3 text-[11px]">
                                    {formatWhen(thread.createdAt)}
                                </time>
                                <span className="flex-1" />
                                <button
                                    type="button"
                                    title={thread.resolved ? "Reopen" : "Resolve"}
                                    onClick={() =>
                                        resolveComment(store, thread.id, !thread.resolved)
                                    }
                                    className="text-ink-3 hover:text-success"
                                >
                                    {thread.resolved ? (
                                        <Undo2 className="size-3.5" />
                                    ) : (
                                        <Check className="size-3.5" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    title="Delete thread"
                                    onClick={() => deleteComment(store, thread.id)}
                                    className="text-ink-3 hover:text-danger"
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </header>

                            <p className="text-ink-2 whitespace-pre-wrap text-[13px] leading-relaxed">
                                {thread.body}
                            </p>

                            {thread.nodeId && (
                                <button
                                    type="button"
                                    onClick={() => focusNode(store, thread.nodeId!, canvasSize)}
                                    className="text-brand-ink mt-1.5 text-[11px] underline-offset-2 hover:underline"
                                >
                                    Jump to shape
                                </button>
                            )}

                            {thread.replies.length > 0 && (
                                <ul className="border-line mt-2 space-y-1.5 border-l-2 pl-2.5">
                                    {thread.replies.map(reply => (
                                        <li key={reply.id}>
                                            <span className="text-ink text-[12px] font-semibold">
                                                {reply.author}
                                            </span>{" "}
                                            <span className="text-ink-3 text-[11px]">
                                                {formatWhen(reply.createdAt)}
                                            </span>
                                            <p className="text-ink-2 whitespace-pre-wrap text-[12.5px]">
                                                {reply.body}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {replyTo === thread.id ? (
                                <div className="mt-2">
                                    <Textarea
                                        autoFocus
                                        value={replyDraft}
                                        onChange={e => setReplyDraft(e.target.value)}
                                        onKeyDown={e => {
                                            e.stopPropagation();
                                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                                if (replyDraft.trim()) {
                                                    replyToComment(
                                                        store,
                                                        thread.id,
                                                        author,
                                                        replyDraft.trim()
                                                    );
                                                }
                                                setReplyDraft("");
                                                setReplyTo(null);
                                            }
                                            if (e.key === "Escape") setReplyTo(null);
                                        }}
                                        placeholder="Reply…"
                                        className="min-h-[52px] resize-none text-[13px]"
                                    />
                                </div>
                            ) : (
                                !thread.resolved && (
                                    <button
                                        type="button"
                                        onClick={() => setReplyTo(thread.id)}
                                        className="text-ink-3 hover:text-ink-2 mt-1.5 text-[11px] underline-offset-2 hover:underline"
                                    >
                                        Reply
                                    </button>
                                )
                            )}
                        </article>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

function formatWhen(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString();
}
