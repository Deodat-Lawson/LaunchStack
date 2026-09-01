"use client";

/**
 * The sessions browser: every Claude Code / Codex session on the machine that
 * runs this server, with per-session import into the workspace knowledge
 * base. Imported sessions link straight to the conversation viewer and to
 * "continue in chat". Newest first, filterable by tool, project and status —
 * built for the hundreds-of-sessions corpus a working laptop actually has.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    ArchiveRestore,
    Bot,
    CircleDot,
    Download,
    ExternalLink,
    FolderGit2,
    Loader2,
    MessageSquarePlus,
    MessagesSquare,
    RefreshCw,
    Search,
    ShieldAlert,
    SquareTerminal,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import {
    AgentSessionsApiError,
    fetchSessionsPreview,
    importAllSessions,
    importSessions,
    type AgentSessionItem,
    type SessionsPreview,
    type SessionTool,
} from "../lib/api";

const TOOL_META: Record<SessionTool, { label: string; Icon: React.ElementType }> = {
    "claude-code": { label: "Claude Code", Icon: Bot },
    codex: { label: "Codex", Icon: SquareTerminal },
};

type StatusFilter = "all" | "new" | "imported" | "stale";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTime(iso: string): string {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";
    const diffMin = Math.floor((Date.now() - then) / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(then).toLocaleDateString();
}

/** `/Users/me/code/app` → `app`; Claude's slug encoding → last segment. */
function projectLabel(item: AgentSessionItem): string | null {
    if (item.projectPath) {
        const last = item.projectPath.split("/").filter(Boolean).at(-1);
        if (last) return last;
    }
    if (item.projectSlug) {
        const last = item.projectSlug.split("-").filter(Boolean).at(-1);
        if (last) return last;
    }
    return null;
}

function StatusBadge({ item }: { item: AgentSessionItem }) {
    if (item.active) {
        return (
            <span className="text-warn inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide">
                <CircleDot className="h-3 w-3 animate-pulse" />
                Live
            </span>
        );
    }
    if (item.imported?.stale) {
        return (
            <span className="bg-warn/10 text-warn rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide">
                Update available
            </span>
        );
    }
    if (item.imported) {
        return (
            <span className="bg-success/10 text-success rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide">
                Imported
            </span>
        );
    }
    return (
        <span className="bg-panel-2 text-ink-3 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide">
            New
        </span>
    );
}

function SessionRow({
    item,
    busy,
    onImport,
}: {
    item: AgentSessionItem;
    busy: boolean;
    onImport: (item: AgentSessionItem) => void;
}) {
    const router = useRouter();
    const { label, Icon } = TOOL_META[item.tool];
    const project = projectLabel(item);

    return (
        <div className="border-line bg-panel hover:border-brand/40 group flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors">
            <div className="bg-brand-soft text-brand-ink flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg">
                <Icon className="h-4.5 w-4.5" />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-ink truncate text-[13.5px] font-semibold">
                        {item.title}
                    </span>
                    <StatusBadge item={item} />
                    {item.archived && (
                        <span className="text-ink-4 inline-flex items-center gap-0.5 font-mono text-[10px]">
                            <ArchiveRestore className="h-3 w-3" />
                            archived
                        </span>
                    )}
                </div>
                <div className="text-ink-3 mt-0.5 flex min-w-0 items-center gap-2 text-xs">
                    <span className="flex-shrink-0 font-mono text-[10.5px]">{label}</span>
                    {project && (
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10.5px]">
                            <FolderGit2 className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">
                                {project}
                                {item.gitBranch ? `@${item.gitBranch}` : ""}
                            </span>
                        </span>
                    )}
                    {item.preview && item.preview !== item.title && (
                        <span className="truncate">{item.preview}</span>
                    )}
                </div>
            </div>

            <div className="text-ink-4 flex flex-shrink-0 flex-col items-end font-mono text-[10.5px]">
                <span>{relativeTime(item.modifiedAt)}</span>
                <span>{formatBytes(item.bytes)}</span>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1.5">
                {item.imported ? (
                    <>
                        {item.imported.stale && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                disabled={busy}
                                onClick={() => onImport(item)}
                            >
                                {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                )}
                                Update
                            </Button>
                        )}
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 text-xs"
                                        onClick={() =>
                                            router.push(
                                                `/employer/documents/viewer?docId=${item.imported!.documentId}`
                                            )
                                        }
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        Open
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    <p className="text-xs">View the imported transcript</p>
                                </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="sm"
                                        className="bg-brand hover:bg-brand-hi text-brand-fg h-7 gap-1 text-xs"
                                        onClick={() =>
                                            router.push(
                                                `/employer/documents?feature=chat&continue=${item.imported!.documentId}`
                                            )
                                        }
                                    >
                                        <MessageSquarePlus className="h-3.5 w-3.5" />
                                        Continue
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    <p className="text-xs">Pick this conversation up in chat</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </>
                ) : (
                    <Button
                        size="sm"
                        className="bg-brand hover:bg-brand-hi text-brand-fg h-7 gap-1 text-xs"
                        disabled={busy}
                        onClick={() => onImport(item)}
                    >
                        {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Download className="h-3.5 w-3.5" />
                        )}
                        Import
                    </Button>
                )}
            </div>
        </div>
    );
}

