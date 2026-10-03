"use client";

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, Plus, Sparkles } from "lucide-react";

import {
    ToolFrame,
    ToolMark,
    ToolNotFound,
    type ToolNavGroup,
} from "~/components/tool-app/ToolFrame";
import { ToolNavProvider, useToolNav, type ToolHost } from "~/components/tool-app/nav";

import type { Citation } from "./generator";
import { RewriteWorkflow } from "./generator/RewriteWorkflow";
import {
    MyRewritesScreen,
    NewRewriteScreen,
    RewriteEditorScreen,
    RewriteLoading,
    RewriteMissing,
    type RewriteDocument,
} from "./RewriteDiffView";
import {
    isEditorScreen,
    MY_REWRITES_PATH,
    NEW_REWRITE_PATH,
    REWRITE_ROOTS,
    rewritePath,
    rewriteScreenFor,
    UNSAVED_REWRITE_PATH,
    WORKFLOW_PATH,
} from "./rewrite-screens";

/**
 * Rewrite: improve existing prose with a diff-first rewrite.
 *
 * A tab of the workspace in the same frame as every other tool. Each screen
 * is a path inside the tab (see `rewrite-screens.ts`), so the screen tabs, Back and
 * Forward, "Copy link" and the remembered last screen all work:
 *
 * - `/` New rewrite, `/rewrites` My rewrites — the bar's two tabs.
 * - `/rewrites/<id>` a saved rewrite in the editor; Back returns to the list.
 * - `/rewrites/new` the editor before its first save. That first save
 *   replaces the entry with `/rewrites/<id>` without remounting the editor.
 * - `/steps` the step-by-step workflow, a full view of its own; finishing it
 *   replaces it with the unsaved rewrite, Exit goes back.
 *
 * The workflow's input and an unsaved rewrite live only in memory, so those
 * two are never remembered as the tab's last screen: reopening the tab lands
 * on the screen before them, not on an empty editor.
 */
export function RewriteTool({ host }: { host?: ToolHost }) {
    return (
        <ToolNavProvider toolId="rewrite" roots={REWRITE_ROOTS} host={host}>
            <RewriteFrame />
        </ToolNavProvider>
    );
}

const DOCUMENTS_URL = "/api/document-generator/documents";
const LIST_URL = `${DOCUMENTS_URL}?templateId=rewrite`;
const DEFAULT_TITLE = "Untitled (Rewrite)";
const PENDING_REWRITE_STORAGE_KEY = "pdr.pendingRewriteDraft";

interface APIDocument {
    id: number;
    title: string;
    content: string;
    templateId?: string;
    citations?: Citation[];
    createdAt: string;
    updatedAt?: string;
}

interface PendingRewriteDraft {
    title?: string;
    content?: string;
    createdAt?: number;
    source?: string;
}

/** The editor's starting point before the first save. `seq` tells one unsaved rewrite from the next. */
interface UnsavedRewrite {
    seq: number;
    title: string;
    content: string;
}

function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
}

function toRewriteDocument(doc: APIDocument): RewriteDocument {
    return {
        id: doc.id.toString(),
        title: doc.title,
        lastEdited: formatRelativeTime(doc.updatedAt ?? doc.createdAt),
        content: doc.content,
        citations: doc.citations,
    };
}

/** Put a just-saved rewrite in the list: replace it in place, or add it at the top. */
function upsertDocument(list: RewriteDocument[], doc: RewriteDocument): RewriteDocument[] {
    const index = list.findIndex(d => d.id === doc.id);
    if (index < 0) return [doc, ...list];
    const next = list.slice();
    next[index] = doc;
    return next;
}

async function readImportedFile(file: File): Promise<string> {
    const fileType = file.name.split(".").pop()?.toLowerCase();
    switch (fileType) {
        case "txt":
        case "md":
            return file.text();
        case "pdf":
            throw new Error(
                "PDF import not yet supported. Please copy and paste the text manually."
            );
        case "docx":
            throw new Error(
                "DOCX import not yet supported. Please copy and paste the text manually."
            );
        default:
            return file.text();
    }
}

