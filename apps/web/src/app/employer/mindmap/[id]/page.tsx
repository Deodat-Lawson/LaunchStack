"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";

import { useSetBreadcrumbs } from "../../_chrome/BreadcrumbContext";
import { getMindmap, type MindmapDetail } from "../_mindmap/lib/api";
import type { ThemeMode } from "../_mindmap/model/palette";
import { parseDoc } from "../_mindmap/model/serialize";
import { buildTemplate, TEMPLATE_BY_ID } from "../_mindmap/model/templates";
import type { MindmapDoc } from "../_mindmap/model/types";
import { MindmapEditor } from "../_mindmap/ui/MindmapEditor";

/**
 * The editor route.
 *
 * The document is fetched client-side so the editor mounts once with a real
 * store; server-rendering it would serialise the whole document into the HTML
 * payload and then hand it straight to a client component anyway.
 */

/**
 * A newly created map is stored with a `templateId` and an empty document — the
 * template registry lives on the client, so building it is this page's job.
 * `seeded` tells the editor to persist the result immediately, so closing the
 * tab without touching anything still leaves a real document behind.
 */
function seedDocument(mindmap: MindmapDetail): { doc: MindmapDoc; seeded: boolean } {
    const doc = parseDoc(mindmap.doc, mindmap.title);
    const empty = doc.pages.every(page => page.nodes.length === 0);
    const template = mindmap.templateId ? TEMPLATE_BY_ID[mindmap.templateId] : undefined;
    if (!empty || !template || template.id === "blank") return { doc, seeded: false };
    // Seed the board lit the way this person is working. It is stored, not
    // re-derived per viewer, so the document stays stable once shared — and it
    // is far better than handing someone in dark mode a white page.
    const mode: ThemeMode =
        document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    return {
        doc: { ...buildTemplate(template.id, mindmap.title, mode), title: mindmap.title },
        seeded: true,
    };
}

type PageState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; mindmap: MindmapDetail; doc: MindmapDoc; seeded: boolean };

export default function MindmapEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { user } = useUser();
    const [state, setState] = useState<PageState>({ status: "loading" });

    useSetBreadcrumbs([
        "Drift",
        "Mindmap",
        state.status === "ready" ? state.mindmap.title : "Loading…",
    ]);

    useEffect(() => {
        let cancelled = false;
        const numeric = Number.parseInt(id, 10);
        if (!Number.isInteger(numeric) || numeric <= 0) {
            setState({ status: "error", message: "That mindmap link isn't valid." });
            return;
        }
        void (async () => {
            try {
                const mindmap = await getMindmap(numeric);
                if (cancelled) return;
                const { doc, seeded } = seedDocument(mindmap);
                setState({ status: "ready", mindmap, doc, seeded });
            } catch (error) {
                if (cancelled) return;
                setState({
                    status: "error",
                    message:
                        error instanceof Error ? error.message : "We couldn't open that mindmap.",
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [id]);

    if (state.status === "loading") {
        return (
            <div className="text-ink-3 flex h-full items-center justify-center gap-2 text-[13px]">
                <Loader2 className="size-4 animate-spin" />
                Opening…
            </div>
        );
    }

    if (state.status === "error") {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-ink text-[15px] font-medium">{state.message}</p>
                <Button asChild variant="outline" size="sm">
                    <Link href="/employer/mindmap">
                        <ArrowLeft className="size-4" />
                        Back to all mindmaps
                    </Link>
                </Button>
            </div>
        );
    }

    const author =
        user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? user?.username ?? "You";

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
        />
    );
}
