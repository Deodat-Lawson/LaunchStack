"use client";

/**
 * Trash: restore a page (with its subtree) or delete it for good.
 */

import { FileText, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { WorkspaceStore } from "../useWorkspace";

export function TrashDialog({
    store,
    open,
    onClose,
    onNavigate,
}: {
    store: WorkspaceStore;
    open: boolean;
    onClose: () => void;
    onNavigate: (pageId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [confirming, setConfirming] = useState<string | null>(null);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        return store.trash.filter(
            (page) => !q || (page.title || "Untitled").toLowerCase().includes(q)
        );
    }, [store.trash, query]);

    if (!open) return null;

    return (
        <div className="ntn-overlay" onMouseDown={onClose} role="presentation">
            <div
                className="ntn-dialog ntn-dialog--trash"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-label="Trash"
            >
                <header className="ntn-dialog__header">
                    <h2>Trash</h2>
                    <button type="button" onClick={onClose}>
                        <X size={16} />
                    </button>
                </header>

                <div className="ntn-dialog__search">
                    <Search size={14} />
                    <input
                        className="ntn-input ntn-input--flush"
                        placeholder="Search pages in trash…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </div>

                <div className="ntn-dialog__list">
                    {matches.map((page) => (
                        <div key={page.id} className="ntn-trashrow">
                            <button
                                type="button"
                                className="ntn-trashrow__main"
                                onClick={() => {
                                    onNavigate(page.id);
                                    onClose();
                                }}
                            >
                                <span className="ntn-trashrow__icon">
                                    {page.icon?.type === "emoji" ? (
                                        page.icon.value
                                    ) : (
                                        <FileText size={14} />
                                    )}
                                </span>
                                <span className="ntn-trashrow__title">
                                    {page.title || "Untitled"}
                                </span>
                                {page.trashedAt && (
                                    <span className="ntn-trashrow__when">
                                        {new Date(page.trashedAt).toLocaleDateString()}
                                    </span>
                                )}
                            </button>
                            <button
                                type="button"
                                className="ntn-trashrow__action"
                                title="Restore"
                                onClick={() => void store.restorePage(page.id)}
                            >
                                <RotateCcw size={13} />
                            </button>
                            {confirming === page.id ? (
                                <button
                                    type="button"
                                    className="ntn-trashrow__action is-danger"
                                    onClick={() => {
                                        void store.deleteForever(page.id);
                                        setConfirming(null);
                                    }}
                                >
                                    Sure?
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="ntn-trashrow__action is-danger"
                                    title="Delete permanently"
                                    onClick={() => setConfirming(page.id)}
                                >
                                    <Trash2 size={13} />
                                </button>
                            )}
                        </div>
                    ))}
                    {matches.length === 0 && (
                        <div className="ntn-menu__empty">Trash is empty.</div>
                    )}
                </div>

                <div className="ntn-dialog__footer">
                    Pages in trash keep their sub-pages. Restoring a page brings them back with it.
                </div>
            </div>
        </div>
    );
}
