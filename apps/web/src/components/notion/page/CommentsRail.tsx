"use client";

/**
 * The comments rail.
 *
 * Threads are grouped into open and resolved, matching Notion's two tabs. A
 * pending composer (a block selected but no comment written yet) appears at
 * the top so the thing you just clicked "Comment" on is where your eye is.
 */

import { Check, MessageSquare, MoreHorizontal, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceCommentDto } from "~/types/workspace";

export interface PendingComment {
    blockId: string;
    anchorText: string;
}

export function CommentsRail({
    pageId,
    open,
    pending,
    onClearPending,
    onClose,
}: {
    pageId: string;
    open: boolean;
    pending: PendingComment | null;
    onClearPending: () => void;
    onClose: () => void;
}) {
    const [threads, setThreads] = useState<WorkspaceCommentDto[]>([]);
    const [tab, setTab] = useState<"open" | "resolved">("open");
    const [draft, setDraft] = useState("");
    const [replyTo, setReplyTo] = useState<number | null>(null);
    const [replyDraft, setReplyDraft] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useMemo(
        () => async () => {
            const response = await fetch(`/api/workspace/pages/${pageId}/comments`);
            if (!response.ok) return;
            const data = (await response.json()) as { comments: WorkspaceCommentDto[] };
            setThreads(data.comments);
        },
        [pageId]
    );

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    // A pending comment implies you want to write one now.
    useEffect(() => {
        if (pending) setDraft("");
    }, [pending]);

    const submit = async () => {
        if (!pending || !draft.trim() || busy) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/workspace/pages/${pageId}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    blockId: pending.blockId || null,
                    anchorText: pending.anchorText || null,
                    body: draft.trim(),
                }),
            });
            if (response.ok) {
                setDraft("");
                onClearPending();
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const reply = async (parentCommentId: number) => {
        if (!replyDraft.trim()) return;
        const response = await fetch(`/api/workspace/pages/${pageId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentCommentId, body: replyDraft.trim() }),
        });
        if (response.ok) {
            setReplyDraft("");
            setReplyTo(null);
            await load();
        }
    };

    const setResolved = async (id: number, resolved: boolean) => {
        const response = await fetch(`/api/workspace/comments/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolved }),
        });
        if (response.ok) await load();
    };

    const remove = async (id: number) => {
        const response = await fetch(`/api/workspace/comments/${id}`, { method: "DELETE" });
        if (response.ok) await load();
    };

    if (!open) return null;

    const visible = threads.filter((thread) => thread.resolved === (tab === "resolved"));

    return (
        <aside className="ntn-comments">
            <header className="ntn-comments__head">
                <div className="ntn-comments__tabs">
                    <button
                        type="button"
                        className={tab === "open" ? "is-active" : ""}
                        onClick={() => setTab("open")}
                    >
                        Open
                    </button>
                    <button
                        type="button"
                        className={tab === "resolved" ? "is-active" : ""}
                        onClick={() => setTab("resolved")}
                    >
                        Resolved
                    </button>
                </div>
                <button type="button" className="ntn-comments__close" onClick={onClose}>
                    <X size={15} />
                </button>
            </header>

            <div className="ntn-comments__body">
                {pending && (
                    <div className="ntn-thread ntn-thread--pending">
                        {pending.anchorText && (
                            <div className="ntn-thread__anchor">“{pending.anchorText}”</div>
                        )}
                        <textarea
                            className="ntn-thread__input"
                            placeholder="Add a comment…"
                            value={draft}
                            autoFocus
                            rows={3}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                    void submit();
                                }
                                if (event.key === "Escape") onClearPending();
                            }}
                        />
                        <div className="ntn-thread__actions">
                            <button type="button" className="ntn-btn" onClick={onClearPending}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="ntn-btn ntn-btn--primary"
                                disabled={!draft.trim() || busy}
                                onClick={() => void submit()}
                            >
                                <Send size={12} /> Comment
                            </button>
                        </div>
                    </div>
                )}

                {visible.length === 0 && !pending && (
                    <div className="ntn-comments__empty">
                        <MessageSquare size={18} />
                        <p>
                            {tab === "open"
                                ? "No open comments. Select text and press ⌘⇧M to start one."
                                : "Nothing resolved yet."}
                        </p>
                    </div>
                )}

                {visible.map((thread) => (
                    <div key={thread.id} className="ntn-thread">
                        {thread.anchorText && (
                            <div className="ntn-thread__anchor">“{thread.anchorText}”</div>
                        )}
                        <CommentBody comment={thread} onDelete={() => void remove(thread.id)} />
                        {(thread.replies ?? []).map((child) => (
                            <div key={child.id} className="ntn-thread__reply">
                                <CommentBody
                                    comment={child}
                                    onDelete={() => void remove(child.id)}
                                />
                            </div>
                        ))}

                        {replyTo === thread.id ? (
                            <div className="ntn-thread__replybox">
                                <textarea
                                    className="ntn-thread__input"
                                    placeholder="Reply…"
                                    rows={2}
                                    autoFocus
                                    value={replyDraft}
                                    onChange={(event) => setReplyDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" && !event.shiftKey) {
                                            event.preventDefault();
                                            void reply(thread.id);
                                        }
                                        if (event.key === "Escape") setReplyTo(null);
                                    }}
                                />
                            </div>
                        ) : (
                            <div className="ntn-thread__footer">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReplyTo(thread.id);
                                        setReplyDraft("");
                                    }}
                                >
                                    Reply
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void setResolved(thread.id, !thread.resolved)}
                                >
                                    <Check size={12} />
                                    {thread.resolved ? "Reopen" : "Resolve"}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </aside>
    );
}

function CommentBody({
    comment,
    onDelete,
}: {
    comment: WorkspaceCommentDto;
    onDelete: () => void;
}) {
    const [menu, setMenu] = useState(false);

    return (
        <div className="ntn-comment">
            <div className="ntn-comment__head">
                {comment.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="ntn-comment__avatar" src={comment.authorAvatar} alt="" />
                ) : (
                    <span className="ntn-comment__avatar ntn-comment__avatar--letter">
                        {(comment.authorName ?? "?").slice(0, 1).toUpperCase()}
                    </span>
                )}
                <span className="ntn-comment__author">{comment.authorName ?? "You"}</span>
                <span className="ntn-comment__time">
                    {new Date(comment.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                    })}
                </span>
                <button
                    type="button"
                    className="ntn-comment__more"
                    onClick={() => setMenu((open) => !open)}
                >
                    <MoreHorizontal size={13} />
                </button>
            </div>
            <div className="ntn-comment__body">{comment.body}</div>
            {menu && (
                <button type="button" className="ntn-comment__delete" onClick={onDelete}>
                    <Trash2 size={12} /> Delete
                </button>
            )}
        </div>
    );
}
