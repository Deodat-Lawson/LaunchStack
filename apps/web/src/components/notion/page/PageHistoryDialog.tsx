"use client";

/**
 * Page history: snapshots on the right, the selected one rendered read-only on
 * the left, and a Restore button. Notion's layout, minus the paid retention
 * tiers.
 */

import { Clock, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { RenderDoc } from "../lib/render";
import type { WorkspaceVersionDto } from "~/types/workspace";

export function PageHistoryDialog({
    pageId,
    open,
    onClose,
    onRestored,
}: {
    pageId: string;
    open: boolean;
    onClose: () => void;
    onRestored: () => void;
}) {
    const [versions, setVersions] = useState<WorkspaceVersionDto[]>([]);
    const [selected, setSelected] = useState<WorkspaceVersionDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/workspace/pages/${pageId}/versions`);
            if (!response.ok) return;
            const data = (await response.json()) as { versions: WorkspaceVersionDto[] };
            setVersions(data.versions);
            // Preselect the newest so the panel is never blank on open.
            if (data.versions[0]) await select(data.versions[0].id);
        } finally {
            setLoading(false);
        }
        // `select` is stable for a given pageId, and listing it would recreate
        // this callback on every selection.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageId]);

    const select = useCallback(
        async (versionId: number) => {
            const response = await fetch(
                `/api/workspace/pages/${pageId}/versions/${versionId}`
            );
            if (!response.ok) return;
            const data = (await response.json()) as { version: WorkspaceVersionDto };
            setSelected(data.version);
        },
        [pageId]
    );

    useEffect(() => {
        if (open) void load();
        else setSelected(null);
    }, [open, load]);

    const restore = async () => {
        if (!selected) return;
        setRestoring(true);
        try {
            const response = await fetch(
                `/api/workspace/pages/${pageId}/versions/${selected.id}`,
                { method: "POST" }
            );
            if (response.ok) {
                onRestored();
                onClose();
            }
        } finally {
            setRestoring(false);
        }
    };

    if (!open) return null;

    return (
        <div className="ntn-overlay" onMouseDown={onClose} role="presentation">
            <div
                className="ntn-dialog ntn-dialog--history"
                onMouseDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-label="Page history"
            >
                <div className="ntn-dialog__main">
                    <header className="ntn-dialog__header">
                        <h2>
                            {selected
                                ? new Date(selected.createdAt).toLocaleString()
                                : "Page history"}
                        </h2>
                        <button type="button" onClick={onClose}>
                            <X size={16} />
                        </button>
                    </header>
                    <div className="ntn-dialog__preview">
                        {loading ? (
                            <div className="ntn-dialog__loading">
                                <Loader2 size={16} className="ntn-spin" /> Loading…
                            </div>
                        ) : selected ? (
                            <>
                                <h1 className="ntn-title ntn-title--static">
                                    {selected.title?.trim() ? selected.title : "Untitled"}
                                </h1>
                                <RenderDoc doc={selected.content} className="ntn-prose" />
                            </>
                        ) : (
                            <div className="ntn-dialog__loading">
                                No snapshots yet. Snapshots are taken as you edit.
                            </div>
                        )}
                    </div>
                </div>

                <aside className="ntn-dialog__side">
                    <div className="ntn-dialog__side-head">
                        <Clock size={13} /> <span>Versions</span>
                    </div>
                    <div className="ntn-dialog__versions">
                        {versions.map((version) => (
                            <button
                                key={version.id}
                                type="button"
                                className={`ntn-version${
                                    selected?.id === version.id ? " is-active" : ""
                                }`}
                                onClick={() => void select(version.id)}
                            >
                                <span className="ntn-version__time">
                                    {new Date(version.createdAt).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                    })}
                                </span>
                                {version.label && (
                                    <span className="ntn-version__label">{version.label}</span>
                                )}
                            </button>
                        ))}
                        {versions.length === 0 && !loading && (
                            <div className="ntn-dialog__loading">No versions yet.</div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="ntn-btn ntn-btn--primary ntn-btn--block"
                        disabled={!selected || restoring}
                        onClick={() => void restore()}
                    >
                        <RotateCcw size={13} /> Restore this version
                    </button>
                </aside>
            </div>
        </div>
    );
}
