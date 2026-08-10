"use client";

/**
 * Quick Find (⌘K).
 *
 * Server-side search so body text is searchable, debounced so typing does not
 * fire a query per keystroke. An empty query shows recently-edited pages,
 * which is what the real one does.
 */

import { FileText, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceSearchHit } from "~/types/workspace";

const DEBOUNCE_MS = 180;

export function QuickFind({
    open,
    onClose,
    onNavigate,
}: {
    open: boolean;
    onClose: () => void;
    onNavigate: (pageId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<WorkspaceSearchHit[]>([]);
    const [loading, setLoading] = useState(false);
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setActive(0);
        const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => window.clearTimeout(timer);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        const run = async () => {
            try {
                const response = await fetch(
                    `/api/workspace/search?q=${encodeURIComponent(query)}`
                );
                if (!response.ok || cancelled) return;
                const data = (await response.json()) as { results: WorkspaceSearchHit[] };
                if (!cancelled) {
                    setResults(data.results);
                    setActive(0);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        const timer = window.setTimeout(() => void run(), DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [query, open]);

    const heading = useMemo(
        () => (query.trim() ? "Results" : "Recently edited"),
        [query]
    );

    if (!open) return null;

    return (
        <div className="ntn-overlay ntn-overlay--top" onMouseDown={onClose} role="presentation">
            <div
                className="ntn-dialog ntn-dialog--search"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-label="Search pages"
            >
                <div className="ntn-dialog__search">
                    {loading ? <Loader2 size={15} className="ntn-spin" /> : <Search size={15} />}
                    <input
                        ref={inputRef}
                        className="ntn-input ntn-input--flush"
                        placeholder="Search pages…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") onClose();
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActive((index) => Math.min(index + 1, results.length - 1));
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActive((index) => Math.max(index - 1, 0));
                            }
                            if (event.key === "Enter") {
                                const hit = results[active];
                                if (hit) {
                                    onNavigate(hit.id);
                                    onClose();
                                }
                            }
                        }}
                    />
                </div>

                <div className="ntn-dialog__list">
                    <div className="ntn-menu__heading">{heading}</div>
                    {results.map((hit, index) => (
                        <button
                            key={hit.id}
                            type="button"
                            className={`ntn-searchhit${index === active ? " is-active" : ""}`}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => {
                                onNavigate(hit.id);
                                onClose();
                            }}
                        >
                            <span className="ntn-searchhit__icon">
                                {hit.icon?.type === "emoji" ? hit.icon.value : <FileText size={15} />}
                            </span>
                            <span className="ntn-searchhit__text">
                                <span className="ntn-searchhit__title">
                                    {hit.title || "Untitled"}
                                </span>
                                {hit.breadcrumb.length > 0 && (
                                    <span className="ntn-searchhit__crumb">
                                        {hit.breadcrumb.join(" / ")}
                                    </span>
                                )}
                                {hit.snippet && (
                                    <span className="ntn-searchhit__snippet">{hit.snippet}</span>
                                )}
                            </span>
                        </button>
                    ))}
                    {results.length === 0 && !loading && (
                        <div className="ntn-menu__empty">No pages found.</div>
                    )}
                </div>

                <div className="ntn-dialog__footer">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd>
                    <span>to navigate</span>
                    <kbd>↵</kbd>
                    <span>to open</span>
                    <kbd>esc</kbd>
                    <span>to close</span>
                </div>
            </div>
        </div>
    );
}
