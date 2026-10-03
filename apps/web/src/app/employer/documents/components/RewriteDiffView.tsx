"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ArrowRight,
    FileText,
    FileUp,
    Loader2,
    Paperclip,
    PenLine,
    Plus,
    Search,
    Sparkles,
    Type,
    Upload,
    Wand2,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { useToolNav } from "~/components/tool-app/nav";
import { ToolLink } from "~/components/tool-app/ToolLink";

import { DocumentGeneratorEditor } from "./DocumentGeneratorEditor";
import type { Citation } from "./generator";
import { legalTheme as s } from "./LegalGeneratorTheme";
import { rewritePath } from "./rewrite-screens";

/**
 * The screens of the Rewrite tool. They draw; `RewriteTool` owns the list,
 * the unsaved rewrite, saving and where the tab is.
 *
 * These sit in the tool frame's scroller with `fill` on, so the two list
 * screens bring their own padding and let the frame scroll them (and put
 * the scroll back on Back), and the editor takes the tab's full height.
 * They fold by the tab's width (`@max-*`), not the window's.
 */

/**
 * @deprecated The workspace renders `RewriteTool`. This name stays only so
 * the `StudioPanes` import keeps compiling until it switches; delete it with
 * that import.
 */

export interface RewriteDocument {
    id: string;
    title: string;
    lastEdited: string;
    content: string;
    citations?: Citation[];
}

/** Gutters shared by the hero, the search strip and the content below them. */
const GUTTER = "px-10 @max-md:px-6";

// ─── Hero ───────────────────────────────────────────────────────────────────

