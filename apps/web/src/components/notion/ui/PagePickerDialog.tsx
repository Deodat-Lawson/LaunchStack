"use client";

/**
 * "Search for a page" — the dialog behind Link to page, Move to, and the
 * synced-block source picker.
 */

import { FileText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useNotionEditor } from "../context";
import type { WorkspacePageSummary } from "~/types/workspace";

export interface PagePickerDialogProps {
    open: boolean;
    title: string;
    onClose: () => void;
    onSelect: (page: WorkspacePageSummary) => void;
    /** Pages to exclude — a page cannot be moved into itself. */
    excludeIds?: string[];
    /** Rendered above the list; "Move to" uses it for a workspace-root row. */
    extraRow?: { label: string; onSelect: () => void } | null;
}

export function PagePickerDialog({
    open,
    title,
    onClose,
    onSelect,
    excludeIds = [],
    extraRow = null,
}: PagePickerDialogProps) {
    const { pages } = useNotionEditor();
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setQuery("");
            setActive(0);
            // Focus after the dialog paints, or the caret lands nowhere.
            const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
            return () => window.clearTimeout(timer);
        }
    }, [open]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        const excluded = new Set(excludeIds);
        return pages
            .filter((page) => !page.inTrash && !excluded.has(page.id))
            .filter((page) => !q || (page.title || "Untitled").toLowerCase().includes(q))
            .slice(0, 40);
    }, [pages, query, excludeIds]);

    if (!open) return null;

    return (
        <div className="ntn-overlay" onMouseDown={onClose} role="presentation">
            <div
                className="ntn-dialog ntn-dialog--picker"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-label={title}
            >
                <div className="ntn-dialog__search">
                    <Search size={14} />
                    <input
                        ref={inputRef}
                        className="ntn-input ntn-input--flush"
                        placeholder={title}
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActive(0);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") onClose();
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActive((index) => Math.min(index + 1, matches.length - 1));
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActive((index) => Math.max(index - 1, 0));
                            }
                            if (event.key === "Enter") {
                                const page = matches[active];
                                if (page) onSelect(page);
                            }
                        }}
                    />
                </div>

                <div className="ntn-dialog__list">
                    {extraRow && (
                        <button
                            type="button"
                            className="ntn-menu__item"
                            onClick={extraRow.onSelect}
                        >
                            <span className="ntn-menu__icon">🏠</span>
                            <span className="ntn-menu__text">
                                <span className="ntn-menu__title">{extraRow.label}</span>
                            </span>
                        </button>
                    )}
                    {matches.map((page, index) => (
                        <button
                            key={page.id}
                            type="button"
                            className={`ntn-menu__item${index === active ? " is-active" : ""}`}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => onSelect(page)}
                        >
                            <span className="ntn-menu__icon">
                                {page.icon?.type === "emoji" ? (
                                    <span>{page.icon.value}</span>
                                ) : (
                                    <FileText size={15} />
                                )}
                            </span>
                            <span className="ntn-menu__text">
                                <span className="ntn-menu__title">{page.title || "Untitled"}</span>
                            </span>
                        </button>
                    ))}
                    {matches.length === 0 && (
                        <div className="ntn-menu__empty">No pages found</div>
                    )}
                </div>
            </div>
        </div>
    );
}
