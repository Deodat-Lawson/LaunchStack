"use client";

/**
 * One open page: topbar, cover, icon, title, body, backlinks, and the rails
 * and dialogs that hang off them.
 *
 * This is also where saving lives. Body edits are debounced; title, icon,
 * cover and page settings save immediately, because those are single
 * deliberate acts rather than a stream of keystrokes.
 */

import type { Editor, JSONContent } from "@tiptap/react";
import {
    ChevronRight,
    Clock,
    ImagePlus,
    Loader2,
    MessageSquare,
    MoreHorizontal,
    Smile,
    Star,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NotionEditor } from "../editor/NotionEditor";
import { Popover } from "../ui/Popover";
import { PagePickerDialog } from "../ui/PagePickerDialog";
import { CommentsRail, type PendingComment } from "./CommentsRail";
import { PageCover, randomCover } from "./PageCover";
import { PageHistoryDialog } from "./PageHistoryDialog";
import { IconPickerPanel, PageIconDisplay } from "./PageIconPicker";
import { PageMenu } from "./PageMenu";
import { TemplateStarter } from "./TemplateStarter";
import type { PageTemplate } from "../lib/templates";
import type {
    PageIcon,
    WorkspaceBacklink,
    WorkspacePageDto,
} from "~/types/workspace";

/** How long typing pauses before the body is written. */
const SAVE_DEBOUNCE_MS = 800;
/** How often a save also writes a history snapshot. */
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface PageShellProps {
    page: WorkspacePageDto;
    breadcrumb: Array<{ id: string; title: string; icon: PageIcon | null }>;
    backlinks: WorkspaceBacklink[];
    onNavigate: (pageId: string) => void;
    /** Reflect a change in the sidebar without a round-trip. */
    onLocalChange: (patch: { title?: string; icon?: PageIcon | null; isFavorite?: boolean }) => void;
    onDuplicate: () => void;
    onTrash: () => void;
    onMove: (parentPageId: string | null) => void;
}

type SaveState = "idle" | "saving" | "saved";

/**
 * True for a document with nothing in it. A fresh page is a single empty
 * paragraph, and that is what the starter row keys off — anything more means
 * the user has begun and the offer should get out of the way.
 */
function isBlankDoc(content: unknown): boolean {
    const doc = content as { content?: Array<{ type?: string; content?: unknown[] }> } | null;
    if (!doc?.content || doc.content.length === 0) return true;
    if (doc.content.length > 1) return false;
    const [only] = doc.content;
    return only?.type === "paragraph" && !only.content?.length;
}