function RewriteHero() {
    return (
        <div className={`${GUTTER} @max-md:pt-8 pb-4 pt-10`}>
            <div className="mx-auto w-full max-w-7xl">
                <div className="flex items-start gap-4">
                    <div className={s.brandMark}>
                        <PenLine className="h-[18px] w-[18px]" />
                    </div>
                    <div className="space-y-2">
                        <span className={s.eyebrow}>Rewrite</span>
                        <h1 className={`${s.title} ${s.rewriteTitle}`}>
                            Refine your{" "}
                            <span className={s.highlight}>
                                <span className={s.accentWord}>prose</span>
                            </span>
                        </h1>
                        <p className={s.sub} style={{ maxWidth: 560 }}>
                            Paste or import text, pick a tone, preview the changes, then push the
                            polished version into your editor.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ScreenBody({ children }: { children: React.ReactNode }) {
    return <div className={`mx-auto w-full max-w-7xl ${GUTTER} @max-md:py-6 py-8`}>{children}</div>;
}

// ─── New rewrite ("/") ──────────────────────────────────────────────────────

export interface NewRewriteScreenProps {
    importError: string | null;
    isImporting: boolean;
    onImportFile: (file: File) => void;
    onPaste: () => void;
    onStartWorkflow: () => void;
    onStartBlank: () => void;
}

export function NewRewriteScreen({
    importError,
    isImporting,
    onImportFile,
    onPaste,
    onStartWorkflow,
    onStartBlank,
}: NewRewriteScreenProps) {
    const [isDragActive, setIsDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const importFirst = useCallback(
        (files: FileList | null) => {
            const file = files?.[0];
            if (file) onImportFile(file);
        },
        [onImportFile]
    );

    return (
        <div>
            <RewriteHero />
            <ScreenBody>
                <div className="space-y-8">
                    {importError && (
                        <div
                            role="alert"
                            className={`${s.banner} ${s.bannerDanger}`}
                            style={{ padding: 14 }}
                        >
                            <p className="text-danger m-0 text-[13px]">{importError}</p>
                        </div>
                    )}

                    {/* Primary CTA — start a workflow. Wraps rather than switching
                        direction, so it needs no width variant. */}
                    <div className={s.banner}>
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex min-w-[260px] flex-1 items-start gap-3">
                                <div className={s.brandMark}>
                                    <Sparkles className="h-[18px] w-[18px]" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <h3
                                        style={{
                                            margin: 0,
                                            fontSize: 17,
                                            fontWeight: 600,
                                            letterSpacing: "-0.01em",
                                            color: "var(--ink)",
                                        }}
                                    >
                                        Step-by-step rewrite
                                    </h3>
                                    <p
                                        style={{
                                            margin: 0,
                                            fontSize: 14,
                                            color: "var(--ink-2)",
                                            lineHeight: 1.55,
                                        }}
                                    >
                                        Paste or drop in text, choose tone / length / audience,
                                        preview the diff, then push to your document.
                                    </p>
                                </div>
                            </div>
                            <div className="shrink-0">
                                <button
                                    type="button"
                                    className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
                                    onClick={onStartWorkflow}
                                >
                                    <Wand2 className="h-4 w-4" />
                                    Start workflow
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Action grid */}
                    <div className="@max-md:grid-cols-1 grid grid-cols-3 gap-4">
                        {/* Drop zone */}
                        <button
                            type="button"
                            onClick={() => !isImporting && fileInputRef.current?.click()}
                            onDrop={e => {
                                e.preventDefault();
                                setIsDragActive(false);
                                importFirst(e.dataTransfer.files);
                            }}
                            onDragOver={e => {
                                e.preventDefault();
                                setIsDragActive(true);
                            }}
                            onDragLeave={e => {
                                e.preventDefault();
                                setIsDragActive(false);
                            }}
                            disabled={isImporting}
                            className={s.card}
                            style={{
                                padding: 22,
                                border: isDragActive
                                    ? "1px dashed var(--accent)"
                                    : "1px dashed var(--line)",
                                background: isDragActive ? "var(--accent-soft)" : "var(--panel)",
                                textAlign: "center",
                                alignItems: "center",
                                justifyContent: "center",
                                minHeight: 220,
                                cursor: isImporting ? "wait" : "pointer",
                                opacity: isImporting ? 0.7 : 1,
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".txt,.md,.pdf,.docx,.doc"
                                aria-label="Import a document"
                                onChange={e => importFirst(e.target.files)}
                                className="hidden"
                            />
                            <CardMark>
                                {isImporting ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                ) : (
                                    <Upload className="h-5 w-5" />
                                )}
                            </CardMark>
                            <CardTitle>
                                {isImporting ? "Importing…" : "Import a document"}
                            </CardTitle>
                            <CardText>
                                Drag &amp; drop or click to browse.
                                <br />
                                Supports <code style={{ fontSize: 12 }}>.txt</code>,{" "}
                                <code style={{ fontSize: 12 }}>.md</code>.
                            </CardText>
                        </button>

                        {/* Paste clipboard */}
                        <button
                            type="button"
                            onClick={onPaste}
                            className={s.card}
                            style={CENTERED_CARD}
                        >
                            <CardMark>
                                <Paperclip className="h-5 w-5" />
                            </CardMark>
                            <CardTitle>Paste from clipboard</CardTitle>
                            <CardText>
                                Pull text you already copied and jump straight into the workflow.
                            </CardText>
                        </button>

                        {/* Blank slate */}
                        <button
                            type="button"
                            onClick={onStartBlank}
                            className={s.card}
                            style={CENTERED_CARD}
                        >
                            <CardMark>
                                <FileUp className="h-5 w-5" />
                            </CardMark>
                            <CardTitle>Start from blank</CardTitle>
                            <CardText>
                                Open an empty editor and type or paste whatever you want to rewrite.
                            </CardText>
                        </button>
                    </div>

                    {/* Tips strip */}
                    <div className={s.panel} style={{ padding: 18 }}>
                        <div className="flex items-start gap-3">
                            <div className={s.brandMarkSm}>
                                <Type className="h-[13px] w-[13px]" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4
                                    style={{
                                        margin: 0,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: "var(--ink)",
                                        letterSpacing: "-0.01em",
                                    }}
                                >
                                    How the workflow works
                                </h4>
                                <div
                                    className="@max-md:grid-cols-1 mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5"
                                    style={{
                                        fontSize: 12,
                                        color: "var(--ink-3)",
                                        lineHeight: 1.55,
                                    }}
                                >
                                    <Tip step="Input">Paste, drop, or type the source text.</Tip>
                                    <Tip step="Options">Pick tone, length, audience, extras.</Tip>
                                    <Tip step="Preview">
                                        Side-by-side or inline diff, regenerate as needed.
                                    </Tip>
                                    <Tip step="Apply">
                                        Push the chosen version to your document.
                                    </Tip>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </ScreenBody>
        </div>
    );
}

const CENTERED_CARD: React.CSSProperties = {
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minHeight: 220,
};

function CardMark({ children }: { children: React.ReactNode }) {
    return (
        <div
            className={s.brandMark}
            style={{ width: 42, height: 42, borderRadius: 12, marginBottom: 12 }}
        >
            {children}
        </div>
    );
}

function CardTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3
            style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
            }}
        >
            {children}
        </h3>
    );
}

