"use client";

/**
 * The citable copy of a mindmap, rendered as the map.
 *
 * The document row holds a Markdown outline; the diagram it came from is one
 * fetch away by the id in the row's marker. When that fetch fails — the map
 * was trashed, or this reader cannot see it — the outline is still a faithful
 * fallback, so the viewer degrades to Markdown rather than to an error page.
 * On a public link the map comes from the link's own route, as it was when
 * this copy was published.
 */

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { mindmapIdOf } from "~/lib/mindmap-document";
import type { ViewerHighlight } from "~/lib/find-text-range";
import { useViewerEndpoints } from "~/lib/viewer-endpoints";
import { getMindmap, type MindmapDetail } from "../_mindmap/lib/api";
import { openMindmapDocument } from "../_mindmap/lib/open";
import type { MindmapDoc } from "../_mindmap/model/types";
import type { DocumentType } from "../types";

const MindmapPreview = dynamic(
    () => import("../_mindmap/ui/MindmapPreview").then(m => m.MindmapPreview),
    { ssr: false }
);

const MarkdownViewer = dynamic(() => import("./MarkdownViewer").then(m => m.MarkdownViewer), {
    ssr: false,
});

/** The `{ mindmap }` a public link's route answers with, the shape `getMindmap` reads. */
async function getPublicMindmap(url: string): Promise<MindmapDetail> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ((await response.json()) as { mindmap: MindmapDetail }).mindmap;
}

type State =
    | { status: "loading" }
    | { status: "ready"; doc: MindmapDoc; key: string }
    | { status: "fallback" };

export function MindmapDocumentViewer({
    document,
    highlight,
}: {
    document: DocumentType;
    highlight?: ViewerHighlight | null;
}) {
    const t = useTranslations("mindmap.viewer");
    const starter = useTranslations("mindmap.starter");
    // Read when the map arrives, not a reason to fetch it again.
    const starterRef = useRef(starter);
    starterRef.current = starter;
    const mindmapId = mindmapIdOf(document.ocrMetadata);
    const endpoints = useViewerEndpoints();
    const publicUrl =
        endpoints.isPublic && mindmapId !== null ? endpoints.mindmap(mindmapId) : null;
    const [state, setState] = useState<State>(
        mindmapId === null ? { status: "fallback" } : { status: "loading" }
    );

    useEffect(() => {
        if (mindmapId === null) return;
        let cancelled = false;
        setState({ status: "loading" });
        void (async () => {
            try {
                const detail = publicUrl
                    ? await getPublicMindmap(publicUrl)
                    : await getMindmap(mindmapId);
                if (cancelled) return;
                const { doc } = openMindmapDocument(detail, starterRef.current);
                setState({ status: "ready", doc, key: `${detail.id}:${detail.revision}` });
            } catch {
                if (!cancelled) setState({ status: "fallback" });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [mindmapId, publicUrl]);

    if (state.status === "fallback") {
        return <MarkdownViewer url={document.url} title={document.title} highlight={highlight} />;
    }
    if (state.status === "loading") {
        return (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin" />
                {t("opening")}
            </div>
        );
    }
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1">
            <MindmapPreview key={state.key} doc={state.doc} />
        </div>
    );
}
