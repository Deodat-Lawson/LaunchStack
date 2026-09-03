"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmActionDialog } from "~/app/employer/documents/_workspace/ConfirmActionDialog";
import { RenameSourceDialog } from "~/app/employer/documents/_workspace/RenameSourceDialog";
import { SourceRail } from "~/app/employer/documents/_workspace/SourceRail";
import type { WorkspaceFolder, WorkspaceSource } from "~/app/employer/documents/_workspace/types";

const FIXTURE_SOURCES: WorkspaceSource[] = [
    {
        id: "d1",
        documentId: 1,
        title: "Claude Code (global) — projects/-Users-aurea-Pensieve-new-frontend/memory/reference_design_bundles.md",
        type: "doc",
        size: "",
        added: "2h ago",
        folder: "Launchstack Future Plans 2",
        tags: ["memory"],
        domain: "Technical",
    },
    {
        id: "d2",
        documentId: 2,
        title: "Claude Code (global) — projects/-Users-aurea-AI-coworker/memory/feedback_parallel_worktree_scopes.md",
        type: "doc",
        size: "",
        added: "Yesterday",
        folder: "Launchstack Future Plans 2",
        tags: ["memory"],
        domain: "Technical",
    },
];

const FIXTURE_FOLDERS: WorkspaceFolder[] = [
    { id: "cat-1", name: "Launchstack Future Plans 2", color: "oklch(0.6 0.17 285)" },
    { id: "cat-2", name: "Unfiled", color: "oklch(0.5 0.02 280)" },
];

/**
 * Local harness for the source-rail context menu. Production auth is skipped so
 * the menu can be exercised without a session. Gated by the server page.
 */
export function SourceRailPreview() {
    const [sources, setSources] = useState(FIXTURE_SOURCES);
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [renameSource, setRenameSource] = useState<WorkspaceSource | null>(null);
    const [deleteSource, setDeleteSource] = useState<WorkspaceSource | null>(null);
    const [opened, setOpened] = useState<string | null>(null);

    const folders = useMemo(() => FIXTURE_FOLDERS, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (new URLSearchParams(window.location.search).get("openMenu") !== "1") return;
        const timer = window.setTimeout(() => {
            const row = document.querySelector("[data-testid='source-row-d1']");
            row?.dispatchEvent(
                new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    clientX: 120,
                    clientY: 220,
                })
            );
        }, 50);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <div
            style={{
                height: "100vh",
                background: "var(--bg)",
                color: "var(--ink)",
            }}
        >
            <SourceRail
                sources={sources}
                folders={folders}
                selected={selected}
                setSelected={setSelected}
                onOpenAdd={() => setOpened("add")}
                onOpenSource={source => setOpened(`open:${source.title}`)}
                onNewFolder={() => setOpened("new-folder")}
                onRenameFolder={folder => setOpened(`rename-folder:${folder.name}`)}
                onMoveToFolder={(id, name) => {
                    setSources(prev =>
                        prev.map(source =>
                            source.id === id ? { ...source, folder: name } : source
                        )
                    );
                }}
                onRenameSource={setRenameSource}
                onDeleteSource={setDeleteSource}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
            />
            {opened && (
                <div
                    data-testid="preview-last-action"
                    style={{
                        position: "fixed",
                        right: 16,
                        bottom: 16,
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        fontSize: 12,
                        maxWidth: 360,
                    }}
                >
                    {opened}
                </div>
            )}
            <RenameSourceDialog
                open={!!renameSource}
                source={renameSource}
                onClose={() => setRenameSource(null)}
                onRename={async (renamed, title) => {
                    setSources(prev =>
                        prev.map(source =>
                            source.id === renamed.id ? { ...source, title } : source
                        )
                    );
                    return true;
                }}
            />
            <ConfirmActionDialog
                open={!!deleteSource}
                title="Delete this source?"
                body={
                    deleteSource
                        ? `"${deleteSource.title}" will be removed from this workspace. This cannot be undone.`
                        : ""
                }
                confirmLabel="Delete"
                onConfirm={() => {
                    if (!deleteSource) return;
                    setSources(prev => prev.filter(source => source.id !== deleteSource.id));
                    setDeleteSource(null);
                }}
                onClose={() => setDeleteSource(null)}
            />
        </div>
    );
}