function CardText({ children }: { children: React.ReactNode }) {
    return (
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {children}
        </p>
    );
}

function Tip({ step, children }: { step: string; children: React.ReactNode }) {
    return (
        <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--ink-2)" }}>{step} →</strong> {children}
        </p>
    );
}

// ─── My rewrites ("/rewrites") ──────────────────────────────────────────────

export interface MyRewritesScreenProps {
    documents: RewriteDocument[];
    /** False until the list has come back once. */
    ready: boolean;
    searchQuery: string;
    onSearchQueryChange: (query: string) => void;
    onNewRewrite: () => void;
}

export function MyRewritesScreen({
    documents,
    ready,
    searchQuery,
    onSearchQueryChange,
    onNewRewrite,
}: MyRewritesScreenProps) {
    const filtered = documents.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div>
            <RewriteHero />

            <div className={`${GUTTER} pt-4`}>
                <div className="mx-auto w-full max-w-7xl">
                    <div className="relative">
                        <Search className="text-ink-3 pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                        <input
                            type="text"
                            className={s.input}
                            placeholder="Search your rewrites…"
                            aria-label="Search your rewrites"
                            value={searchQuery}
                            onChange={e => onSearchQueryChange(e.target.value)}
                            style={{ paddingLeft: 40 }}
                        />
                    </div>
                </div>
            </div>

            <ScreenBody>
                {!ready ? (
                    <div
                        className="flex items-center justify-center py-16"
                        aria-busy="true"
                        aria-label="Loading your rewrites"
                    >
                        <Loader2 className="text-brand h-6 w-6 animate-spin" />
                    </div>
                ) : filtered.length > 0 ? (
                    <div className="@max-lg:grid-cols-2 @max-md:grid-cols-1 grid grid-cols-3 gap-4">
                        {filtered.map(doc => (
                            <RewriteDocumentRow key={doc.id} doc={doc} />
                        ))}
                    </div>
                ) : (
                    <div
                        className={`${s.panel} mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center`}
                        style={{ borderStyle: "dashed" }}
                    >
                        <FileText className="text-ink-4 h-12 w-12" />
                        <h3
                            style={{
                                margin: 0,
                                fontSize: 19,
                                fontWeight: 600,
                                color: "var(--ink)",
                            }}
                        >
                            {searchQuery ? "No rewrites match" : "No rewrites yet"}
                        </h3>
                        <p
                            style={{
                                margin: 0,
                                fontSize: 14,
                                color: "var(--ink-3)",
                                maxWidth: 340,
                            }}
                        >
                            {searchQuery
                                ? `Nothing matched "${searchQuery}". Try a different keyword.`
                                : "Rewrite some prose to keep a history of polished drafts."}
                        </p>
                        <button
                            type="button"
                            className={`${s.btn} ${s.btnAccent}`}
                            onClick={onNewRewrite}
                            style={{ marginTop: 6 }}
                        >
                            <Plus className="h-4 w-4" />
                            New rewrite
                        </button>
                    </div>
                )}
            </ScreenBody>
        </div>
    );
}

