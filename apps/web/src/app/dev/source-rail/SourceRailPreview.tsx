"use client";

import { useEffect, useMemo, useState } from "react";
import { ConfirmActionDialog } from "~/app/employer/documents/_workspace/ConfirmActionDialog";
import { DeleteFolderDialog } from "~/app/employer/documents/_workspace/DeleteFolderDialog";
import {
    FolderDialog,
    type FolderDialogRequest,
} from "~/app/employer/documents/_workspace/FolderDialog";
import { RenameSourceDialog } from "~/app/employer/documents/_workspace/RenameSourceDialog";
import { SourceRail } from "~/app/employer/documents/_workspace/SourceRail";
import type { WorkspaceFolder, WorkspaceSource } from "~/app/employer/documents/_workspace/types";
import type { HistoryEntry } from "~/lib/workspace-history";
import {
    UNFILED_FOLDER,
    expandFolderPaths,
    folderLeafName,
    folderParentPath,
    isFolderDescendant,
    isFolderOrDescendant,
    joinFolderPath,
    replaceFolderPrefix,
} from "~/lib/folders/path";

function src(id: string, title: string, folder: string, added: string): WorkspaceSource {
    return {
        id,
        documentId: Number(id.slice(1)),
        title,
        type: "doc",
        size: "",
        added,
        folder,
        tags: [],
        domain: "General",
    };
}

const FIXTURE_SOURCES: WorkspaceSource[] = [
    src("d1", "Globex MSA 2026.pdf", "Contracts/2026", "2h ago"),
    src("d2", "Initech SOW.docx", "Contracts/2026", "yesterday"),
    src("d3", "NDA template.docx", "Contracts", "last week"),
    src("d4", "PickBot v3 field spec.docx", "Engineering/Specs", "3 days ago"),
    src("d5", "Employee handbook.pdf", "HR", "2 weeks ago"),
    src(
        "d6",
        "Claude Code (global) — projects/-Users-aurea-Pensieve-new-frontend/memory/reference_design_bundles.md",
        "Unfiled",
        "just now"
    ),
];

const FIXTURE_FOLDER_PATHS = ["Contracts/Archive", "Engineering/Specs", "HR"];

