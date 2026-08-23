"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ReviewItem } from "@launchstack/features/adeu";

/**
 * A reviewer's unit of decision.
 *
 * adeu records a replacement as two revisions — a delete and an insert that
 * "pair with" each other — and resolving either resolves both. Presenting them
 * as two cards would ask the same question twice and let a reviewer accept the
 * deletion while rejecting the insertion, which the document cannot represent.
 * So pairs collapse into one `replacement` entry addressing both ids.
 */
export type ReviewEntry =
    | {
          kind: "replacement";
          id: string;
          ids: string[];
          author: string;
          date?: string | null;
          oldText: string;
          newText: string;
          context: string;
          offset: number;
      }
    | {
          kind: "insert" | "delete" | "format";
          id: string;
          ids: string[];
          author: string;
          date?: string | null;
          text: string;
          context: string;
          offset: number;
      }
    | {
          kind: "comment";
          id: string;
          ids: string[];
          author: string;
          date?: string | null;
          text: string;
          anchorText: string;
          context: string;
          offset: number;
      };

export interface DocxEditorState {
    bytes: ArrayBuffer | null;
    entries: ReviewEntry[];
    authors: string[];
    changeCount: number;
    commentCount: number;
    loading: boolean;
    /** Ids currently being applied, so their cards can show progress. */
    pending: Set<string>;
    busy: boolean;
    error: { message: string; retryable: boolean } | null;
}

interface ApiError {
    error?: string;
    message?: string;
}

function friendlyError(status: number, body: ApiError | null): string {
    if (body?.message) return body.message;
    if (status === 404) return "This document no longer exists.";
    if (status === 415) return "The Word editor only opens .docx files.";
    if (status === 503) return "The document editing service is unavailable.";
    return `Something went wrong (HTTP ${status}).`;
}

/** Group raw review items into reviewer-facing entries. */
export function toEntries(items: ReviewItem[]): ReviewEntry[] {
    const byId = new Map(items.map(i => [i.id, i]));
    const consumed = new Set<string>();
    const entries: ReviewEntry[] = [];

    for (const item of items) {
        if (consumed.has(item.id)) continue;

        const partnerId = item.paired_with ?? null;
        const partner = partnerId ? byId.get(partnerId) : undefined;

        if (partner && !consumed.has(partner.id) && item.kind !== "comment") {
            const del = item.kind === "delete" ? item : partner;
            const ins = item.kind === "delete" ? partner : item;
            consumed.add(item.id);
            consumed.add(partner.id);
            entries.push({
                kind: "replacement",
                // Address the pair by its first id; both go to the service.
                id: del.id,
                ids: [del.id, ins.id],
                author: del.author || ins.author,
                date: del.date ?? ins.date,
                oldText: del.text,
                newText: ins.text,
                context: del.context || ins.context,
                offset: Math.min(del.offset, ins.offset),
            });
            continue;
        }

        consumed.add(item.id);
        if (item.kind === "comment") {
            entries.push({
                kind: "comment",
                id: item.id,
                ids: [item.id],
                author: item.author,
                date: item.date,
                text: item.text,
                anchorText: item.anchor_text,
                context: item.context,
                offset: item.offset,
            });
        } else {
            entries.push({
                kind: item.kind,
                id: item.id,
                ids: [item.id],
                author: item.author,
                date: item.date,
                text: item.text,
                context: item.context,
                offset: item.offset,
            });
        }
    }

    return entries.sort((a, b) => a.offset - b.offset);
}