/**
 * Text another tool handed over (Growth's "push to rewrite document"), read
 * once and removed.
 */
function takePendingRewrite(): { title: string; content: string } | null {
    let raw: string | null = null;
    try {
        raw = sessionStorage.getItem(PENDING_REWRITE_STORAGE_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(PENDING_REWRITE_STORAGE_KEY);

        const parsed = JSON.parse(raw) as PendingRewriteDraft;
        const content = typeof parsed.content === "string" ? parsed.content : "";
        if (!content.trim()) return null;

        const title =
            typeof parsed.title === "string" && parsed.title.trim().length > 0
                ? parsed.title.trim()
                : "Rewritten Text";
        return { title, content };
    } catch {
        if (raw) {
            try {
                sessionStorage.removeItem(PENDING_REWRITE_STORAGE_KEY);
            } catch {
                // Ignore cleanup errors.
            }
        }
        return null;
    }
}

interface SaveResponse {
    success: boolean;
    message?: string;
    document?: { id: number };
}

/** Rewrite's frame and state. Renders inside `RewriteTool`'s provider. */
function RewriteFrame() {
    const nav = useToolNav();
    // Callbacks read the latest navigation through this, so they keep one
    // identity and effects that use them do not re-run on every move.
    const navRef = useRef(nav);
    navRef.current = nav;
    const screen = rewriteScreenFor(nav.path);

    const [documents, setDocuments] = useState<RewriteDocument[]>([]);
    const [listReady, setListReady] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [unsaved, setUnsaved] = useState<UnsavedRewrite | null>(null);
    const [workflowText, setWorkflowText] = useState("");
    const [isImporting, setIsImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    /** Shown only in the editor whose save failed. */
    const [saveError, setSaveError] = useState<{ editorKey: string; message: string } | null>(null);
    /**
     * A rewrite saved for the first time keeps the editor it was written in:
     * its path changes from /rewrites/new to /rewrites/<id>, its editor key
     * does not.
     */
    const [editorKeyOf, setEditorKeyOf] = useState<Record<string, string>>({});
    const unsavedSeq = useRef(0);

    // ── The list ────────────────────────────────────────────────────────────
    // Requests are numbered so an answer that left before a save cannot
    // overwrite the list with a copy that does not have it.
    const listIssued = useRef(0);
    const listSettled = useRef(0);
    const loadDocuments = useCallback(async () => {
        const request = ++listIssued.current;
        let docs: RewriteDocument[] | null = null;
        try {
            const response = await fetch(LIST_URL);
            const data = (await response.json()) as {
                success: boolean;
                message?: string;
                documents?: APIDocument[];
            };
            if (data.success && data.documents) docs = data.documents.map(toRewriteDocument);
        } catch {
            // The list stays as it was.
        }
        if (request !== listIssued.current) return; // A newer request is on its way.
        listSettled.current = request;
        if (docs) setDocuments(docs);
        setListReady(true);
    }, []);

    useEffect(() => {
        void loadDocuments();
    }, [loadDocuments]);

    const editing = isEditorScreen(screen);
    const wasEditing = useRef(editing);
    useEffect(() => {
        // Leaving the editor, however it is left (its Back, the frame's, the
        // screen tabs), refreshes the list, as the old Back to list did.
        if (wasEditing.current && !editing) void loadDocuments();
        wasEditing.current = editing;
    }, [editing, loadDocuments]);

    const recordSaved = useCallback(
        (doc: RewriteDocument) => {
            setDocuments(prev => upsertDocument(prev, doc));
            if (listSettled.current !== listIssued.current) void loadDocuments();
        },
        [loadDocuments]
    );

    // ── Moving between screens ──────────────────────────────────────────────
    const openUnsaved = useCallback(
        (title: string, content: string, options?: { replace?: boolean }) => {
            unsavedSeq.current += 1;
            setUnsaved({ seq: unsavedSeq.current, title, content });
            navRef.current.navigate(UNSAVED_REWRITE_PATH, options);
        },
        []
    );

    /** Back where the person came from; with nowhere to go back to, `fallback`. */
    const leave = useCallback((fallback: string, options?: { replace?: boolean }) => {
        const current = navRef.current;
        if (current.canBack) current.back();
        else current.navigate(fallback, options);
    }, []);

    const startWorkflow = useCallback((text?: string) => {
        setWorkflowText(text ?? "");
        navRef.current.navigate(WORKFLOW_PATH);
    }, []);

    const completeWorkflow = useCallback(
        (rewrittenText: string) => {
            setWorkflowText("");
            // The workflow's progress ends here, so the editor takes its place
            // in the history: Back from the editor skips the finished workflow.
            openUnsaved("Rewritten Text", rewrittenText, { replace: true });
        },
        [openUnsaved]
    );

    const exitWorkflow = useCallback(() => {
        setWorkflowText("");
        leave(NEW_REWRITE_PATH, { replace: true });
    }, [leave]);

    const importFile = useCallback(
        async (file: File) => {
            setIsImporting(true);
            setImportError(null);
            try {
                startWorkflow(await readImportedFile(file));
            } catch (error) {
                setImportError(error instanceof Error ? error.message : "Failed to import file");
            } finally {
                setIsImporting(false);
            }
        },
        [startWorkflow]
    );

    const pasteFromClipboard = useCallback(() => {
        navigator.clipboard
            .readText()
            .then(text => {
                if (text.trim()) startWorkflow(text);
            })
            .catch(() => {
                setImportError("Failed to read from clipboard");
            });
    }, [startWorkflow]);

    // Text handed over by another tool opens in the editor. Checked when the
    // tab mounts and whenever it comes to the front: tabs stay mounted, so a
    // hand-off to a Rewrite tab that is already open arrives on focus.
    const active = nav.active;
    useEffect(() => {
        if (!active) return;
        const pending = takePendingRewrite();
        if (pending) openUnsaved(pending.title, pending.content);
    }, [active, openUnsaved]);

    // The workflow's input and an unsaved rewrite are not worth reopening the
    // tab on. This runs before the provider records the visit (children's
    // effects run first), so the remembered screen stays the one before.
    const transient = screen.screen === "workflow" || screen.screen === "unsaved";
    const { forgetCurrent, entryKey } = nav;
    useEffect(() => {
        if (transient) forgetCurrent();
    }, [transient, forgetCurrent, entryKey]);

    // ── Saving ──────────────────────────────────────────────────────────────
    const unsavedKey = `unsaved:${unsaved?.seq ?? 0}`;
    const savedKey = (id: string) => editorKeyOf[id] ?? `rewrite:${id}`;
    const editorKey =
        screen.screen === "unsaved"
            ? unsavedKey
            : screen.screen === "rewrite"
              ? savedKey(screen.id)
              : null;
    const editorKeyRef = useRef(editorKey);
    editorKeyRef.current = editorKey;

    const save = useCallback(
        async (
            target: RewriteDocument | null,
            forEditor: string,
            title: string,
            content: string,
            citations?: Citation[]
        ) => {
            setSaveError(null);
            const fail = (message: string) => setSaveError({ editorKey: forEditor, message });
            const trimmedTitle = title.trim();
            const docTitle = trimmedTitle.length > 0 ? trimmedTitle : DEFAULT_TITLE;
            try {
                const response = await fetch(DOCUMENTS_URL, {
                    method: target ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        target
                            ? {
                                  id: parseInt(target.id, 10),
                                  title: docTitle,
                                  content,
                                  citations: citations ?? [],
                              }
                            : {
                                  title: docTitle,
                                  content,
                                  templateId: "rewrite",
                                  citations: citations ?? [],
                                  metadata: { source: "rewrite" },
                              }
                    ),
                });
                const text = await response.text();
                let data: SaveResponse;
                try {
                    data = JSON.parse(text) as SaveResponse;
                } catch {
                    fail(
                        response.ok
                            ? "Invalid response from server"
                            : `Failed to save (${response.status}). ${text.slice(0, 100)}`
                    );
                    return;
                }
                if (!data.success) {
                    fail(data.message ?? "Failed to save document");
                    return;
                }
                const saved = { title: docTitle, content, citations: citations ?? [] };
                if (target) {
                    recordSaved({ ...target, ...saved, lastEdited: "Just now" });
                    return;
                }
                if (!data.document?.id) return;
                const id = data.document.id.toString();
                setEditorKeyOf(prev => ({ ...prev, [id]: forEditor }));
                recordSaved({ id, ...saved, lastEdited: "Just now" });
                // Still on this rewrite? It has a path of its own now. (Someone
                // who moved on while it saved stays where they went.)
                if (editorKeyRef.current === forEditor) {
                    navRef.current.navigate(rewritePath(id), { replace: true });
                }
            } catch (err) {
                console.error("Save to documents failed:", err);
                fail("Failed to save document");
            }
        },
        [recordSaved]
    );

    const backFromEditor = useCallback(() => leave(MY_REWRITES_PATH), [leave]);

    // ── The current screen ──────────────────────────────────────────────────
    let body: ReactNode;
    switch (screen.screen) {
        case "new":
            body = (
                <NewRewriteScreen
                    importError={importError}
                    isImporting={isImporting}
                    onImportFile={file => void importFile(file)}
                    onPaste={pasteFromClipboard}
                    onStartWorkflow={() => startWorkflow()}
                    onStartBlank={() => openUnsaved("", "")}
                />
            );
            break;
        case "rewrites":
            body = (
                <MyRewritesScreen
                    documents={documents}
                    ready={listReady}
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    onNewRewrite={() => {
                        setSearchQuery("");
                        nav.navigate(NEW_REWRITE_PATH);
                    }}
                />
            );
            break;
        case "unsaved": {
            const key = unsavedKey;
            body = (
                <RewriteEditorScreen
                    key={key}
                    seed={unsaved ?? { title: "", content: "" }}
                    saveError={saveError?.editorKey === key ? saveError.message : null}
                    onBack={backFromEditor}
                    onSave={(title, content, citations) =>
                        save(null, key, title, content, citations)
                    }
                />
            );
            break;
        }
        case "rewrite": {
            const doc = documents.find(d => d.id === screen.id);
            if (!doc) {
                body = listReady ? (
                    <RewriteMissing onShowAll={() => nav.navigate(MY_REWRITES_PATH)} />
                ) : (
                    <RewriteLoading />
                );
                break;
            }
            const key = savedKey(doc.id);
            body = (
                <RewriteEditorScreen
                    key={key}
                    seed={doc}
                    documentId={parseInt(doc.id, 10)}
                    saveError={saveError?.editorKey === key ? saveError.message : null}
                    onBack={backFromEditor}
                    onSave={(title, content, citations) =>
                        save(doc, key, title, content, citations)
                    }
                />
            );
            break;
        }
        case "workflow":
            body = (
                <RewriteWorkflow
                    initialText={workflowText}
                    onComplete={completeWorkflow}
                    onCancel={exitWorkflow}
                />
            );
            break;
        default:
            body = (
                <div className="@max-md:px-4 @max-md:pt-4 w-full px-8 pb-12 pt-6">
                    <ToolNotFound home={NEW_REWRITE_PATH} homeLabel="New rewrite" />
                </div>
            );
    }

    const groups: ToolNavGroup[] = [
        {
            id: "rewrite",
            items: [
                { to: NEW_REWRITE_PATH, label: "New rewrite", icon: Plus, exact: true },
                {
                    to: MY_REWRITES_PATH,
                    label: "My rewrites",
                    icon: Clock,
                    count: listReady ? documents.length : null,
                },
            ],
        },
    ];

    return (
        <ToolFrame title="Rewrite" mark={<ToolMark icon={Sparkles} />} groups={groups} fill>
            {/* The selection colour the old theme wrapper gave these screens. */}
            <div
                data-testid="rewrite-tool"
                className="selection:bg-brand-glow selection:text-ink h-full"
            >
                {body}
            </div>
        </ToolFrame>
    );
}
