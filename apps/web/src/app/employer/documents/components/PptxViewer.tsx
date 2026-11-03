"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Download, Loader2, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";

import { ViewerNotice } from "./ViewerNotice";

// The PDF viewer pulls in pdf.js; only decks and PDFs should pay for it.
const PdfViewerWithNotes = dynamic(
    () => import("~/components/notes/PdfViewerWithNotes").then(m => m.PdfViewerWithNotes),
    { ssr: false }
);

const EMPTY_NOTES: never[] = [];

interface PptxViewerProps {
    documentId: number;
    /** The deck itself, for Download. */
    url: string;
    title: string;
}

type State =
    | { kind: "rendering" }
    | { kind: "failed"; detail: string | null }
    | { kind: "ready"; pdfUrl: string };

/** The URL the deck's rendered PDF is served from. */
export function deckPreviewUrl(documentId: number): string {
    return `/api/documents/${documentId}/preview`;
}

/**
 * The slides as PowerPoint lays them out: the deck rendered to PDF on the
 * server (Gotenberg, ADR-009) and shown in the PDF viewer, counted in slides.
 *
 * This replaced an embed of Microsoft's Office Online viewer, which needed
 * the file at a public https address — blank on every self-hosted stack, and
 * every deck's address handed to Microsoft when it did work. Nothing leaves
 * the deployment now, and the first reader of a version pays for the render.
 */
export function PptxViewer({ documentId, url, title }: PptxViewerProps) {
    const t = useTranslations("viewers.pptx");
    const tc = useTranslations("common");
    const [state, setState] = useState<State>({ kind: "rendering" });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let objectUrl: string | null = null;
        setState({ kind: "rendering" });
        void (async () => {
            try {
                const res = await fetch(deckPreviewUrl(documentId), { signal: controller.signal });
                if (!res.ok) {
                    // The route's refusals are typed JSON with a message in the
                    // reader's language; anything else is shown by status.
                    let detail: string | null = null;
                    try {
                        const body = (await res.json()) as { message?: unknown };
                        if (typeof body.message === "string" && body.message) detail = body.message;
                    } catch {
                        detail = null;
                    }
                    if (controller.signal.aborted) return;
                    setState({ kind: "failed", detail: detail ?? `HTTP ${res.status}` });
                    return;
                }
                const blob = await res.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                setState({ kind: "ready", pdfUrl: objectUrl });
            } catch (err) {
                if (controller.signal.aborted) return;
                setState({
                    kind: "failed",
                    detail: err instanceof Error ? err.message : null,
                });
            }
        })();
        return () => {
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [documentId, attempt]);

    const retry = useCallback(() => setAttempt(n => n + 1), []);

    if (state.kind === "rendering") {
        return (
            <div
                role="status"
                className="bg-panel-2/30 flex h-full flex-col items-center justify-center gap-3"
            >
                <Loader2 className="text-brand-ink h-8 w-8 animate-spin" />
                <p className="text-ink-3 text-sm font-medium">{t("rendering")}</p>
            </div>
        );
    }

    if (state.kind === "failed") {
        return (
            <ViewerNotice
                icon={<AlertTriangle />}
                title={t("renderFailed")}
                detail={state.detail ?? t("renderFailedDetail")}
                action={
                    <div className="flex items-center justify-center gap-3">
                        <Button size="sm" onClick={retry}>
                            <RotateCw />
                            {tc("actions.retry")}
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                            <a href={url} download>
                                <Download />
                                {t("download")}
                            </a>
                        </Button>
                    </div>
                }
            />
        );
    }

    return (
        <div className="flex h-full w-full flex-col overflow-hidden" aria-label={title}>
            <PdfViewerWithNotes
                url={state.pdfUrl}
                notes={EMPTY_NOTES}
                unit="slide"
                downloadUrl={url}
                downloadName={title}
            />
        </div>
    );
}