export function PageShell({
    page,
    breadcrumb,
    backlinks,
    onNavigate,
    onLocalChange,
    onDuplicate,
    onTrash,
    onMove,
}: PageShellProps) {
    const [local, setLocal] = useState(page);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [menuOpen, setMenuOpen] = useState(false);
    const [iconOpen, setIconOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [pendingComment, setPendingComment] = useState<PendingComment | null>(null);
    const [movePickerOpen, setMovePickerOpen] = useState(false);
    const [isEmpty, setIsEmpty] = useState(() => isBlankDoc(page.content));

    const menuRef = useRef<HTMLButtonElement>(null);
    const iconRef = useRef<HTMLButtonElement>(null);
    const saveTimer = useRef<number | null>(null);
    const lastSnapshot = useRef<number>(Date.now());
    const titleRef = useRef<HTMLTextAreaElement>(null);

    // A different page means different content; reset rather than merge.
    useEffect(() => {
        setLocal(page);
        setPendingComment(null);
        setIsEmpty(isBlankDoc(page.content));
    }, [page]);

    const persist = useCallback(
        async (patch: Record<string, unknown>, snapshot = false) => {
            setSaveState("saving");
            try {
                const response = await fetch(`/api/workspace/pages/${page.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...patch, snapshot }),
                });
                setSaveState(response.ok ? "saved" : "idle");
            } catch {
                setSaveState("idle");
            }
        },
        [page.id]
    );

    /** Immediate save for deliberate, low-frequency edits. */
    const patchPage = useCallback(
        (patch: Partial<WorkspacePageDto>) => {
            setLocal((current) => ({ ...current, ...patch }));
            if (patch.title !== undefined || patch.icon !== undefined || patch.isFavorite !== undefined) {
                onLocalChange({
                    ...(patch.title !== undefined ? { title: patch.title } : {}),
                    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
                    ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}),
                });
            }
            void persist(patch as Record<string, unknown>);
        },
        [onLocalChange, persist]
    );

    /** Debounced save for the body. */
    const onBodyChange = useCallback(
        (doc: JSONContent) => {
            setIsEmpty(isBlankDoc(doc));
            setSaveState("saving");
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
                const due = Date.now() - lastSnapshot.current > SNAPSHOT_INTERVAL_MS;
                if (due) lastSnapshot.current = Date.now();
                void persist({ content: doc }, due);
            }, SAVE_DEBOUNCE_MS);
        },
        [persist]
    );

    // A pending save must not be lost to a navigation.
    useEffect(() => {
        return () => {
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
        };
    }, []);

    // Auto-size the title so a long one wraps instead of scrolling.
    useEffect(() => {
        const element = titleRef.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${element.scrollHeight}px`;
    }, [local.title]);

    const exportPage = useCallback(
        (format: "markdown" | "html" | "text") => {
            window.open(
                `/api/workspace/pages/${page.id}/export?format=${format}`,
                "_blank",
                "noopener"
            );
        },
        [page.id]
    );

    const copyLink = useCallback(() => {
        void navigator.clipboard.writeText(
            `${window.location.origin}/employer/workspace/${page.id}`
        );
    }, [page.id]);

    const startComment = useCallback((blockId: string, anchorText: string) => {
        setPendingComment({ blockId, anchorText });
        setCommentsOpen(true);
    }, []);

    const applyTemplate = useCallback(
        (template: PageTemplate) => {
            editor?.commands.setContent(template.content as JSONContent);
            const patch: Partial<WorkspacePageDto> = {
                content: template.content,
                icon: local.icon ?? { type: "emoji", value: template.icon },
            };
            if (!local.title.trim()) patch.title = template.title;
            setLocal((current) => ({ ...current, ...patch }));
            onLocalChange({
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
            });
            void persist(patch as Record<string, unknown>);
            setIsEmpty(false);
        },
        [editor, local.icon, local.title, onLocalChange, persist]
    );

    const insertStarterDatabase = useCallback(async () => {
        const response = await fetch("/api/workspace/databases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageId: page.id, viewType: "table", isInline: true }),
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
            database?: { id: string; views: Array<{ id: string }> };
        };
        if (!data.database) return;
        editor
            ?.chain()
            .focus()
            .setDatabaseBlock({
                databaseId: data.database.id,
                viewId: data.database.views[0]?.id ?? null,
            })
            .run();
        setIsEmpty(false);
    }, [editor, page.id]);

    const saveLabel = useMemo(() => {
        if (saveState === "saving") return "Saving…";
        if (saveState === "saved") return "Saved";
        return "";
    }, [saveState]);

    const editable = !local.locked;

    return (
        <div className={`ntn-page${commentsOpen ? " has-rail" : ""}`}>
            <header className="ntn-topbar">
                <nav className="ntn-breadcrumbs">
                    {breadcrumb.map((crumb, index) => (
                        <span key={crumb.id} className="ntn-breadcrumbs__item">
                            {index > 0 && <ChevronRight size={13} className="ntn-breadcrumbs__sep" />}
                            <button
                                type="button"
                                className={crumb.id === page.id ? "is-current" : ""}
                                onClick={() => onNavigate(crumb.id)}
                            >
                                {crumb.icon?.type === "emoji" && <span>{crumb.icon.value}</span>}
                                <span>{crumb.title || "Untitled"}</span>
                            </button>
                        </span>
                    ))}
                    {local.locked && <span className="ntn-topbar__locked">Locked</span>}
                </nav>

                <div className="ntn-topbar__actions">
                    <span className="ntn-topbar__save">{saveLabel}</span>
                    <button
                        type="button"
                        className="ntn-topbar__btn"
                        title="Comments"
                        onClick={() => setCommentsOpen((open) => !open)}
                    >
                        <MessageSquare size={16} />
                    </button>
                    <button
                        type="button"
                        className="ntn-topbar__btn"
                        title="Page history"
                        onClick={() => setHistoryOpen(true)}
                    >
                        <Clock size={16} />
                    </button>
                    <button
                        type="button"
                        className={`ntn-topbar__btn${local.isFavorite ? " is-active" : ""}`}
                        title={local.isFavorite ? "Remove from favourites" : "Add to favourites"}
                        onClick={() => patchPage({ isFavorite: !local.isFavorite })}
                    >
                        <Star size={16} fill={local.isFavorite ? "currentColor" : "none"} />
                    </button>
                    <button
                        ref={menuRef}
                        type="button"
                        className="ntn-topbar__btn"
                        title="More"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <MoreHorizontal size={16} />
                    </button>
                </div>
            </header>

            <div className="ntn-page__scroll">
                <PageCover
                    cover={local.cover}
                    editable={editable}
                    onChange={(cover) => patchPage({ cover })}
                />

                <div
                    className={`ntn-page__body${local.fullWidth ? " is-full" : ""}`}
                    data-font={local.font}
                    data-small={local.smallText ? "true" : "false"}
                >
                    <div className={`ntn-page__head${local.cover ? " has-cover" : ""}`}>
                        {local.icon && (
                            <PageIconDisplay
                                icon={local.icon}
                                onClick={editable ? () => setIconOpen(true) : undefined}
                            />
                        )}

                        {editable && (
                            <div className="ntn-page__addbar">
                                {!local.icon && (
                                    <button
                                        ref={iconRef}
                                        type="button"
                                        className="ntn-page__addbtn"
                                        onClick={() => setIconOpen(true)}
                                    >
                                        <Smile size={14} /> Add icon
                                    </button>
                                )}
                                {!local.cover && (
                                    <button
                                        type="button"
                                        className="ntn-page__addbtn"
                                        onClick={() => patchPage({ cover: randomCover() })}
                                    >
                                        <ImagePlus size={14} /> Add cover
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="ntn-page__addbtn"
                                    onClick={() => startComment("", "")}
                                >
                                    <MessageSquare size={14} /> Add comment
                                </button>
                            </div>
                        )}

                        <textarea
                            ref={titleRef}
                            className="ntn-title"
                            value={local.title}
                            placeholder="Untitled"
                            rows={1}
                            spellCheck
                            readOnly={!editable}
                            onChange={(event) => {
                                const title = event.target.value.replace(/\n/g, "");
                                setLocal((current) => ({ ...current, title }));
                                onLocalChange({ title });
                            }}
                            onBlur={() => void persist({ title: local.title })}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    editor?.commands.focus("start");
                                }
                                if (event.key === "ArrowDown" || event.key === "Tab") {
                                    event.preventDefault();
                                    editor?.commands.focus("start");
                                }
                            }}
                        />
                    </div>

                    <NotionEditor
                        pageId={page.id}
                        initialContent={(page.content as JSONContent | null) ?? null}
                        editable={editable}
                        font={local.font}
                        smallText={local.smallText}
                        fullWidth={local.fullWidth}
                        onChange={onBodyChange}
                        onEditorReady={setEditor}
                        onComment={startComment}
                        onMoveBlock={() => setMovePickerOpen(true)}
                    />

                    {editable && isEmpty && (
                        <TemplateStarter
                            onApply={applyTemplate}
                            onInsertDatabase={() => void insertStarterDatabase()}
                        />
                    )}

                    {backlinks.length > 0 && (
                        <section className="ntn-backlinks">
                            <h3>Linked to this page</h3>
                            <div className="ntn-backlinks__list">
                                {backlinks.map((link) => (
                                    <button
                                        key={link.id}
                                        type="button"
                                        className="ntn-backlinks__item"
                                        onClick={() => onNavigate(link.id)}
                                    >
                                        <span>{link.icon?.type === "emoji" ? link.icon.value : "📄"}</span>
                                        <span>{link.title || "Untitled"}</span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </div>

            <CommentsRail
                pageId={page.id}
                open={commentsOpen}
                pending={pendingComment}
                onClearPending={() => setPendingComment(null)}
                onClose={() => {
                    setCommentsOpen(false);
                    setPendingComment(null);
                }}
            />

            <Popover
                anchor={menuRef.current}
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                placement="bottom-end"
                ignore={[menuRef.current]}
            >
                <PageMenu
                    page={local}
                    editor={editor}
                    onPatch={patchPage}
                    onDuplicate={onDuplicate}
                    onMove={() => setMovePickerOpen(true)}
                    onTrash={onTrash}
                    onHistory={() => setHistoryOpen(true)}
                    onExport={exportPage}
                    onCopyLink={copyLink}
                    onClose={() => setMenuOpen(false)}
                />
            </Popover>

            <Popover
                anchor={iconRef.current}
                open={iconOpen}
                onClose={() => setIconOpen(false)}
                ignore={[iconRef.current]}
            >
                <IconPickerPanel
                    onSelect={(icon) => {
                        patchPage({ icon });
                        setIconOpen(false);
                    }}
                    onRemove={() => {
                        patchPage({ icon: null });
                        setIconOpen(false);
                    }}
                    onClose={() => setIconOpen(false)}
                />
            </Popover>

            <PageHistoryDialog
                pageId={page.id}
                open={historyOpen}
                onClose={() => setHistoryOpen(false)}
                onRestored={() => window.location.reload()}
            />

            <PagePickerDialog
                open={movePickerOpen}
                title="Move to"
                excludeIds={[page.id]}
                extraRow={{
                    label: "Workspace (top level)",
                    onSelect: () => {
                        onMove(null);
                        setMovePickerOpen(false);
                    },
                }}
                onClose={() => setMovePickerOpen(false)}
                onSelect={(target) => {
                    onMove(target.id);
                    setMovePickerOpen(false);
                }}
            />

            {saveState === "saving" && (
                <span className="ntn-page__spinner" aria-hidden>
                    <Loader2 size={12} className="ntn-spin" />
                </span>
            )}
        </div>
    );
}