export function useDocxEditor(documentId: number) {
    const [state, setState] = useState<DocxEditorState>({
        bytes: null,
        entries: [],
        authors: [],
        changeCount: 0,
        commentCount: 0,
        loading: true,
        pending: new Set(),
        busy: false,
        error: null,
    });

    // Guards against a slow first load resolving after a newer one, which
    // would render stale bytes over a document the user has already edited.
    const loadToken = useRef(0);

    const load = useCallback(
        async (options?: { quiet?: boolean }) => {
            const token = ++loadToken.current;
            if (!options?.quiet) {
                setState(s => ({ ...s, loading: true, error: null }));
            }

            try {
                const [contentRes, itemsRes] = await Promise.all([
                    fetch(`/api/documents/adeu/content?documentId=${documentId}`),
                    fetch(`/api/documents/adeu/review-items?documentId=${documentId}`),
                ]);

                if (token !== loadToken.current) return;

                if (!contentRes.ok) {
                    const body = (await contentRes.json().catch(() => null)) as ApiError | null;
                    throw Object.assign(new Error(friendlyError(contentRes.status, body)), {
                        retryable: contentRes.status >= 500 || contentRes.status === 503,
                    });
                }

                const bytes = await contentRes.arrayBuffer();

                // A failure to list changes should not stop the document from
                // opening — a reviewer can still read it.
                let items: ReviewItem[] = [];
                let authors: string[] = [];
                let changeCount = 0;
                let commentCount = 0;
                if (itemsRes.ok) {
                    const data = (await itemsRes.json()) as {
                        items: ReviewItem[];
                        authors: string[];
                        change_count: number;
                        comment_count: number;
                    };
                    items = data.items ?? [];
                    authors = data.authors ?? [];
                    changeCount = data.change_count ?? 0;
                    commentCount = data.comment_count ?? 0;
                } else {
                    console.warn("[docx-editor] review items unavailable", itemsRes.status);
                }

                if (token !== loadToken.current) return;

                setState({
                    bytes,
                    entries: toEntries(items),
                    authors,
                    changeCount,
                    commentCount,
                    loading: false,
                    pending: new Set(),
                    busy: false,
                    error: null,
                });
            } catch (err) {
                if (token !== loadToken.current) return;
                setState(s => ({
                    ...s,
                    loading: false,
                    busy: false,
                    error: {
                        message:
                            err instanceof Error ? err.message : "Failed to open the document.",
                        retryable: (err as { retryable?: boolean })?.retryable ?? true,
                    },
                }));
            }
        },
        [documentId]
    );

    useEffect(() => {
        void load();
    }, [load]);

    const apply = useCallback(
        async (
            payload: Record<string, unknown>,
            options: { ids?: string[]; successMessage: string }
        ) => {
            const ids = options.ids ?? [];
            setState(s => ({
                ...s,
                busy: true,
                pending: new Set([...s.pending, ...ids]),
            }));

            try {
                const res = await fetch("/api/documents/adeu/apply", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ documentId, ...payload }),
                });

                const body = (await res.json().catch(() => null)) as
                    | (ApiError & { result?: { summary?: Record<string, number> } })
                    | null;

                if (!res.ok) {
                    throw new Error(friendlyError(res.status, body));
                }

                toast.success(options.successMessage);
                await load({ quiet: true });
                return true;
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : "The change could not be applied.";
                toast.error("Could not apply the change", { description: message });
                setState(s => {
                    const pending = new Set(s.pending);
                    ids.forEach(id => pending.delete(id));
                    return { ...s, busy: false, pending };
                });
                return false;
            }
        },
        [documentId, load]
    );

    const resolveEntry = useCallback(
        (entry: ReviewEntry, decision: "ACCEPT" | "REJECT") => {
            // A pair is one decision but two ids; the service resolves the
            // group from either, and sending both is a consistent no-op.
            const actions = entry.ids.map(id => ({ action: decision, target_id: id }));
            return apply(
                { actions },
                {
                    ids: entry.ids,
                    successMessage: decision === "ACCEPT" ? "Change accepted" : "Change rejected",
                }
            );
        },
        [apply]
    );

    const replyToComment = useCallback(
        (entry: ReviewEntry, text: string) =>
            apply(
                { actions: [{ action: "REPLY", target_id: entry.id, text }] },
                { ids: entry.ids, successMessage: "Reply added" }
            ),
        [apply]
    );

    const resolveAll = useCallback(
        (decision: "accept" | "reject") =>
            apply(
                { resolveAll: decision },
                {
                    ids: [],
                    successMessage:
                        decision === "accept" ? "All changes accepted" : "All changes rejected",
                }
            ),
        [apply]
    );

    const counts = useMemo(() => {
        const changes = state.entries.filter(e => e.kind !== "comment").length;
        const comments = state.entries.filter(e => e.kind === "comment").length;
        return { changes, comments, total: changes + comments };
    }, [state.entries]);

    return { state, counts, reload: load, resolveEntry, replyToComment, resolveAll };
}
