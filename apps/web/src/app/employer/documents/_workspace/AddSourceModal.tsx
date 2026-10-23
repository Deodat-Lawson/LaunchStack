"use client";

import { useSettingValue } from "~/lib/settings/useSettings";
import React, { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { folderLeafName, isUnfiledFolder } from "~/lib/folders/path";
import { useRouter } from "next/navigation";
import {
    Zap as IconBolt,
    Check as IconCheck,
    Folder as IconFolder,
    Loader2,
    X as IconX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { AddDestinationBar } from "./AddDestinationBar";
import { destinationLabel, planFolderUpload, type AudienceSummary } from "./addDestination";
import { ADD_TABS, SOURCE_META, type AddSourceTab, type ItemAccessView } from "./types";
import { DriveConnectPanel } from "./DriveConnectPanel";
import type { FolderAccessState } from "./driveStatus";
import { GmailConnectPanel } from "./GmailConnectPanel";
import { NotionConnectPanel } from "./NotionConnectPanel";
import { ObsidianImportPanel } from "./ObsidianImportPanel";
import { registerDocument, uploadFileToStorage } from "./sourceUpload";
import { DOCUMENT_LIMITS } from "~/lib/constants";
import { detectSourceType } from "@launchstack/conversion/types";
import { ArtifactImportPanel } from "./ArtifactImportPanel";
// Metadata only: the Create panel posts a `templateId` and the Mindmap editor
// builds the document on open, so the shape library never enters this bundle.
import dynamic from "next/dynamic";

/**
 * Real miniatures of each template, so a person picks by recognising the
 * diagram rather than decoding an emoji. Loaded only when this tab opens: the
 * thumbnail builds the template, which drags the shape library and layout
 * engine along — see template-meta.ts on why the list itself stays light.
 */
const TemplateThumbnail = dynamic(
    () =>
        import("~/app/employer/documents/_mindmap/ui/TemplateThumbnail").then(
            m => m.TemplateThumbnail
        ),
    { ssr: false, loading: () => null }
);

// Only the Coding sessions tab needs it, and it is a list app of its own.
const SessionsBrowser = dynamic(
    () =>
        import("~/app/employer/agent-sessions/_sessions/ui/SessionsBrowser").then(
            m => m.SessionsBrowser
        ),
    { ssr: false, loading: () => null }
);

import { TEMPLATE_META } from "~/app/employer/documents/_mindmap/model/template-meta";
import type { IconProps } from "~/components/icons/types";

/**
 * AddSourceModal — tabbed create/upload/connect modal matching the Launstack
 * design handoff (`modal.jsx`). Sidebar lists Create + Upload + Connect tabs;
 * the right panel hosts the active tab. Above every tab's content sits the
 * destination bar (`AddDestinationBar`): the folder it goes to and who will
 * be able to open it, so neither is a surprise after the upload. Tabs that
 * always file in one place (Drive, Coding sessions, Gmail) show that place;
 * connectors that add nothing to a folder show no bar.
 *
 * Backend integration is kept unchanged:
 *   - Files / Audio / Video: `/api/storage/upload` → `/api/uploadDocument`
 *   - Folder: same as above, fanned out across the picked files
 *   - Paste: wraps the text in a `.md` File and runs the file path
 *   - URL: `/api/upload/website`
 *   - YouTube: `/api/upload/video-url`
 *   - Mindmap: `/api/mindmaps` → the workspace opens the new map's editor in
 *     place; it is a source from the moment it exists and citable once
 *     published.
 *   - Google Doc: `/api/google-docs` → creates a native Doc in the workspace's
 *     Drive and opens it in a new tab; the source exists here immediately and
 *     the Drive reconciler folds later edits back in. The tab is hidden unless
 *     `/api/connectors/google` reports the feature enabled.
 *   - Connectors: Drive/Slack/GitHub/Notion start the workspace OAuth flow at
 *     `/api/connectors/<provider>/oauth/start`. Notion has its own panel
 *     (NotionConnectPanel): the pages picked on Notion's consent screen sync
 *     into `Notion/<workspace>`. Gmail has its own panel
 *     (GmailConnectPanel): the connection is the member's own, started at
 *     `/api/connectors/google/oauth/start?provider=gmail`, and its mail lands
 *     in a folder only they can see. Dropbox remains a coming-soon CTA.
 *   - Obsidian: ObsidianImportPanel reads a vault (folder or .zip) in the
 *     browser and posts its notes to `/api/connectors/obsidian/import`; they
 *     land in `Obsidian/<vault>`, private to the importer.
 */

export interface AddSourceModalProps {
    open: boolean;
    onClose: () => void;
    userId: string | null;
    /** Folder to pre-select as the destination (e.g. the rail's active folder). */
    defaultCategory: string;
    /** Folders the caller can add to — the destination picker's list. */
    folders: string[];
    /**
     * Every folder the caller can see, to tell an existing folder from one an
     * upload would create (a new top-level folder is private to its creator).
     * Defaults to `folders`.
     */
    knownFolders?: string[];
    /** The caller's access to each folder, keyed by normalized path — who will see what lands there. */
    folderAccess?: Readonly<Record<string, ItemAccessView>>;
    /** "Everyone at <name>" — until the folder's own answer arrives. */
    workspaceName?: string | null;
    /** Open the Share dialog for a folder; offered to people who manage it. */
    onShareFolder?: (path: string) => void;
    /** Bump after sharing changes so the destination bar reads the audience again. */
    accessVersion?: number;
    /** Called after any successful ingest so the workspace can refresh its list. */
    onUploaded: () => void;
    /** Create a folder; may resolve to the path it really got ("Name (2)"). */
    onCreateFolder?: (name: string) => void | Promise<string | null | void>;
    /**
     * Tab to open on. Set when the caller already knows what the user picked —
     * the Knowledge pane's connector strip opens straight onto Slack or Drive
     * rather than dropping them on Files first.
     */
    initialTab?: string;
    /** Prefill for the URL tab — "paste to create a source" with a link on the clipboard. */
    initialUrl?: string;
    /** Prefill for the Paste tab — the clipboard's text. */
    initialText?: string;
    /**
     * A mindmap was created. The workspace opens it in place; without a
     * handler the panel navigates to the workspace itself.
     */
    onMindmapCreated?: (mindmapId: number) => void;
    /**
     * What the Coding sessions tab does with a session once it is a source:
     * refresh the library after an import, open one, or continue it in chat.
     * Without these the browser falls back to navigating.
     */
    sessions?: {
        onImported: () => Promise<void>;
        onOpenDocument: (documentId: number) => void;
        onContinue: (documentId: number) => void;
    };
}

/** Shape of GET /api/connectors/google — gates the Create → Google Doc tab. */
interface GoogleConnectionStatus {
    enabled: boolean;
    connected: boolean;
    accountEmail?: string | null;
    connectUrl?: string;
}

/** Which half of a file's trip is running: the bytes, or registering it (which transcribes a recording). */
type UploadPhase = "uploading" | "processing";

async function uploadAndRegisterAll(params: {
    files: File[];
    category: string;
    onProgress?: (completed: number, total: number) => void;
    onPhase?: (file: File, phase: UploadPhase) => void;
}): Promise<{ successes: number; errors: string[] }> {
    let successes = 0;
    const errors: string[] = [];
    for (let i = 0; i < params.files.length; i++) {
        const file = params.files[i]!;
        try {
            params.onPhase?.(file, "uploading");
            const up = await uploadFileToStorage(file);
            params.onPhase?.(file, "processing");
            await registerDocument({
                file,
                url: up.url,
                provider: up.provider,
                category: params.category,
            });
            successes++;
        } catch (err) {
            errors.push(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
        }
        params.onProgress?.(i + 1, params.files.length);
    }
    return { successes, errors };
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** " to Q4 planning / Pricing", or " (no folder)" — the end of a "done" toast. */
function whereTo(category: string): string {
    return isUnfiledFolder(category) ? " (no folder)" : ` to ${destinationLabel(category)}`;
}

function extOf(filename: string): string {
    const i = filename.lastIndexOf(".");
    return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function extColor(ext: string): string {
    const map: Record<string, string> = {
        pdf: "oklch(0.55 0.17 25)",
        pptx: "oklch(0.6 0.15 40)",
        ppt: "oklch(0.6 0.15 40)",
        xlsx: "oklch(0.55 0.15 150)",
        xls: "oklch(0.55 0.15 150)",
        csv: "oklch(0.55 0.15 150)",
        docx: "oklch(0.55 0.14 250)",
        doc: "oklch(0.55 0.14 250)",
        md: "oklch(0.5 0.02 280)",
        txt: "oklch(0.5 0.02 280)",
    };
    return map[ext] ?? "var(--ink-3)";
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

/** Tabs that add to the folder the person picks — the destination bar offers the picker. */
const PICKS_FOLDER = new Set([
    "mindmap",
    "google-doc",
    "paste",
    "files",
    "folder",
    "audio",
    "video",
    "url",
    "youtube",
    "artifact",
]);

/** Connectors that file everything in one folder of their own. */
const FIXED_DESTINATIONS: Record<string, string> = {
    drive: "Google Drive",
    // The connector files every session here (AGENT_SESSIONS_CATEGORY).
    "agent-sessions": "Agent Sessions",
};

/**
 * A picked Drive folder doesn't land in "Google Drive" (server/…/google-drive/
 * destinations.ts) — shown only while folder import actually works, since a
 * drive.file-only connection imports nothing from a folder.
 */
const DRIVE_FOLDER_NOTE =
    "Files you pick one by one go here. A folder you import becomes a folder of its own, visible only to you until you share it.";

/** Gmail's folder is per mailbox and its owner's alone (ADR-014). */
const GMAIL_AUDIENCE: AudienceSummary = {
    tone: "private",
    headline: "Only you",
    detail: "Mail lands in your own Gmail folder. Nobody else in the workspace can open it.",
};

/** The sync files each connected workspace in `Notion/<workspace>`, created private to whoever connected it. */
const NOTION_AUDIENCE: AudienceSummary = {
    tone: "private",
    headline: "Only you, until you share it",
    detail: "Each Notion workspace you connect gets its own folder under Notion, private to you. Share it when the team should see those pages.",
};

const OBSIDIAN_AUDIENCE: AudienceSummary = {
    tone: "private",
    headline: "Only you",
    detail: "Each vault lands in its own folder under Obsidian. Nobody else can open it until you share it.",
};

export function AddSourceModal({
    open,
    onClose,
    userId,
    defaultCategory,
    folders,
    knownFolders,
    folderAccess = NO_ACCESS,
    workspaceName = null,
    onShareFolder,
    accessVersion = 0,
    onUploaded,
    onCreateFolder,
    initialTab,
    initialUrl,
    initialText,
    onMindmapCreated,
    sessions,
}: AddSourceModalProps) {
    const [tab, setTab] = useState<string>(initialTab ?? "files");
    const [folder, setFolder] = useState<string>(defaultCategory || "Unfiled");
    /** The Folder tab's new folder, made inside `folder`; null until one is picked. */
    const [folderChild, setFolderChild] = useState<string | null>(null);
    const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus | null>(null);
    const [driveFolderAccess, setDriveFolderAccess] = useState<FolderAccessState | null>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const known = useMemo(() => knownFolders ?? folders, [knownFolders, folders]);
    // Settings → Document defaults: open on Google Doc when Drive linking is
    // on and the workspace asked for it — only when the caller named no tab.
    const preferGoogleDoc = useSettingValue<boolean>("documents.createNativeGoogleDoc");
    useEffect(() => {
        if (!open || initialTab || !preferGoogleDoc || !googleStatus?.enabled) return;
        setTab(current => (current === "files" ? "google-doc" : current));
    }, [open, initialTab, preferGoogleDoc, googleStatus?.enabled]);

    useEffect(() => {
        if (!open) return;
        setFolder(defaultCategory || "Unfiled");
        setTab(initialTab ?? "files");
    }, [open, defaultCategory, initialTab]);

    useEffect(() => {
        if (!open) return;
        const onEsc = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            // Escape in something layered over this dialog — the folder
            // picker, the Share dialog — closes that, not this.
            const focused = document.activeElement;
            if (focused && focused !== document.body && !shellRef.current?.contains(focused)) {
                return;
            }
            onClose();
        };
        window.addEventListener("keydown", onEsc);
        return () => window.removeEventListener("keydown", onEsc);
    }, [open, onClose]);

    // Drive-linked files are dark by default. Rather than show a permanently
    // greyed tab on every deployment that has not enabled them, ask once per
    // opening and leave the tab out until we know it is available.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/connectors/google");
                if (!res.ok) return;
                const body = (await res.json()) as GoogleConnectionStatus;
                if (!cancelled) setGoogleStatus(body);
            } catch {
                // Leave it unknown; the tab stays hidden.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open]);

    if (!open) return null;

    const groups = googleStatus?.enabled
        ? ADD_TABS
        : ADD_TABS.map(g => ({ ...g, items: g.items.filter(i => i.id !== "google-doc") }));
    const allTabs: AddSourceTab[] = groups.flatMap(g => g.items);
    const active = allTabs.find(t => t.id === tab) ?? allTabs[0]!;

    const handleUploaded = () => {
        onUploaded();
        onClose();
    };

    let panel: React.ReactNode = null;
    if (tab === "mindmap") {
        panel = <MindmapPanel folder={folder} onCreated={onMindmapCreated} />;
    } else if (tab === "google-doc") {
        panel = <GoogleDocPanel folder={folder} status={googleStatus} onCreated={handleUploaded} />;
    } else if (tab === "files") {
        panel = (
            <FilesPanel
                kind="files"
                userId={userId}
                category={folder}
                onUploaded={handleUploaded}
            />
        );
    } else if (tab === "folder") {
        panel = (
            <FolderPanel
                userId={userId}
                destination={folder}
                onNameChange={setFolderChild}
                onUploaded={handleUploaded}
            />
        );
    } else if (tab === "audio" || tab === "video") {
        panel = (
            <FilesPanel kind={tab} userId={userId} category={folder} onUploaded={handleUploaded} />
        );
    } else if (tab === "paste") {
        panel = (
            <PastePanel
                userId={userId}
                category={folder}
                onUploaded={handleUploaded}
                initialText={initialText}
            />
        );
    } else if (tab === "url") {
        panel = (
            <UrlPanel
                userId={userId}
                category={folder}
                onUploaded={handleUploaded}
                initialUrl={initialUrl}
            />
        );
    } else if (tab === "youtube") {
        panel = <YouTubePanel userId={userId} category={folder} onUploaded={handleUploaded} />;
    } else if (tab === "drive") {
        panel = <DriveConnectPanel tab={active} onFolderAccess={setDriveFolderAccess} />;
    } else if (tab === "gmail") {
        panel = <GmailConnectPanel tab={active} />;
    } else if (tab === "notion") {
        panel = <NotionConnectPanel tab={active} />;
    } else if (tab === "obsidian") {
        panel = <ObsidianImportPanel onImported={handleUploaded} />;
    } else if (tab === "artifact") {
        panel = (
            <ArtifactImportPanel userId={userId} category={folder} onUploaded={handleUploaded} />
        );
    } else if (tab === "agent-sessions") {
        // The whole browser, here: import, rescan, open, continue in chat.
        // Opening or continuing one leaves this dialog for the workspace.
        panel = (
            <SessionsBrowser
                embedded
                onImported={sessions?.onImported}
                onOpenDocument={
                    sessions
                        ? id => {
                              onClose();
                              sessions.onOpenDocument(id);
                          }
                        : undefined
                }
                onContinue={
                    sessions
                        ? id => {
                              onClose();
                              sessions.onContinue(id);
                          }
                        : undefined
                }
            />
        );
    } else {
        panel = <ConnectPanel tab={active} />;
    }

    // Where it goes and who will see it, before anything is added. Slack,
    // GitHub and Dropbox add nothing to a folder here, so no bar.
    const barProps = {
        folders,
        knownFolders: known,
        folderAccess,
        workspaceName,
        selfAuthId: userId,
        onShareFolder,
        accessVersion,
    };
    let destination: React.ReactNode = null;
    if (PICKS_FOLDER.has(active.id)) {
        destination = (
            <AddDestinationBar
                mode="pick"
                value={folder}
                onChange={setFolder}
                onCreate={onCreateFolder}
                pendingChild={active.id === "folder" ? folderChild : null}
                audienceNote={
                    active.id === "mindmap"
                        ? "This applies to the published copy, the one the workspace can cite."
                        : undefined
                }
                {...barProps}
            />
        );
    } else if (FIXED_DESTINATIONS[active.id]) {
        destination = (
            <AddDestinationBar
                mode="fixed"
                value={FIXED_DESTINATIONS[active.id]!}
                audienceNote={
                    active.id === "drive" && driveFolderAccess === "ready"
                        ? DRIVE_FOLDER_NOTE
                        : undefined
                }
                {...barProps}
            />
        );
    } else if (active.id === "gmail") {
        destination = (
            <AddDestinationBar
                mode="fixed"
                value="Gmail/your mailbox"
                fixedAudience={GMAIL_AUDIENCE}
                {...barProps}
            />
        );
    } else if (active.id === "notion") {
        destination = (
            <AddDestinationBar
                mode="fixed"
                value="Notion/your workspace"
                fixedAudience={NOTION_AUDIENCE}
                {...barProps}
            />
        );
    } else if (active.id === "obsidian") {
        destination = (
            <AddDestinationBar
                mode="fixed"
                value="Obsidian/your vault"
                fixedAudience={OBSIDIAN_AUDIENCE}
                {...barProps}
            />
        );
    }

    return (
        // Not the kit Dialog on purpose: Drive's tab opens Google's Picker, an
        // iframe Google appends to <body>, and a Radix modal would make it
        // unclickable (pointer-events: none outside the content) and pull
        // focus back out of it.
        <div
            onClick={onClose}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--scrim)] p-6 backdrop-blur-[6px] [animation:lsw-fadeIn_160ms_ease-out] max-sm:p-2"
        >
            <div
                ref={shellRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-source-title"
                aria-describedby="add-source-desc"
                onClick={e => e.stopPropagation()}
                className={cn(
                    "bg-panel flex max-h-[86vh] max-w-[92vw] overflow-hidden rounded-2xl shadow-[0_30px_80px_var(--scrim-shadow),0_0_0_1px_var(--line)] [animation:lsw-modalIn_180ms_ease-out] max-sm:max-w-full",
                    // The sessions browser is a list with filters, not a form;
                    // at the form width its rows truncated to nothing.
                    active.id === "agent-sessions" ? "w-[1040px]" : "w-[780px]"
                )}
                data-testid="add-source-dialog"
            >
                {/* Sidebar */}
                <nav
                    aria-label="Ways to add"
                    className="border-line bg-line-2 flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r px-3 py-[18px] max-sm:w-[132px] max-sm:px-1.5"
                >
                    <h2 id="add-source-title" className="text-ink px-2 text-[15px] font-bold">
                        Add a source
                    </h2>
                    {groups.map(g => (
                        <div key={g.group}>
                            <div className="mono text-ink-3 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                                {g.group}
                            </div>
                            <div className="flex flex-col gap-px">
                                {g.items.map(item => {
                                    const isActive = active.id === item.id;
                                    const Icon = item.Icon;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setTab(item.id)}
                                            aria-current={isActive ? "page" : undefined}
                                            className={cn(
                                                "flex items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-left text-[13px]",
                                                isActive
                                                    ? "bg-brand-soft text-brand-ink font-semibold"
                                                    : "text-ink-2 hover:bg-panel font-medium"
                                            )}
                                        >
                                            <Icon size={14} />
                                            {item.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
                {/* Panel */}
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-[26px] py-[22px] max-sm:px-3 max-sm:py-4">
                    <div className="mb-3.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-ink text-lg font-bold">{active.label}</div>
                            <p id="add-source-desc" className="text-ink-3 mt-0.5 text-[13px]">
                                {active.desc}
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="text-ink-3 size-8 shrink-0"
                            aria-label="Close"
                            title="Close"
                        >
                            <IconX size={16} />
                        </Button>
                    </div>
                    {destination && <div className="mb-4 shrink-0">{destination}</div>}
                    <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
                </div>
            </div>
        </div>
    );
}

const NO_ACCESS: Readonly<Record<string, ItemAccessView>> = {};

// ---------------------------------------------------------------------------
// Create → Mindmap
// ---------------------------------------------------------------------------

/**
 * Creating a mindmap does not ingest anything: it makes the row and opens the
 * editor in place. Only the template id is posted — the editor owns the
 * template registry and builds the document on open, so a new template never
 * needs a server change.
 */
function MindmapPanel({
    folder,
    onCreated,
}: {
    folder: string;
    onCreated?: (mindmapId: number) => void;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState<string | null>(null);

    const create = async (templateId: string, title: string) => {
        setBusy(templateId);
        try {
            const res = await fetch("/api/mindmaps", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, templateId, folder }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const body = (await res.json()) as { mindmap: { id: number } };
            if (onCreated) onCreated(body.mindmap.id);
            else router.push(`/employer/documents?source=m${body.mindmap.id}&edit=1`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't create that mindmap");
            setBusy(null);
        }
    };

    return (
        <div>
            <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 14, lineHeight: 1.55 }}>
                Draw it here, then make it citable when it is ready.
            </p>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 8,
                }}
            >
                {TEMPLATE_META.map(template => {
                    const isBusy = busy === template.id;
                    return (
                        <button
                            key={template.id}
                            disabled={busy !== null}
                            onClick={() => {
                                void create(
                                    template.id,
                                    template.id === "blank" ? "Untitled mindmap" : template.name
                                );
                            }}
                            style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 10,
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid var(--line)",
                                background: isBusy ? "var(--accent-soft)" : "var(--panel)",
                                textAlign: "left",
                                cursor: busy !== null ? "wait" : "pointer",
                                opacity: busy !== null && !isBusy ? 0.55 : 1,
                            }}
                        >
                            <span
                                aria-hidden
                                style={{
                                    width: 64,
                                    height: 44,
                                    flex: "none",
                                    borderRadius: 6,
                                    overflow: "hidden",
                                    border: "1px solid var(--line)",
                                    background: "var(--panel-2)",
                                }}
                            >
                                <TemplateThumbnail templateId={template.id} />
                            </span>
                            <span style={{ minWidth: 0 }}>
                                <span
                                    style={{
                                        display: "block",
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: "var(--ink)",
                                    }}
                                >
                                    {template.name}
                                </span>
                                <span
                                    style={{
                                        display: "block",
                                        fontSize: 11.5,
                                        color: "var(--ink-3)",
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {isBusy ? "Opening the editor…" : template.description}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Create → Google Doc
// ---------------------------------------------------------------------------

/**
 * Creates a real Google Doc in the workspace's Drive and opens it in a new
 * tab. Unlike the Mindmap path, the source exists in LaunchStack immediately —
 * seeded with its title — and the Drive reconciler folds later edits back in
 * as new versions, so we stay put rather than navigating away.
 */
function GoogleDocPanel({
    folder,
    status,
    onCreated,
}: {
    folder: string;
    status: GoogleConnectionStatus | null;
    onCreated: () => void;
}) {
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);

    if (status && !status.connected) {
        return (
            <div>
                <p
                    style={{
                        fontSize: 13,
                        color: "var(--ink-3)",
                        marginBottom: 14,
                        lineHeight: 1.55,
                    }}
                >
                    Connect a Google account for this workspace and new documents will be created in
                    its Drive, in a <strong style={{ color: "var(--ink-2)" }}>LaunchStack</strong>{" "}
                    folder.
                </p>
                <Button
                    onClick={() => {
                        window.location.href =
                            status.connectUrl ?? "/api/connectors/google/oauth/start";
                    }}
                >
                    Connect Google
                </Button>
            </div>
        );
    }

    const create = async () => {
        // Open the tab synchronously so popup blockers allow it, then point it.
        const newTab = window.open("", "_blank");
        setBusy(true);
        try {
            const res = await fetch("/api/google-docs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: title.trim() || undefined, folder }),
            });
            const body = (await res.json()) as { url?: string | null; message?: string };
            if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
            if (body.url && newTab) newTab.location.href = body.url;
            else newTab?.close();
            toast.success("Created in Google Docs");
            onCreated();
        } catch (err) {
            newTab?.close();
            toast.error(err instanceof Error ? err.message : "Couldn't create that document");
            setBusy(false);
        }
    };

    return (
        <div>
            <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 14, lineHeight: 1.55 }}>
                Write it in Google Docs
                {status?.accountEmail ? ` as ${status.accountEmail}` : ""}. It shows up here right
                away, and edits sync back as new versions your workspace can cite.
            </p>

            <label
                style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--ink-2)",
                    marginBottom: 6,
                }}
            >
                Title
                <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Untitled document"
                    maxLength={200}
                    disabled={busy}
                    onKeyDown={e => {
                        if (e.key === "Enter" && !busy) void create();
                    }}
                    style={{
                        display: "block",
                        width: "100%",
                        marginTop: 6,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        color: "var(--ink)",
                        fontSize: 13,
                        fontWeight: 400,
                    }}
                />
            </label>

            <button
                disabled={busy}
                onClick={() => void create()}
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    width: "100%",
                    marginTop: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: busy ? "var(--accent-soft)" : "var(--panel)",
                    textAlign: "left",
                    cursor: busy ? "wait" : "pointer",
                }}
            >
                <span style={{ fontSize: 18, lineHeight: 1.2 }} aria-hidden>
                    📄
                </span>
                <span style={{ minWidth: 0 }}>
                    <span
                        style={{
                            display: "block",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--ink)",
                        }}
                    >
                        Blank document
                    </span>
                    <span
                        style={{
                            display: "block",
                            fontSize: 11.5,
                            color: "var(--ink-3)",
                            lineHeight: 1.4,
                        }}
                    >
                        {busy ? "Creating in Google Docs…" : "Opens in a new tab"}
                    </span>
                </span>
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Files / Audio / Video panel
// ---------------------------------------------------------------------------

interface FilesPanelProps {
    kind: "files" | "audio" | "video";
    userId: string | null;
    category: string;
    onUploaded: () => void;
}

/** The server's per-file cap (upload-local), checked before the bytes leave. */
const MAX_UPLOAD_BYTES = DOCUMENT_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;

const FILE_ACCEPT: Record<FilesPanelProps["kind"], string> = {
    files: "",
    // The formats ingestion transcribes (shouldTranscribeFile) — don't let the
    // picker offer ones that fail.
    audio: "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,audio/flac,audio/ogg,.mp3,.m4a,.wav,.aac,.flac,.ogg",
    // Ingestion only accepts MP4 — don't let the picker offer formats that fail.
    video: "video/mp4,.mp4",
};

const KIND_COPY: Record<
    FilesPanelProps["kind"],
    { title: string; hint: string; browse: string; IconEl: ComponentType<IconProps> }
> = {
    files: {
        title: "Drop files here",
        hint: `PDF, DOCX, XLSX, PPTX, images, code files — up to ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB} MB each`,
        browse: "Browse files",
        IconEl: SOURCE_META.doc.Icon,
    },
    audio: {
        title: "Drop audio files",
        hint: `MP3, M4A, WAV, AAC, FLAC, OGG up to ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB} MB — transcribed in the language spoken, playable in the viewer`,
        browse: "Browse audio",
        IconEl: SOURCE_META.audio.Icon,
    },
    video: {
        title: "Drop video files",
        hint: `MP4 up to ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB} MB — transcribed in the language spoken, playable in the viewer`,
        browse: "Browse video",
        IconEl: SOURCE_META.video.Icon,
    },
};

function FilesPanel({ kind, userId, category, onUploaded }: FilesPanelProps) {
    const [dragging, setDragging] = useState(false);
    const [staged, setStaged] = useState<File[]>([]);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [phase, setPhase] = useState<{ file: File; phase: UploadPhase } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const copy = KIND_COPY[kind];
    const IconEl = copy.IconEl;

    const addFiles = (incoming: FileList | File[] | null) => {
        if (!incoming) return;
        const arr = Array.from(incoming);
        if (arr.length === 0) return;
        // The server refuses anything over the limit only after the whole body
        // has crossed the network; say so before the wait, not after it.
        const tooBig = arr.filter(f => f.size > MAX_UPLOAD_BYTES);
        if (tooBig.length > 0) {
            toast.error(
                `${tooBig.length === 1 ? tooBig[0]!.name : `${tooBig.length} files`} ${tooBig.length === 1 ? "is" : "are"} over the ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB} MB limit`,
                {
                    description:
                        tooBig.length === 1
                            ? `It's ${formatSize(tooBig[0]!.size)}. Split it or export it at a lower quality.`
                            : tooBig.map(f => `${f.name} (${formatSize(f.size)})`).join(" · "),
                }
            );
        }
        const ok = arr.filter(f => f.size <= MAX_UPLOAD_BYTES);
        if (ok.length > 0) setStaged(prev => [...prev, ...ok]);
    };

    const removeStaged = (i: number) => setStaged(prev => prev.filter((_, idx) => idx !== i));

    const submit = async () => {
        if (!userId) {
            toast.error("Sign in to upload files");
            return;
        }
        if (staged.length === 0) return;
        setProgress({ done: 0, total: staged.length });
        try {
            const result = await uploadAndRegisterAll({
                files: staged,
                category,
                onProgress: (done, total) => setProgress({ done, total }),
                onPhase: (file, next) => setPhase({ file, phase: next }),
            });
            if (result.errors.length > 0) {
                toast.error(
                    `${result.errors.length} file${result.errors.length !== 1 ? "s" : ""} failed`,
                    {
                        description: result.errors.slice(0, 2).join(" · "),
                    }
                );
            }
            // Only clear the staged list (and close via onUploaded) when something
            // actually made it up — if every file failed, keep the list so the user
            // can retry without re-picking.
            if (result.successes > 0) {
                toast.success(
                    `Uploaded ${result.successes} file${result.successes !== 1 ? "s" : ""}${whereTo(category)}`
                );
                setStaged([]);
                onUploaded();
            }
        } finally {
            setProgress(null);
            setPhase(null);
        }
    };

    const busy = progress !== null;
    const transcribing =
        phase?.phase === "processing" &&
        detectSourceType(phase.file.type || undefined, phase.file.name) === "audio";

    return (
        <div>
            <div
                onDragOver={e => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    addFiles(e.dataTransfer.files);
                }}
                style={{
                    border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--line)"}`,
                    background: dragging ? "var(--accent-soft)" : "var(--line-2)",
                    borderRadius: 12,
                    padding: "40px 24px",
                    textAlign: "center",
                    transition: "all 140ms",
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--accent)",
                        marginBottom: 12,
                    }}
                >
                    <IconEl size={20} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{copy.title}</div>
                <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>
                    {copy.hint}
                </div>
                <button
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                    style={{
                        background: "var(--accent)",
                        color: "white",
                        padding: "8px 16px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        opacity: busy ? 0.6 : 1,
                        cursor: busy ? "not-allowed" : "pointer",
                    }}
                >
                    {copy.browse}
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={FILE_ACCEPT[kind] || undefined}
                    style={{ display: "none" }}
                    onChange={e => addFiles(e.target.files)}
                />
            </div>
            {kind === "files" && (
                <div
                    style={{
                        marginTop: 16,
                        padding: "12px 14px",
                        background: "var(--line-2)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--ink-3)",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                    }}
                >
                    <IconBolt size={14} />
                    <span>OCR runs automatically on scanned PDFs and images.</span>
                </div>
            )}

            {staged.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <div
                        style={{
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            background: "var(--panel)",
                            overflow: "hidden",
                        }}
                    >
                        {staged.map((f, i) => {
                            const ext = extOf(f.name);
                            return (
                                <div
                                    key={`${f.name}-${i}`}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "7px 12px",
                                        borderBottom:
                                            i < staged.length - 1
                                                ? "1px solid var(--line)"
                                                : "none",
                                    }}
                                >
                                    <div
                                        className="mono"
                                        style={{
                                            width: 40,
                                            padding: "1px 5px",
                                            borderRadius: 3,
                                            fontSize: 9,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            color: extColor(ext),
                                            background: `color-mix(in oklch, ${extColor(ext)} 12%, transparent)`,
                                            textAlign: "center",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {ext || "FILE"}
                                    </div>
                                    <div
                                        style={{
                                            flex: 1,
                                            fontSize: 13,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {f.name}
                                    </div>
                                    <div
                                        className="mono"
                                        style={{ fontSize: 11, color: "var(--ink-3)" }}
                                    >
                                        {formatSize(f.size)}
                                    </div>
                                    <button
                                        onClick={() => removeStaged(i)}
                                        disabled={busy}
                                        title="Remove"
                                        style={{
                                            color: "var(--ink-3)",
                                            padding: 4,
                                            display: "flex",
                                            alignItems: "center",
                                        }}
                                    >
                                        <IconX size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-ink-3 min-w-0 flex-1 text-[11px]" aria-live="polite">
                            {busy && progress
                                ? transcribing && phase
                                    ? `Transcribing ${phase.file.name}… a long recording takes a few minutes; keep this open.`
                                    : `Uploading ${Math.min(progress.done + 1, progress.total)} / ${progress.total}…`
                                : `${staged.length} file${staged.length !== 1 ? "s" : ""} ready to upload`}
                        </div>
                        <Button
                            className="shrink-0"
                            onClick={() => {
                                void submit();
                            }}
                            disabled={busy || staged.length === 0}
                        >
                            {busy && <Loader2 className="animate-spin" aria-hidden />}
                            Upload {staged.length} file{staged.length !== 1 ? "s" : ""}
                            {isUnfiledFolder(category) ? "" : ` to ${folderLeafName(category)}`}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Folder panel
// ---------------------------------------------------------------------------

interface FolderPanelProps {
    userId: string | null;
    /** Where the picked folder goes: it is created inside this one (or at the top for Unfiled). */
    destination: string;
    /** The new folder's name as it stands, or null — the destination bar shows it after `destination`. */
    onNameChange: (name: string | null) => void;
    onUploaded: () => void;
}

interface PickedFolder {
    /** Best-effort root name extracted from webkitRelativePath. */
    rootName: string;
    files: File[];
}

/** "Q3 data/raw/a.csv" for a picked folder's file; the bare name for anything else. */
function relativePathOf(file: File): string {
    return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function FolderPanel({ userId, destination, onNameChange, onUploaded }: FolderPanelProps) {
    const [picked, setPicked] = useState<PickedFolder | null>(null);
    const [name, setName] = useState("");
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // The bar above shows "<destination> › <name>  New folder" while a folder is picked.
    useEffect(() => {
        onNameChange(picked ? name : null);
    }, [picked, name, onNameChange]);
    useEffect(() => () => onNameChange(null), [onNameChange]);

    const onFolderPicked = (fl: FileList | null) => {
        if (!fl || fl.length === 0) return;
        const files = Array.from(fl).filter(
            // Skip hidden / system files and anything under a .git/node_modules
            f =>
                !relativePathOf(f)
                    .split("/")
                    .some(seg => seg.startsWith(".") || seg === "node_modules")
        );
        const first = files[0];
        const root = first ? (relativePathOf(first).split("/")[0] ?? "Folder") : "Folder";
        setPicked({ rootName: root, files });
        setName(root);
        setExcluded(new Set());
    };

    const toggle = (key: string) =>
        setExcluded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const included = picked ? picked.files.filter((f, i) => !excluded.has(`${i}-${f.name}`)) : [];
    // Every file keeps the subfolder it had on disk, under the new folder.
    const plan = planFolderUpload(destination, name, included.map(relativePathOf));
    const blocked = plan.problems.length > 0;

    const submit = async () => {
        if (!userId) {
            toast.error("Sign in to upload files");
            return;
        }
        if (included.length === 0 || blocked) return;
        setBusy(true);
        setProgress({ done: 0, total: included.length });
        let successes = 0;
        const errors: string[] = [];
        try {
            for (let i = 0; i < included.length; i++) {
                const file = included[i]!;
                try {
                    const up = await uploadFileToStorage(file);
                    await registerDocument({
                        file,
                        url: up.url,
                        provider: up.provider,
                        category: plan.paths[i]!,
                    });
                    successes++;
                } catch (err) {
                    errors.push(
                        err instanceof Error ? err.message : `Failed to upload ${file.name}`
                    );
                }
                setProgress({ done: i + 1, total: included.length });
            }
            if (errors.length > 0) {
                toast.error(`${errors.length} file${errors.length !== 1 ? "s" : ""} failed`, {
                    description: errors.slice(0, 2).join(" · "),
                });
            }
            // Same retry affordance as FilesPanel: keep the picked folder staged
            // when nothing uploaded so the user can retry.
            if (successes > 0) {
                toast.success(
                    `Uploaded ${successes} file${successes !== 1 ? "s" : ""}${whereTo(plan.root)}`
                );
                setPicked(null);
                onUploaded();
            }
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    if (!picked) {
        return (
            <div className="border-line bg-line-2 rounded-xl border-[1.5px] border-dashed px-6 py-10 text-center">
                <div className="border-line bg-panel text-brand mb-3 inline-flex size-11 items-center justify-center rounded-xl border">
                    <IconFolder size={20} />
                </div>
                <div className="text-ink mb-1 text-[15px] font-semibold">Pick a folder</div>
                <p className="text-ink-3 mx-auto mb-4 max-w-[360px] text-[13px]">
                    Each file becomes its own source. The folder is added inside the one above, with
                    its subfolders kept as they are.
                </p>
                <Button type="button" onClick={() => inputRef.current?.click()}>
                    Choose folder
                </Button>
                <input
                    ref={inputRef}
                    type="file"
                    // @ts-expect-error — `webkitdirectory` is a non-standard HTMLInputElement attribute
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={e => onFolderPicked(e.target.files)}
                />
            </div>
        );
    }

    return (
        <div>
            {/* What was picked, and how it will be filed */}
            <div className="bg-line-2 mb-3 flex items-center gap-2.5 rounded-lg px-3 py-2.5">
                <IconFolder size={15} className="text-brand shrink-0" />
                <div className="min-w-0 flex-1">
                    <div className="mono text-ink-3 truncate text-xs">{picked.rootName}</div>
                    <div className="text-ink mt-0.5 text-[13px] font-semibold">
                        {included.length} file{included.length !== 1 ? "s" : ""} into{" "}
                        {plan.folderCount} folder{plan.folderCount !== 1 ? "s" : ""}
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPicked(null)}
                    disabled={busy}
                >
                    Change
                </Button>
            </div>

            {/* The new folder's name — editable */}
            <label className="mb-2.5 flex items-center gap-2.5">
                <span className="mono text-ink-3 shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Folder name
                </span>
                <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={busy}
                    aria-invalid={blocked || undefined}
                    className="h-8 flex-1 text-[13px]"
                />
            </label>
            {blocked && <p className="text-danger mb-2.5 text-xs">{plan.problems[0]}</p>}

            {/* File list */}
            <div
                style={{
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--panel)",
                    overflow: "hidden",
                    maxHeight: 280,
                    overflowY: "auto",
                }}
            >
                {picked.files.map((f, i) => {
                    const ext = extOf(f.name);
                    const key = `${i}-${f.name}`;
                    const included_ = !excluded.has(key);
                    return (
                        <label
                            key={key}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "7px 12px",
                                borderBottom:
                                    i < picked.files.length - 1 ? "1px solid var(--line)" : "none",
                                cursor: "pointer",
                                opacity: included_ ? 1 : 0.5,
                                background: included_ ? "transparent" : "var(--line-2)",
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={included_}
                                onChange={() => toggle(key)}
                                disabled={busy}
                                style={{ accentColor: "var(--accent)" }}
                            />
                            <div
                                className="mono"
                                style={{
                                    width: 40,
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    color: extColor(ext),
                                    background: `color-mix(in oklch, ${extColor(ext)} 12%, transparent)`,
                                    textAlign: "center",
                                    flexShrink: 0,
                                }}
                            >
                                {ext || "FILE"}
                            </div>
                            <div
                                style={{
                                    flex: 1,
                                    fontSize: 13,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {relativePathOf(f)}
                            </div>
                            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                                {formatSize(f.size)}
                            </div>
                        </label>
                    );
                })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-ink-3 text-[11px]">
                    {busy && progress
                        ? `Uploading ${progress.done} / ${progress.total}…`
                        : "Hidden & system files excluded"}
                </div>
                <Button
                    type="button"
                    disabled={busy || included.length === 0 || blocked}
                    onClick={() => {
                        void submit();
                    }}
                >
                    Add {included.length} file{included.length !== 1 ? "s" : ""}
                    {name.trim() ? ` to ${name.trim()}` : ""}
                </Button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Paste panel — creates a `.md` File and runs the normal upload flow
// ---------------------------------------------------------------------------

interface TextPanelProps {
    userId: string | null;
    category: string;
    onUploaded: () => void;
    initialText?: string;
    initialUrl?: string;
}

function PastePanel({ userId, category, onUploaded, initialText }: TextPanelProps) {
    const [title, setTitle] = useState("");
    const [text, setText] = useState(initialText ?? "");
    useEffect(() => {
        if (initialText) setText(initialText);
    }, [initialText]);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!userId) {
            toast.error("Sign in to save notes");
            return;
        }
        const trimmed = text.trim();
        if (!trimmed) return;
        const safeTitle = title.trim() || "Pasted note";
        const sanitized = safeTitle
            .replace(/[^a-zA-Z0-9\s\-_]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 100);
        const filename = `${sanitized || "note"}.md`;
        const file = new File([trimmed], filename, { type: "text/markdown" });
        setBusy(true);
        try {
            const up = await uploadFileToStorage(file);
            await registerDocument({
                file,
                url: up.url,
                provider: up.provider,
                category,
            });
            toast.success(`Added "${safeTitle}"${whereTo(category)}`);
            setTitle("");
            setText("");
            onUploaded();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save note");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Title (optional)"
                disabled={busy}
                style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    fontSize: 14,
                    color: "var(--ink)",
                    outline: "none",
                    marginBottom: 10,
                }}
                onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                onBlur={e => (e.target.style.borderColor = "var(--line)")}
            />
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={busy}
                placeholder="Paste notes, an email, a transcript, anything…"
                style={{
                    width: "100%",
                    minHeight: 200,
                    padding: 14,
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    fontSize: 14,
                    lineHeight: 1.55,
                    resize: "vertical",
                    color: "var(--ink)",
                    outline: "none",
                }}
                onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                onBlur={e => (e.target.style.borderColor = "var(--line)")}
            />
            <div
                style={{
                    marginTop: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {text.length.toLocaleString()} chars
                </div>
                <button
                    disabled={busy || !text.trim()}
                    onClick={() => {
                        void submit();
                    }}
                    style={{
                        background: busy || !text.trim() ? "var(--line)" : "var(--accent)",
                        color: busy || !text.trim() ? "var(--ink-3)" : "white",
                        padding: "8px 16px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: busy || !text.trim() ? "not-allowed" : "pointer",
                    }}
                >
                    {busy ? "Saving…" : "Add as note"}
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// URL panel → /api/upload/website
// ---------------------------------------------------------------------------

function UrlPanel({ userId, category, onUploaded, initialUrl }: TextPanelProps) {
    const [url, setUrl] = useState(initialUrl ?? "");
    useEffect(() => {
        if (initialUrl) setUrl(initialUrl);
    }, [initialUrl]);
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!userId) {
            toast.error("Sign in to fetch pages");
            return;
        }
        const trimmed = url.trim();
        if (!trimmed) return;
        setBusy(true);
        try {
            const res = await fetch("/api/upload/website", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: trimmed, category }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                success?: boolean;
                error?: string;
                message?: string;
            };
            if (!res.ok) {
                throw new Error(data.error ?? "Failed to index website");
            }
            toast.success(data.message ?? "Website queued for indexing");
            setUrl("");
            onUploaded();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to fetch URL");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 10 }}>
                Paste any URL. We&apos;ll crawl the main content and strip the chrome.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
                <input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://example.com/article"
                    disabled={busy}
                    style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        fontSize: 14,
                        color: "var(--ink)",
                        outline: "none",
                    }}
                    onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                    onBlur={e => (e.target.style.borderColor = "var(--line)")}
                />
                <button
                    disabled={busy || !url.trim()}
                    onClick={() => {
                        void submit();
                    }}
                    style={{
                        background: busy || !url.trim() ? "var(--line)" : "var(--accent)",
                        color: busy || !url.trim() ? "var(--ink-3)" : "white",
                        padding: "10px 18px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: busy || !url.trim() ? "not-allowed" : "pointer",
                    }}
                >
                    {busy ? "Fetching…" : "Fetch"}
                </button>
            </div>
            <div
                style={{
                    marginTop: 12,
                    padding: "10px 14px",
                    background: "var(--line-2)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--ink-3)",
                }}
            >
                Tip: add{" "}
                <span className="mono" style={{ color: "var(--ink-2)" }}>
                    {"/**"}
                </span>{" "}
                to a URL to recursively crawl a subtree.
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// YouTube panel → /api/upload/video-url
// ---------------------------------------------------------------------------

function YouTubePanel({ userId, category, onUploaded }: TextPanelProps) {
    const [videoUrl, setVideoUrl] = useState("");
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!userId) {
            toast.error("Sign in to transcribe videos");
            return;
        }
        const trimmed = videoUrl.trim();
        if (!trimmed) return;
        setBusy(true);
        try {
            const res = await fetch("/api/upload/video-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    videoUrl: trimmed,
                    category,
                    title: title.trim() || undefined,
                }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                details?: string;
                document?: { title?: string };
            };
            if (!res.ok) {
                throw new Error(data.details ?? "Failed to process video");
            }
            toast.success(`Video transcribed: "${data.document?.title ?? "Video"}"`);
            setVideoUrl("");
            setTitle("");
            onUploaded();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to process video");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 10 }}>
                Paste a YouTube URL. We&apos;ll pull the transcript and timestamps.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                    value={videoUrl}
                    onChange={e => setVideoUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=…"
                    disabled={busy}
                    style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        fontSize: 14,
                        color: "var(--ink)",
                        outline: "none",
                    }}
                    onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                    onBlur={e => (e.target.style.borderColor = "var(--line)")}
                />
            </div>
            <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Custom title (optional)"
                disabled={busy}
                style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    fontSize: 14,
                    color: "var(--ink)",
                    outline: "none",
                    marginBottom: 12,
                }}
                onFocus={e => (e.target.style.borderColor = "var(--accent)")}
                onBlur={e => (e.target.style.borderColor = "var(--line)")}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                    disabled={busy || !videoUrl.trim()}
                    onClick={() => {
                        void submit();
                    }}
                    style={{
                        background: busy || !videoUrl.trim() ? "var(--line)" : "var(--accent)",
                        color: busy || !videoUrl.trim() ? "var(--ink-3)" : "white",
                        padding: "10px 18px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: busy || !videoUrl.trim() ? "not-allowed" : "pointer",
                    }}
                >
                    {busy ? "Transcribing…" : "Transcribe"}
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Connect panel. Slack / GitHub connect via workspace OAuth (management role
// required, tokens live server-side only); the rest are coming-soon CTAs.
// Drive, Gmail and Notion have panels of their own.
// ---------------------------------------------------------------------------

interface ConnectPanelProps {
    tab: AddSourceTab;
}

/**
 * Tab id → connector provider for the providers this generic panel serves.
 * Drive and Notion have their own panels (DriveConnectPanel,
 * NotionConnectPanel) with sync controls, so they are deliberately absent.
 */
const CONNECTABLE_PROVIDERS: Record<string, string> = {
    slack: "slack",
    github: "github",
};

interface ConnectorsOverview {
    providers: Record<string, { configured: boolean }>;
    connections: Array<{
        id: string;
        provider: string;
        displayName: string | null;
        status: string;
        statusDetail: string | null;
        grantedBy: string | null;
        createdAt: string;
    }>;
}

function useConnectorsOverview(enabled: boolean) {
    const [data, setData] = useState<ConnectorsOverview | null>(null);
    const [loading, setLoading] = useState(enabled);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/connectors");
            if (res.ok) {
                const payload = (await res.json()) as { data?: ConnectorsOverview };
                setData(payload.data ?? null);
            }
        } catch {
            // The panel degrades to the coming-soon state; nothing to surface.
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (enabled) void refresh();
    }, [enabled, refresh]);

    return { data, loading, refresh };
}

const PROVIDER_PERKS: Record<string, string[]> = {
    gmail: [
        "Pick labels or Gmail searches",
        "Private to you — lands in your own folder",
        "Re-syncs every 15 minutes, read-only",
        "PDF and Office attachments included",
    ],
    slack: [
        "Mirrors agent meetings into a Slack channel",
        "Messages and files aren't added to your sources",
        "To search Slack, upload an export's JSON files",
    ],
    github: [
        "Lets the Repo Explainer read your private repos",
        "Code, issues and PRs aren't synced to your sources",
        "To search a repo, upload it as a ZIP",
    ],
    dropbox: ["Pick folders — kept in sync", "All file types indexed", "Shared folders supported"],
};

function ConnectPanel({ tab }: ConnectPanelProps) {
    const meta = SOURCE_META[tab.id as keyof typeof SOURCE_META];
    const Icon = meta?.Icon ?? tab.Icon;
    const color = meta?.color ?? "var(--accent)";
    const perks = PROVIDER_PERKS[tab.id] ?? [];
    const provider = CONNECTABLE_PROVIDERS[tab.id];
    const overview = useConnectorsOverview(Boolean(provider));
    const [disconnecting, setDisconnecting] = useState<string | null>(null);

    const configured = provider ? (overview.data?.providers[provider]?.configured ?? false) : false;
    const connections = provider
        ? (overview.data?.connections ?? []).filter(row => row.provider === provider)
        : [];

    const disconnect = async (connectionId: string) => {
        setDisconnecting(connectionId);
        try {
            const res = await fetch(`/api/connectors/connections/${connectionId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                toast.success(`${tab.label} disconnected`);
                await overview.refresh();
            } else {
                toast.error(`Could not disconnect ${tab.label}`);
            }
        } finally {
            setDisconnecting(null);
        }
    };
    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 18px",
                    background: "var(--line-2)",
                    borderRadius: 12,
                    marginBottom: 16,
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color,
                    }}
                >
                    <Icon size={22} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Connect {tab.label}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                        One-click OAuth, revoke anytime.
                    </div>
                </div>
            </div>
            <ul
                style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginBottom: 18,
                }}
            >
                {perks.map(p => (
                    <li
                        key={p}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            fontSize: 13,
                            color: "var(--ink-2)",
                        }}
                    >
                        <span style={{ color: "var(--accent)" }}>
                            <IconCheck size={14} />
                        </span>
                        {p}
                    </li>
                ))}
            </ul>
            {provider && connections.length > 0 && (
                <ul
                    style={{
                        margin: 0,
                        padding: 0,
                        listStyle: "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        marginBottom: 14,
                    }}
                >
                    {connections.map(row => (
                        <li
                            key={row.id}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "10px 12px",
                                border: "1px solid var(--line)",
                                borderRadius: 10,
                                fontSize: 13,
                            }}
                        >
                            <span
                                style={{
                                    color:
                                        row.status === "active"
                                            ? "var(--accent)"
                                            : "var(--danger, var(--ink-3))",
                                }}
                            >
                                <IconCheck size={14} />
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontWeight: 600 }}>
                                    {row.displayName ?? tab.label}
                                </span>
                                <span style={{ color: "var(--ink-3)" }}>
                                    {row.status !== "active"
                                        ? ` · ${row.status} — reconnect`
                                        : row.grantedBy
                                          ? ` · connected by ${row.grantedBy}`
                                          : ""}
                                </span>
                            </span>
                            <button
                                onClick={() => void disconnect(row.id)}
                                disabled={disconnecting === row.id}
                                style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "var(--ink-2)",
                                    padding: "4px 10px",
                                    borderRadius: 8,
                                    border: "1px solid var(--line)",
                                    cursor: disconnecting === row.id ? "wait" : "pointer",
                                }}
                            >
                                {disconnecting === row.id ? "Removing…" : "Disconnect"}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {provider && configured ? (
                <a
                    href={`/api/connectors/${provider}/oauth/start`}
                    style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        background: "var(--accent)",
                        color: "white",
                        fontSize: 14,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        textDecoration: "none",
                    }}
                >
                    <Icon size={16} />
                    {connections.length > 0
                        ? `Connect another ${tab.label} account`
                        : `Connect ${tab.label}`}
                </a>
            ) : (
                <button
                    disabled
                    style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        background: "var(--line)",
                        color: "var(--ink-3)",
                        fontSize: 14,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        cursor: "not-allowed",
                    }}
                    title={
                        provider
                            ? "Ask your administrator to add this provider's OAuth keys — steps in .env.example"
                            : "Coming soon"
                    }
                >
                    <Icon size={16} />
                    {overview.loading && provider
                        ? "Checking…"
                        : provider
                          ? `Connect ${tab.label} — not configured on this server`
                          : `Connect ${tab.label} — coming soon`}
                </button>
            )}
        </div>
    );
}
