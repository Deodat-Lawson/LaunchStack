"use client";

import { useCallback, useState } from "react";
import {
    AlertTriangle,
    Check,
    Download,
    Eye,
    FileDown,
    EyeOff,
    Loader2,
    MessageSquare,
    PanelRightClose,
    PanelRightOpen,
    RotateCw,
    X,
    ZoomIn,
    ZoomOut,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { DocxCanvas } from "./DocxCanvas";
import { ReviewPane } from "./ReviewPane";
import { useDocxEditor } from "./useDocxEditor";

export interface DocxEditorProps {
    documentId: number;
    title: string;
    /** Rendered in the toolbar's leading slot — e.g. a back button. */
    leading?: React.ReactNode;
    className?: string;
}

const ZOOM_STEPS = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.35, 1.6, 2] as const;

function ToolbarButton({
    label,
    onClick,
    disabled,
    active,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    children: React.ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClick}
                    disabled={disabled}
                    aria-label={label}
                    aria-pressed={active}
                    className={cn(
                        "text-ink-3 hover:text-ink h-8 w-8 p-0",
                        active && "bg-brand-soft text-brand-ink hover:text-brand-ink"
                    )}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

/**
 * The Word document workspace: a faithful render of the file on the left, and
 * every tracked change and comment in it as an actionable list on the right.
 *
 * This replaces a viewer that ran documents through mammoth and showed
 * unstyled HTML with no notion of revisions — the file could be looked at but
 * not worked on. Accepting or rejecting a change here goes through adeu, so
 * the result is a real Word revision that opens correctly in Word.
 */
export function DocxEditor({ documentId, title, leading, className }: DocxEditorProps) {
    const { state, counts, reload, resolveEntry, replyToComment, resolveAll } =
        useDocxEditor(documentId);

    const [zoomIndex, setZoomIndex] = useState(4); // 1.0
    const [showChanges, setShowChanges] = useState(true);
    const [showComments, setShowComments] = useState(true);
    const [paneOpen, setPaneOpen] = useState(true);
    const [renderError, setRenderError] = useState<string | null>(null);

    const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
    const hasUnresolved = counts.changes > 0;

    const onRenderError = useCallback((message: string) => setRenderError(message), []);

    const retry = useCallback(() => {
        setRenderError(null);
        void reload();
    }, [reload]);

    if (state.loading) {
        return (
            <div className={cn("bg-surface flex h-full items-center justify-center", className)}>
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="text-brand h-7 w-7 animate-spin" aria-hidden="true" />
                    <p className="text-ink-3 text-sm">Opening {title}…</p>
                </div>
            </div>
        );
    }

    if (state.error) {
        return (
            <div
                className={cn(
                    "bg-surface flex h-full flex-col items-center justify-center gap-4 p-8 text-center",
                    className
                )}
            >
                <div className="bg-danger-soft flex h-12 w-12 items-center justify-center rounded-full">
                    <AlertTriangle className="text-danger h-6 w-6" aria-hidden="true" />
                </div>
                <div className="max-w-sm">
                    <p className="text-ink text-sm font-medium">Couldn’t open this document</p>
                    <p className="text-ink-3 mt-1 text-xs">{state.error.message}</p>
                </div>
                <div className="flex items-center gap-2">
                    {state.error.retryable && (
                        <Button size="sm" onClick={retry}>
                            <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            Try again
                        </Button>
                    )}
                    <Button size="sm" variant="outline" asChild>
                        <a href={`/api/documents/adeu/content?documentId=${documentId}`} download>
                            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            Download
                        </a>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <TooltipProvider delayDuration={400}>
            <div className={cn("bg-surface flex h-full min-h-0 flex-col", className)}>
                {/* Toolbar */}
                <div className="border-line bg-panel flex shrink-0 items-center gap-2 border-b px-3 py-2">
                    {leading}

                    <div className="mr-1 min-w-0 flex-1">
                        <h2 className="text-ink truncate text-sm font-medium" title={title}>
                            {title}
                        </h2>
                        <p className="text-ink-3 flex items-center gap-1.5 text-[11px]">
                            {counts.total === 0 ? (
                                <span>No pending revisions</span>
                            ) : (
                                <>
                                    <span className="tabular-nums">{counts.changes}</span>
                                    <span>{counts.changes === 1 ? "change" : "changes"}</span>
                                    {counts.comments > 0 && (
                                        <>
                                            <span aria-hidden="true">·</span>
                                            <span className="tabular-nums">{counts.comments}</span>
                                            <span>
                                                {counts.comments === 1 ? "comment" : "comments"}
                                            </span>
                                        </>
                                    )}
                                </>
                            )}
                            {state.authors.length > 0 && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span className="truncate">by {state.authors.join(", ")}</span>
                                </>
                            )}
                        </p>
                    </div>

                    {state.busy && (
                        <Loader2
                            className="text-ink-3 h-4 w-4 animate-spin"
                            aria-label="Applying changes"
                        />
                    )}

                    <div className="flex items-center gap-0.5">
                        <ToolbarButton
                            label="Zoom out"
                            onClick={() => setZoomIndex(i => Math.max(0, i - 1))}
                            disabled={zoomIndex === 0}
                        >
                            <ZoomOut className="h-4 w-4" aria-hidden="true" />
                        </ToolbarButton>
                        <span className="text-ink-3 w-11 text-center text-[11px] tabular-nums">
                            {Math.round(zoom * 100)}%
                        </span>
                        <ToolbarButton
                            label="Zoom in"
                            onClick={() =>
                                setZoomIndex(i => Math.min(ZOOM_STEPS.length - 1, i + 1))
                            }
                            disabled={zoomIndex === ZOOM_STEPS.length - 1}
                        >
                            <ZoomIn className="h-4 w-4" aria-hidden="true" />
                        </ToolbarButton>
                    </div>

                    <div className="bg-line h-5 w-px" aria-hidden="true" />

                    <div className="flex items-center gap-0.5">
                        <ToolbarButton
                            label={showChanges ? "Hide tracked changes" : "Show tracked changes"}
                            onClick={() => setShowChanges(v => !v)}
                            active={showChanges}
                        >
                            {showChanges ? (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                            ) : (
                                <EyeOff className="h-4 w-4" aria-hidden="true" />
                            )}
                        </ToolbarButton>
                        <ToolbarButton
                            label={showComments ? "Hide comments" : "Show comments"}
                            onClick={() => setShowComments(v => !v)}
                            active={showComments}
                        >
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        </ToolbarButton>
                    </div>

                    <div className="bg-line h-5 w-px" aria-hidden="true" />

                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-success hover:bg-success-soft hover:text-success h-8 text-xs"
                        disabled={!hasUnresolved || state.busy}
                        onClick={() => void resolveAll("accept")}
                    >
                        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Accept all
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger-soft hover:text-danger h-8 text-xs"
                        disabled={!hasUnresolved || state.busy}
                        onClick={() => void resolveAll("reject")}
                    >
                        <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Reject all
                    </Button>

                    <div className="bg-line h-5 w-px" aria-hidden="true" />

                    <ToolbarButton label="Download" onClick={() => void 0}>
                        <a
                            href={`/api/documents/adeu/content?documentId=${documentId}`}
                            download
                            aria-label="Download document"
                            className="flex h-full w-full items-center justify-center"
                        >
                            <Download className="h-4 w-4" aria-hidden="true" />
                        </a>
                    </ToolbarButton>
                    <ToolbarButton label="Download as PDF" onClick={() => void 0}>
                        <a
                            href={`/api/documents/pdf?documentId=${documentId}`}
                            download
                            aria-label="Download document as PDF"
                            className="flex h-full w-full items-center justify-center"
                        >
                            <FileDown className="h-4 w-4" aria-hidden="true" />
                        </a>
                    </ToolbarButton>
                    <ToolbarButton
                        label={paneOpen ? "Hide review pane" : "Show review pane"}
                        onClick={() => setPaneOpen(v => !v)}
                        active={paneOpen}
                    >
                        {paneOpen ? (
                            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                        ) : (
                            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                        )}
                    </ToolbarButton>
                </div>

                {renderError && (
                    <div className="border-line bg-warn-soft text-ink-2 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs">
                        <AlertTriangle
                            className="text-warn h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                        />
                        <span className="flex-1">
                            Some of this document could not be rendered: {renderError}
                        </span>
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={retry}>
                            Reload
                        </Button>
                    </div>
                )}

                {/* Body */}
                <div className="flex min-h-0 flex-1">
                    <div className="min-w-0 flex-1">
                        <DocxCanvas
                            bytes={state.bytes}
                            zoom={zoom}
                            showChanges={showChanges}
                            showComments={showComments}
                            onRenderError={onRenderError}
                        />
                    </div>

                    {paneOpen && (
                        <div className="w-[21rem] shrink-0">
                            <ReviewPane
                                entries={state.entries}
                                pending={state.pending}
                                busy={state.busy}
                                onResolve={(entry, decision) => void resolveEntry(entry, decision)}
                                onReply={(entry, text) => void replyToComment(entry, text)}
                            />
                        </div>
                    )}
                </div>

                {/* Status bar */}
                <div className="border-line bg-panel text-ink-3 flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-[11px]">
                    <span>
                        {counts.total === 0
                            ? "Clean document"
                            : `${counts.total} item${counts.total === 1 ? "" : "s"} to review`}
                    </span>
                    <span className="flex items-center gap-2">
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                            Word
                        </Badge>
                        <span>Tracked changes preserved</span>
                    </span>
                </div>
            </div>
        </TooltipProvider>
    );
}
