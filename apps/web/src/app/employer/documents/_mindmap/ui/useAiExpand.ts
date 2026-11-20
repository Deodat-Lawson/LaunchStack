"use client";

import { useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { applyDiagramEdits, topicContext } from "../model/agent-edits";
import { activePage, isTopicShape, nodeById } from "../model/doc";
import type { EditorStore } from "../model/store";

/**
 * "Expand with AI" on a topic: the workspace's model suggests subtopics
 * (`/api/mindmaps/expand`) and they are added with the editor's own commands
 * — one undo entry, painted for their branch, auto-arranged, saved by
 * autosave like anything typed. The request carries the branch's words, not
 * the document.
 */
export function useAiExpand(store: EditorStore): {
    expand: (nodeId?: string) => Promise<void>;
    canExpand: (nodeId?: string) => boolean;
} {
    const t = useTranslations("mindmap.ai");
    const running = useRef(false);

    const target = useCallback(
        (nodeId?: string): string | null => {
            const state = store.getState();
            const id =
                nodeId ??
                (state.selection.length === 1 && state.selection[0]!.kind === "node"
                    ? state.selection[0]!.id
                    : null);
            if (!id) return null;
            const nd = nodeById(activePage(state.doc), id);
            return nd && isTopicShape(nd.shape) ? id : null;
        },
        [store]
    );

    const canExpand = useCallback((nodeId?: string) => target(nodeId) !== null, [target]);

    const expand = useCallback(
        async (nodeId?: string) => {
            const id = target(nodeId);
            if (!id) {
                toast.info(t("pickTopic"));
                return;
            }
            if (running.current) return;
            const doc = store.getState().doc;
            const context = topicContext(activePage(doc), id);
            if (!context) return;
            running.current = true;
            const toastId = toast.loading(
                t("expanding", { topic: context.path[context.path.length - 1] ?? "" })
            );
            try {
                const res = await fetch("/api/mindmaps/expand", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: doc.title, ...context, depth: 1 }),
                });
                const body = (await res.json().catch(() => ({}))) as {
                    outline?: string;
                    error?: string;
                };
                if (!res.ok || !body.outline?.trim())
                    throw new Error(body.error ?? t("expandFailed"));
                // The topic may have gone while the model thought.
                if (!nodeById(activePage(store.getState().doc), id))
                    throw new Error(t("topicGone"));
                const outcome = applyDiagramEdits(
                    store,
                    [{ op: "add", under: id, text: body.outline }],
                    {
                        label: t("expandUndo"),
                    }
                );
                store.selectNodes([id]);
                toast.success(t("expanded", { count: outcome.added.length }), { id: toastId });
            } catch (error) {
                toast.error(
                    error instanceof Error && error.message ? error.message : t("expandFailed"),
                    {
                        id: toastId,
                    }
                );
            } finally {
                running.current = false;
            }
        },
        [store, t, target]
    );

    return useMemo(() => ({ expand, canExpand }), [expand, canExpand]);
}