/** A saved rewrite in the list: a real link, so ⌘-click opens it in a browser tab. */
function RewriteDocumentRow({ doc }: { doc: RewriteDocument }) {
    const preview = doc.content.replace(/<[^>]*>/g, "").slice(0, 160);
    return (
        <ToolLink href={rewritePath(doc.id)} className={s.docRow}>
            <div className="flex items-start gap-3">
                <div className={s.brandMarkSm}>
                    <PenLine className="h-[14px] w-[14px]" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3
                        style={{
                            margin: 0,
                            fontSize: 15,
                            fontWeight: 600,
                            color: "var(--ink)",
                            letterSpacing: "-0.01em",
                        }}
                        className="truncate"
                    >
                        {doc.title}
                    </h3>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
                        Last edited {doc.lastEdited}
                    </p>
                </div>
            </div>
            <p
                style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {preview}
                {preview.length >= 160 ? "…" : ""}
            </p>
            <div className="mt-auto">
                <span className={`${s.btn} ${s.btnOutline} ${s.btnSm}`} style={{ width: "100%" }}>
                    Open rewrite
                    <ArrowRight className="h-3.5 w-3.5" />
                </span>
            </div>
        </ToolLink>
    );
}

// ─── The editor ("/rewrites/<id>", "/rewrites/new") ─────────────────────────

export interface RewriteEditorScreenProps {
    /** What the editor starts with. It reads these once, on mount. */
    seed: { title: string; content: string; citations?: Citation[] };
    /** Absent until the rewrite has been saved once. */
    documentId?: number;
    saveError: string | null;
    onBack: () => void;
    onSave: (title: string, content: string, citations?: Citation[]) => Promise<void>;
}

export function RewriteEditorScreen({
    seed,
    documentId,
    saveError,
    onBack,
    onSave,
}: RewriteEditorScreenProps) {
    return (
        <div className="flex h-full w-full flex-col">
            {saveError && (
                <div
                    role="alert"
                    className="border-danger/[0.28] bg-danger/[0.08] text-danger shrink-0 border-b px-4 py-2 text-[13px]"
                >
                    {saveError}
                </div>
            )}
            <div className="min-h-0 flex-1">
                <DocumentGeneratorEditor
                    initialTitle={seed.title}
                    initialContent={seed.content}
                    initialCitations={seed.citations ?? []}
                    documentId={documentId}
                    onBack={onBack}
                    onSave={onSave}
                    mode="rewrite"
                />
            </div>
        </div>
    );
}

export function RewriteLoading() {
    return (
        <div
            className="flex h-full items-center justify-center"
            aria-busy="true"
            aria-label="Loading rewrite"
        >
            <Loader2 className="text-brand h-6 w-6 animate-spin" />
        </div>
    );
}

/**
 * A rewrite path whose id is not in the list: deleted, or a remembered
 * location that outlived it. Not a place to come back to, so the tab keeps
 * remembering the last screen that existed.
 */
export function RewriteMissing({ onShowAll }: { onShowAll: () => void }) {
    const { forgetCurrent, entryKey } = useToolNav();
    useEffect(() => forgetCurrent(), [forgetCurrent, entryKey]);
    return (
        <div className="@max-md:px-4 @max-md:pt-4 w-full px-8 pb-12 pt-6">
            <div className="border-line bg-panel flex max-w-xl flex-col items-start gap-2 rounded-lg border px-5 py-5">
                <div className="text-ink text-sm font-medium">This rewrite is not here</div>
                <p className="text-ink-2 text-sm">
                    It may have been deleted, or the link points at a rewrite in another workspace.
                </p>
                <Button size="sm" variant="outline" className="mt-1" onClick={onShowAll}>
                    Go to My rewrites
                </Button>
            </div>
        </div>
    );
}