export function SessionsBrowser() {
    const [preview, setPreview] = useState<SessionsPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<AgentSessionsApiError | null>(null);
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [importingAll, setImportingAll] = useState(false);

    const [query, setQuery] = useState("");
    const [toolFilter, setToolFilter] = useState<"all" | SessionTool>("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [projectFilter, setProjectFilter] = useState<string>("all");

    const load = useCallback(async () => {
        setError(null);
        try {
            setPreview(await fetchSessionsPreview());
        } catch (cause) {
            setError(
                cause instanceof AgentSessionsApiError
                    ? cause
                    : new AgentSessionsApiError("Failed to load sessions.")
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    /** Fold an import report's stored rows back into the listed items. */
    const applyReport = useCallback(
        (stored: { sourceId: string; documentId: number }[], failed: { sourceId: string }[]) => {
            const byId = new Map(stored.map(entry => [entry.sourceId, entry.documentId]));
            setPreview(prev =>
                prev
                    ? {
                          ...prev,
                          items: prev.items.map(item =>
                              byId.has(item.sourceId)
                                  ? {
                                        ...item,
                                        imported: {
                                            documentId: byId.get(item.sourceId)!,
                                            syncedAt: new Date().toISOString(),
                                            stale: false,
                                        },
                                    }
                                  : item
                          ),
                      }
                    : prev
            );
            if (failed.length > 0) {
                toast.error(
                    `${failed.length} session${failed.length === 1 ? "" : "s"} failed to import`
                );
            }
        },
        []
    );

    const importOne = useCallback(
        async (item: AgentSessionItem) => {
            setBusyIds(prev => new Set(prev).add(item.sourceId));
            try {
                const report = await importSessions([item.sourceId]);
                applyReport(report.stored, report.failed);
                if (report.stored.length > 0) {
                    toast.success(
                        `Imported "${item.title}" — indexing now, it will be searchable shortly`
                    );
                } else if (report.skipped.some(s => s.reason === "unchanged")) {
                    toast.info("Already imported and unchanged");
                } else if (report.failed.length === 0) {
                    toast.error("The session could not be imported");
                }
            } catch (cause) {
                toast.error(
                    cause instanceof Error ? cause.message : "The session could not be imported"
                );
            } finally {
                setBusyIds(prev => {
                    const next = new Set(prev);
                    next.delete(item.sourceId);
                    return next;
                });
            }
        },
        [applyReport]
    );

    const importAll = useCallback(async () => {
        setImportingAll(true);
        try {
            const report = await importAllSessions();
            applyReport(report.stored, report.failed);
            toast.success(
                `Imported ${report.counts.stored} of ${report.counts.discovered} sessions`
            );
        } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "Bulk import failed");
        } finally {
            setImportingAll(false);
        }
    }, [applyReport]);

    const projects = useMemo(() => {
        const seen = new Set<string>();
        for (const item of preview?.items ?? []) {
            const label = projectLabel(item);
            if (label) seen.add(label);
        }
        return [...seen].sort((a, b) => a.localeCompare(b));
    }, [preview]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (preview?.items ?? []).filter(item => {
            if (toolFilter !== "all" && item.tool !== toolFilter) return false;
            if (statusFilter === "new" && item.imported) return false;
            if (statusFilter === "imported" && !item.imported) return false;
            if (statusFilter === "stale" && !item.imported?.stale) return false;
            if (projectFilter !== "all" && projectLabel(item) !== projectFilter) return false;
            if (q) {
                const hay =
                    `${item.title} ${item.preview ?? ""} ${item.projectPath ?? ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [preview, query, toolFilter, statusFilter, projectFilter]);

    const counts = useMemo(() => {
        const items = preview?.items ?? [];
        return {
            total: items.length,
            imported: items.filter(i => i.imported).length,
            stale: items.filter(i => i.imported?.stale).length,
        };
    }, [preview]);

    if (loading) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="text-brand-ink h-7 w-7 animate-spin" />
                <p className="text-ink-3 text-sm font-medium">Scanning local sessions…</p>
            </div>
        );
    }

    if (error) {
        const disabled = error.connectorDisabled;
        return (
            <div className="flex h-full items-center justify-center p-8">
                <div className="border-line bg-panel max-w-lg rounded-2xl border p-8 text-center">
                    <div className="bg-panel-2 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
                        <ShieldAlert className="text-ink-3 h-6 w-6" />
                    </div>
                    <h2 className="text-ink mb-2 text-base font-semibold">
                        {disabled
                            ? "The sessions connector is turned off"
                            : "Can't browse sessions"}
                    </h2>
                    <p className="text-ink-3 mb-4 text-sm leading-relaxed">
                        {disabled ? (
                            <>
                                This browser reads Claude Code and Codex folders on the machine that
                                hosts LaunchStack, so it ships disabled. Set{" "}
                                <code className="bg-panel-2 border-line-2 rounded border px-1 py-0.5 font-mono text-[11.5px]">
                                    AGENT_SESSIONS_CONNECTOR_ENABLED=true
                                </code>{" "}
                                on that server to turn it on.
                            </>
                        ) : (
                            error.message
                        )}
                    </p>
                    {!disabled && (
                        <Button size="sm" variant="outline" onClick={() => void load()}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            Try again
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-6 py-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-ink flex items-center gap-2 text-lg font-semibold">
                        <MessagesSquare className="text-brand-ink h-5 w-5" />
                        Coding sessions
                    </h1>
                    <p className="text-ink-3 mt-0.5 text-[13px]">
                        Claude Code and Codex conversations on this machine. Import one to make it
                        searchable workspace knowledge — then continue it in chat.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => {
                            setLoading(true);
                            void load();
                        }}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Rescan
                    </Button>
                    <Button
                        size="sm"
                        className="bg-brand hover:bg-brand-hi text-brand-fg h-8 gap-1.5 text-xs"
                        disabled={importingAll}
                        onClick={() => void importAll()}
                    >
                        {importingAll ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Download className="h-3.5 w-3.5" />
                        )}
                        Import all new
                    </Button>
                </div>
            </div>

            {/* Roots + counts */}
            <div className="text-ink-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px]">
                {(preview?.roots ?? []).map(root => (
                    <span key={root.dir} className="inline-flex items-center gap-1">
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${root.exists ? "bg-success" : "bg-line"}`}
                        />
                        {root.dir}
                        {root.exists ? ` · ${root.sessionCount}` : " · not found"}
                    </span>
                ))}
                <span className="ml-auto">
                    {counts.imported}/{counts.total} imported
                    {counts.stale > 0 ? ` · ${counts.stale} with updates` : ""}
                    {preview?.truncated ? " · list truncated" : ""}
                </span>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1">
                    <Search className="text-ink-4 absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                    <Input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search titles, prompts, projects…"
                        className="h-8 pl-8 text-[13px]"
                    />
                </div>
                <Select
                    value={toolFilter}
                    onValueChange={v => setToolFilter(v as typeof toolFilter)}
                >
                    <SelectTrigger className="h-8 w-36 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All tools</SelectItem>
                        <SelectItem value="claude-code">Claude Code</SelectItem>
                        <SelectItem value="codex">Codex</SelectItem>
                    </SelectContent>
                </Select>
                <Select
                    value={statusFilter}
                    onValueChange={v => setStatusFilter(v as StatusFilter)}
                >
                    <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="new">Not imported</SelectItem>
                        <SelectItem value="imported">Imported</SelectItem>
                        <SelectItem value="stale">Update available</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                    <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All projects</SelectItem>
                        {projects.map(p => (
                            <SelectItem key={p} value={p}>
                                {p}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                    <div className="border-line text-ink-3 flex items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-[13px]">
                        <MessagesSquare className="h-4 w-4" />
                        {counts.total === 0
                            ? "No Claude Code or Codex sessions were found on this machine."
                            : "No sessions match these filters."}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 pb-6">
                        {filtered.map(item => (
                            <SessionRow
                                key={item.sourceId}
                                item={item}
                                busy={busyIds.has(item.sourceId)}
                                onImport={i => void importOne(i)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
