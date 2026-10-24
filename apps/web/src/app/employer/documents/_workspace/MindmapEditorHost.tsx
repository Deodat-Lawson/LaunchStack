"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useUser } from "~/lib/auth-client";

import { getMindmap, MindmapRequestError, type MindmapDetail } from "../_mindmap/lib/api";
import { openMindmapDocument } from "../_mindmap/lib/open";
import type { MindmapDoc } from "../_mindmap/model/types";
import { MindmapEditor } from "../_mindmap/ui/MindmapEditor";

/**
 * The editor, mounted in the workspace's main area.
 *
 * Fetches the row, builds the document, and hands it to `MindmapEditor` with
 * a back callback the workspace owns — so "back" means "the preview I came
 * from", never a page of its own. The document is fetched client-side so the
 * editor mounts once with a real store.
 */

type HostState =
    | { status: "loading" }
    /**
     * `message` is the server's reason, or null when it gave none; `httpStatus`
     * is the failed request's, when there was one. Both are worded at render.
     */
    | { status: "error"; message: string | null; httpStatus?: number }
    | { status: "ready"; mindmap: MindmapDetail; doc: MindmapDoc; seeded: boolean };

export function MindmapEditorHost({
    mindmapId,
    active = true,
    onBack,
    onChanged,
    onAskAboutNode,
}: {
    mindmapId: number;
    /**
     * False while the editor is mounted but off screen — another Studio tab
     * is showing, or a source preview covers it. The editor keeps its store
     * and its undo history but stops answering window keys and pastes.
     */
    active?: boolean;
    /** "Ask about this in chat" on a topic — see MindmapEditor. */
    onAskAboutNode?: (text: string) => void;
    /** Leave the editor. */
    onBack: () => void;
    /**
     * Called when the editor unmounts. Titles, thumbnails and the citable
     * copy may all have moved while it was open; the workspace refreshes its
     * list once rather than on every keystroke.
     */
    onChanged?: () => void;
}) {
    const { user } = useUser();
    const t = useTranslations("workspace");
    const tc = useTranslations("common");
    const tMindmapErrors = useTranslations("mindmap.errors");
    /** A new map's starter text — this is where new maps are built. Read without re-fetching. */
    const starter = useTranslations("mindmap.starter");
    const starterRef = useRef(starter);
    starterRef.current = starter;
    const [state, setState] = useState<HostState>({ status: "loading" });

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        void (async () => {
            try {
                const mindmap = await getMindmap(mindmapId);
                if (cancelled) return;
                const { doc, seeded } = openMindmapDocument(mindmap, starterRef.current);
                setState({ status: "ready", mindmap, doc, seeded });
            } catch (error) {
                if (cancelled) return;
                setState({
                    status: "error",
                    ...(error instanceof MindmapRequestError
                        ? {
                              message: error.serverMessage ?? null,
                              httpStatus: error.status,
                          }
                        : { message: error instanceof Error ? error.message : null }),
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [mindmapId]);

    useEffect(() => {
        return () => onChanged?.();
        // The refresh belongs to unmount only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (state.status === "loading") {
        return (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin" />
                {t("common.opening")}
            </div>
        );
    }

    if (state.status === "error") {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-ink text-[15px] font-medium">
                    {state.message ??
                        (state.httpStatus !== undefined
                            ? tMindmapErrors("requestFailed", { status: state.httpStatus })
                            : t("mindmapHost.couldNotOpen"))}
                </p>
                <Button variant="outline" size="sm" onClick={onBack}>
                    <ArrowLeft className="size-4" />
                    {tc("actions.back")}
                </Button>
            </div>
        );
    }

    const author = user?.name?.trim() ?? user?.email ?? "You";

    return (
        <MindmapEditor
            mindmapId={state.mindmap.id}
            initialDoc={state.doc}
            initialTitle={state.mindmap.title}
            initialRevision={state.mindmap.revision}
            needsInitialSave={state.seeded}
            folder={state.mindmap.folder}
            publishedDocumentId={state.mindmap.publishedDocumentId}
            author={author}
            active={active}
            onBack={onBack}
            onAskAboutNode={onAskAboutNode}
        />
    );
}