/** Minutes ago, as the feed's ISO timestamp. */
function ago(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * A history fixture that covers every row state the rail can draw: a chat, a
 * run mid-flight, a failed run, a run with no surface to open, and enough
 * spread in time to produce more than one date heading.
 */
const FIXTURE_HISTORY: HistoryEntry[] = [
    {
        id: "chat:s1",
        kind: "chat",
        refId: "s1",
        title: "What is the indemnity cap in the Globex MSA, and does it survive termination?",
        status: "done",
        at: ago(12),
        href: "/employer/documents?session=s1",
        messageCount: 6,
    },
    {
        id: "distribution:r1",
        kind: "distribution",
        refId: "r1",
        title: "Q3 channel partners",
        subtitle: "Partner discovery",
        status: "running",
        at: ago(35),
        href: "/employer/tools/distribution",
    },
    {
        id: "repo-explainer:j1",
        kind: "repo-explainer",
        refId: "j1",
        title: "acme/web — architecture",
        subtitle: "Explain the ingestion path end to end",
        status: "done",
        at: ago(60 * 5),
        href: "/employer/tools/repo-explainer",
    },
    {
        id: "trend-search:t1",
        kind: "trend-search",
        refId: "t1",
        title: "AI tooling adoption in mid-market fintech",
        subtitle: "Trend search",
        status: "failed",
        at: ago(60 * 26),
    },
    {
        id: "chat:s2",
        kind: "chat",
        refId: "s2",
        title: "Summarise the handbook's leave policy",
        status: "done",
        at: ago(60 * 30),
        href: "/employer/documents?session=s2",
        messageCount: 2,
    },
    {
        id: "email:c1",
        kind: "email",
        refId: "c1",
        title: "Renewal nudge — March cohort",
        subtitle: "Bring lapsed trials back with a case study",
        status: "queued",
        at: ago(60 * 24 * 9),
        href: "/employer/tools/email-pipeline",
    },
];

/**
 * Local harness for the source rail: nested folders, folder drag-and-drop,
 * the folder menu, and the folder dialogs, all against in-memory state so the
 * whole flow can be exercised without a session. Gated by the server page.
 */
export function SourceRailPreview() {
    const [sources, setSources] = useState(FIXTURE_SOURCES);
    const [folderPaths, setFolderPaths] = useState<string[]>(FIXTURE_FOLDER_PATHS);
    const [selected, setSelected] = useState<string[]>([]);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [renameSource, setRenameSource] = useState<WorkspaceSource | null>(null);
    const [deleteSource, setDeleteSource] = useState<WorkspaceSource | null>(null);
    const [folderDialog, setFolderDialog] = useState<FolderDialogRequest | null>(null);
    const [deleteFolderPath, setDeleteFolderPath] = useState<string | null>(null);
    const [opened, setOpened] = useState<string | null>(null);
    const [entries, setEntries] = useState<HistoryEntry[]>(FIXTURE_HISTORY);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

    const folders = useMemo<WorkspaceFolder[]>(
        () =>
            expandFolderPaths([...folderPaths, ...sources.map(s => s.folder)]).map(name => ({
                id: `f-${name}`,
                name,
                color: "oklch(0.6 0.17 285)",
            })),
        [folderPaths, sources]
    );
    const allPaths = useMemo(() => folders.map(f => f.name), [folders]);

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

    const renameFolder = (path: string, newPath: string) => {
        if (allPaths.includes(newPath))
            return `A folder named "${folderLeafName(newPath)}" already exists there.`;
        setFolderPaths(prev =>
            expandFolderPaths([...prev.map(p => replaceFolderPrefix(p, path, newPath)), newPath])
        );
        setSources(prev =>
            prev.map(s => ({ ...s, folder: replaceFolderPrefix(s.folder, path, newPath) }))
        );
        if (activeFolder && isFolderOrDescendant(activeFolder, path)) {
            setActiveFolder(replaceFolderPrefix(activeFolder, path, newPath));
        }
        setOpened(`rename-folder:${path}→${newPath}`);
        return null;
    };

    const deleteCounts = deleteFolderPath
        ? {
              documents: sources.filter(s => isFolderOrDescendant(s.folder, deleteFolderPath))
                  .length,
              subfolders: allPaths.filter(p => isFolderDescendant(p, deleteFolderPath)).length,
          }
        : { documents: 0, subfolders: 0 };

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
                onNewFolder={parent =>
                    setFolderDialog({ mode: "create", parentPath: parent ?? null })
                }
                onRenameFolder={folder => setFolderDialog({ mode: "rename", path: folder.name })}
                onMoveFolder={(path, target) => {
                    const failure = renameFolder(
                        path,
                        joinFolderPath(target, folderLeafName(path))
                    );
                    if (failure) setOpened(`error:${failure}`);
                }}
                onDeleteFolder={folder => setDeleteFolderPath(folder.name)}
                onMoveToFolder={(id, name) => {
                    setSources(prev =>
                        prev.map(source =>
                            source.id === id ? { ...source, folder: name } : source
                        )
                    );
                    setOpened(`move:${id}→${name}`);
                }}
                onRenameSource={setRenameSource}
                onDeleteSource={setDeleteSource}
                activeFolder={activeFolder}
                setActiveFolder={setActiveFolder}
                activeTag={activeTag}
                setActiveTag={setActiveTag}
                history={{
                    entries,
                    loading: false,
                    error: null,
                    degraded: [],
                    activeSessionId,
                    onNewChat: () => {
                        setActiveSessionId(null);
                        setOpened("new-chat");
                    },
                    onResumeSession: id => {
                        setActiveSessionId(id);
                        setOpened(`resume-session:${id}`);
                    },
                    onOpenRun: entry => setOpened(`open-run:${entry.id}`),
                    onRenameSession: (id, title) => {
                        setEntries(prev =>
                            prev.map(entry =>
                                entry.refId === id && entry.kind === "chat"
                                    ? { ...entry, title }
                                    : entry
                            )
                        );
                        setOpened(`rename-session:${id}`);
                    },
                    onDeleteSession: id => {
                        setEntries(prev =>
                            prev.filter(entry => !(entry.kind === "chat" && entry.refId === id))
                        );
                        setOpened(`delete-session:${id}`);
                    },
                    onRefresh: () => setOpened("refresh-history"),
                }}
            />
            {opened && (
                <div
                    data-testid="preview-last-action"
                    className="bg-panel border-line fixed bottom-4 right-4 max-w-[360px] rounded-lg border px-3 py-2 text-xs"
                >
                    {opened}
                </div>
            )}
            <FolderDialog
                request={folderDialog}
                existingPaths={allPaths}
                onSubmit={async path => {
                    if (folderDialog?.mode === "rename")
                        return renameFolder(folderDialog.path, path);
                    setFolderPaths(prev => expandFolderPaths([...prev, path]));
                    setOpened(`create-folder:${path}`);
                    return null;
                }}
                onClose={() => setFolderDialog(null)}
            />
            <DeleteFolderDialog
                path={deleteFolderPath}
                documentCount={deleteCounts.documents}
                subfolderCount={deleteCounts.subfolders}
                onConfirm={async path => {
                    const destination = folderParentPath(path) ?? UNFILED_FOLDER;
                    setSources(prev =>
                        prev.map(s =>
                            isFolderOrDescendant(s.folder, path) ? { ...s, folder: destination } : s
                        )
                    );
                    setFolderPaths(prev => prev.filter(p => !isFolderOrDescendant(p, path)));
                    if (activeFolder && isFolderOrDescendant(activeFolder, path))
                        setActiveFolder(null);
                    setOpened(`delete-folder:${path}→${destination}`);
                    return null;
                }}
                onClose={() => setDeleteFolderPath(null)}
            />
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
