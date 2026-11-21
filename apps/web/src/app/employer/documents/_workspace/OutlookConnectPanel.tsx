"use client";

/**
 * The Outlook connect panel: what Add a source shows for `outlook`.
 *
 * Outlook is personal, like Gmail: the connection is the signed-in member's
 * own, and the synced conversations land in `Outlook/<address>`, a folder
 * only they can see.
 *
 * States, all from GET /api/connectors/outlook:
 * - loading, and "could not load" with a retry;
 * - not enabled on this server (operators are told which switches to set,
 *   everyone else whom to ask), with Disconnect when a connection was made
 *   before the switch went off;
 * - not connected (Connect, or why this role cannot);
 * - revoked (Reconnect);
 * - connected: the chosen mail folders and searches, the folder picker (the
 *   mailbox's folder tree, child folders included), the search box, Sync now, and
 *   Disconnect behind a confirmation;
 * - syncing (polls status; a sync that never starts says so, see
 *   useConnectorSync).
 *
 * Disconnecting deletes LaunchStack's saved access and stops the sync.
 * Microsoft has no way for an app to withdraw its own grant, so the toast
 * says where the member can remove it on Microsoft's side.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, FolderClosed, RefreshCw, Search, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

import { SyncStalledNotice } from "./SyncStalledNotice";
import type { AddSourceTab } from "./types";
import { useConnectorSync, useSyncStatusLabel } from "./useConnectorSync";

interface ScopeRow {
    readonly id: string;
    readonly kind: "folder" | "query";
    readonly value: string;
    readonly name: string;
}

interface OutlookStatus {
    readonly configured: boolean;
    readonly connected: boolean;
    readonly canConnect: boolean;
    /** Whether the reader could change the server's settings (shown the switches to set). */
    readonly canConfigure?: boolean;
    readonly connectUrl?: string;
    readonly connectionId?: string;
    readonly status?: string;
    readonly statusDetail?: string | null;
    readonly accountEmail?: string | null;
    readonly folder?: string;
    readonly scope?: readonly ScopeRow[];
    readonly lastSyncAt?: string | null;
    readonly lastSyncStatus?: string | null;
    readonly lastSyncError?: string | null;
    readonly lastSyncReport?: Record<string, unknown> | null;
}

interface FolderOption {
    readonly id: string;
    readonly name: string;
    /** Display names from the top of the mailbox down, e.g. `Clients/Acme`. */
    readonly path: string;
    /** Null at the top of the mailbox. */
    readonly parentId: string | null;
}

/** The mailbox's folder tree, flattened, once the picker has asked for it. */
type FolderList =
    | { readonly state: "loading" }
    | { readonly state: "error" }
    | { readonly state: "ready"; readonly folders: readonly FolderOption[] };

type Loaded =
    | { readonly kind: "loading" }
    | { readonly kind: "error" }
    | { readonly kind: "ready"; readonly status: OutlookStatus };

const BASE = "/api/connectors/outlook";
export const OUTLOOK_CONNECT_URL = "/api/connectors/microsoft/oauth/start?provider=outlook";
/** Where a member removes an app from a work or school Microsoft account. */
export const MICROSOFT_APPS_URL = "https://myapps.microsoft.com";

/** What connecting gives, as keys in `sources.addSourceModal.connect.perks`. */
const PERKS = ["outlookFolders", "outlookPrivate", "outlookResync", "outlookAttachments"] as const;

async function postJson(path: string, method: string, body: unknown): Promise<Response> {
    return fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function reportCount(report: Record<string, unknown> | null | undefined, key: string): number {
    const value = report?.[key];
    return typeof value === "number" ? value : 0;
}

type PanelTranslator = ReturnType<typeof useTranslations<"sources.outlookConnect">>;

/** The folders directly inside `parent`, and under each open one the folders inside it. */
function FolderTree({
    parent,
    depth,
    folders,
    expanded,
    selected,
    syncing,
    onToggleOpen,
    onToggleSelected,
    t,
}: {
    /** Null for the top of the mailbox. */
    readonly parent: string | null;
    readonly depth: number;
    /** The whole mailbox, flattened, parents before children. */
    readonly folders: readonly FolderOption[];
    readonly expanded: ReadonlySet<string>;
    readonly selected: ReadonlyMap<string, string>;
    /** Folder ids already in the sync. */
    readonly syncing: ReadonlySet<string>;
    readonly onToggleOpen: (folder: FolderOption) => void;
    readonly onToggleSelected: (folder: FolderOption, checked: boolean) => void;
    readonly t: PanelTranslator;
}) {
    const inside = folders.filter(folder => folder.parentId === parent);
    if (inside.length === 0) return null;
    return (
        <ul className="flex flex-col gap-0.5" role={depth === 0 ? "tree" : "group"}>
            {inside.map(folder => {
                const hasChildren = folders.some(other => other.parentId === folder.id);
                const open = expanded.has(folder.id);
                const already = syncing.has(folder.id);
                const checkboxId = `outlook-folder-${folder.id}`;
                return (
                    <li
                        key={folder.id}
                        role="treeitem"
                        aria-expanded={hasChildren ? open : undefined}
                        aria-selected={false}
                    >
                        <div className="flex items-center gap-1.5 py-0.5">
                            {hasChildren ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-ink-3 size-6"
                                    aria-label={
                                        open
                                            ? t("collapseFolder", { name: folder.path })
                                            : t("expandFolder", { name: folder.path })
                                    }
                                    onClick={() => onToggleOpen(folder)}
                                >
                                    {open ? (
                                        <ChevronDown className="size-3.5" aria-hidden />
                                    ) : (
                                        <ChevronRight className="size-3.5" aria-hidden />
                                    )}
                                </Button>
                            ) : (
                                <span className="size-6 shrink-0" aria-hidden />
                            )}
                            <Checkbox
                                id={checkboxId}
                                checked={already || selected.has(folder.id)}
                                disabled={already}
                                onCheckedChange={checked =>
                                    onToggleSelected(folder, checked === true)
                                }
                            />
                            <label
                                htmlFor={checkboxId}
                                className={cn(
                                    "flex min-w-0 flex-1 items-center gap-1.5 text-[13px]",
                                    already ? "text-ink-3" : "text-ink cursor-pointer"
                                )}
                            >
                                <FolderClosed
                                    className="text-ink-3 size-3.5 shrink-0"
                                    aria-hidden
                                />
                                <span className="truncate">{folder.name}</span>
                                {already ? (
                                    <span className="text-ink-3 shrink-0 text-[11px]">
                                        {t("alreadySyncing")}
                                    </span>
                                ) : null}
                            </label>
                        </div>
                        {open ? (
                            <div className="border-line ml-3 border-l pl-3">
                                <FolderTree
                                    parent={folder.id}
                                    depth={depth + 1}
                                    folders={folders}
                                    expanded={expanded}
                                    selected={selected}
                                    syncing={syncing}
                                    onToggleOpen={onToggleOpen}
                                    onToggleSelected={onToggleSelected}
                                    t={t}
                                />
                            </div>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

export function OutlookConnectPanel({
    tab,
    onImported,
}: {
    tab: AddSourceTab;
    /** A folder or search was added, or a sync started by hand: Knowledge's In progress section takes over. */
    onImported?: () => void;
}) {
    const t = useTranslations("sources.outlookConnect");
    const tm = useTranslations("sources.addSourceModal");
    const tc = useTranslations("common");
    const syncStatusLabel = useSyncStatusLabel();
    const Icon = tab.Icon;
    const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
    const [busy, setBusy] = useState(false);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
    const [picking, setPicking] = useState(false);
    const [folderList, setFolderList] = useState<FolderList | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Map<string, string>>(new Map());
    const [query, setQuery] = useState("");

    const refresh = useCallback(async () => {
        try {
            const res = await fetch(BASE);
            if (!res.ok) {
                setLoaded(prev => (prev.kind === "ready" ? prev : { kind: "error" }));
                return null;
            }
            const payload = (await res.json()) as { data?: OutlookStatus };
            if (!payload.data) {
                setLoaded(prev => (prev.kind === "ready" ? prev : { kind: "error" }));
                return null;
            }
            setLoaded({ kind: "ready", status: payload.data });
            return payload.data;
        } catch {
            // A failed poll keeps what is on screen; only a first load says so.
            setLoaded(prev => (prev.kind === "ready" ? prev : { kind: "error" }));
            return null;
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const status = loaded.kind === "ready" ? loaded.status : null;

    // Polls while a sync is starting or running, so the counts land without
    // a manual refresh.
    const { phase, requestSync: startSync } = useConnectorSync(status, refresh, `${BASE}/sync`);

    const loadFolders = useCallback(async () => {
        setFolderList({ state: "loading" });
        try {
            const res = await fetch(`${BASE}/folders`);
            if (!res.ok) throw new Error(String(res.status));
            const payload = (await res.json()) as { data?: { folders?: FolderOption[] } };
            setFolderList({ state: "ready", folders: payload.data?.folders ?? [] });
        } catch {
            setFolderList({ state: "error" });
        }
    }, []);

    const openPicker = useCallback(() => {
        setPicking(true);
        if (!folderList || folderList.state === "error") void loadFolders();
    }, [folderList, loadFolders]);

    const closePicker = useCallback(() => {
        setPicking(false);
        setSelected(new Map());
    }, []);

    const toggleOpen = useCallback((folder: FolderOption) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(folder.id)) next.delete(folder.id);
            else next.add(folder.id);
            return next;
        });
    }, []);

    // A chosen folder is saved under its path, so "Clients/Acme" still says
    // where it is once it sits in the list of what syncs.
    const toggleSelected = useCallback((folder: FolderOption, checked: boolean) => {
        setSelected(prev => {
            const next = new Map(prev);
            if (checked) next.set(folder.id, folder.path);
            else next.delete(folder.id);
            return next;
        });
    }, []);

    const addFolders = useCallback(async () => {
        if (selected.size === 0) return;
        setBusy(true);
        try {
            const items = [...selected].map(([value, name]) => ({
                kind: "folder" as const,
                value,
                name,
            }));
            const res = await postJson(`${BASE}/items`, "POST", { items });
            if (!res.ok) {
                toast.error(t("saveSelectionFailed"));
                return;
            }
            setSelected(new Map());
            setPicking(false);
            await refresh();
            if (await startSync()) {
                toast.success(t("foldersAdded", { count: items.length }));
                onImported?.();
            } else toast.error(t("foldersAddedNoSync", { count: items.length }));
        } finally {
            setBusy(false);
        }
    }, [selected, refresh, startSync, t, onImported]);

    const addQuery = useCallback(async () => {
        const value = query.trim();
        if (value.length < 2) return;
        setBusy(true);
        try {
            const res = await postJson(`${BASE}/items`, "POST", {
                items: [{ kind: "query", value }],
            });
            if (!res.ok) {
                toast.error(t("saveSearchFailed"));
                return;
            }
            setQuery("");
            await refresh();
            if (await startSync()) {
                toast.success(t("searchAdded"));
                onImported?.();
            } else toast.error(t("searchAddedNoSync"));
        } finally {
            setBusy(false);
        }
    }, [query, refresh, startSync, t, onImported]);

    const removeItem = useCallback(
        async (id: string) => {
            const res = await postJson(`${BASE}/items`, "DELETE", { ids: [id] });
            if (!res.ok) toast.error(t("removeFailed"));
            void refresh();
        },
        [refresh, t]
    );

    const syncNow = useCallback(async () => {
        setBusy(true);
        try {
            if (await startSync()) {
                toast.success(t("syncRequested"));
                onImported?.();
            } else toast.error(t("syncStartFailed"));
        } finally {
            setBusy(false);
        }
    }, [startSync, t, onImported]);

    const disconnect = useCallback(async () => {
        setBusy(true);
        try {
            const res = await fetch(BASE, { method: "DELETE" });
            if (res.ok) {
                const payload = (await res.json().catch(() => null)) as {
                    data?: { removeAppUrl?: string };
                } | null;
                const removeAppUrl = payload?.data?.removeAppUrl ?? MICROSOFT_APPS_URL;
                // Truthful: our copy of the access is gone, Microsoft's listing is not.
                toast.success(t("disconnected"), {
                    description: t("disconnectedRemoveApp"),
                    duration: 12_000,
                    action: {
                        label: t("openMicrosoftApps"),
                        onClick: () => window.open(removeAppUrl, "_blank", "noopener,noreferrer"),
                    },
                });
            } else {
                toast.error(t("disconnectFailed"));
            }
            setFolderList(null);
            setExpanded(new Set());
            setSelected(new Map());
            setPicking(false);
            void refresh();
        } finally {
            setBusy(false);
        }
    }, [refresh, t]);

    const disconnectDialog = (
        <ConfirmDialog
            open={confirmingDisconnect}
            onOpenChange={setConfirmingDisconnect}
            title={t("disconnectTitle")}
            description={t("disconnectBody", {
                account: status?.accountEmail ?? t("disconnectAccountFallback"),
            })}
            confirmLabel={t("disconnect")}
            onConfirm={() => void disconnect()}
        />
    );

    if (loaded.kind === "loading") {
        return (
            <div className="text-ink-3 flex items-center gap-2 p-6 text-[13px]">
                <Spinner /> {t("checking")}
            </div>
        );
    }

    if (!status) {
        return (
            <div className="flex flex-col items-start gap-3 p-6">
                <p role="alert" className="text-danger text-[13px]">
                    {t("loadError")}
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        setLoaded({ kind: "loading" });
                        void refresh();
                    }}
                >
                    <RefreshCw aria-hidden />
                    {t("retry")}
                </Button>
            </div>
        );
    }

    if (!status.configured) {
        return (
            <div className="bg-line-2 text-ink-2 rounded-xl px-4 py-4 text-[13px] leading-relaxed">
                <div className="text-ink mb-1.5 font-semibold">{t("notEnabledTitle")}</div>
                {status.canConfigure ? (
                    <p>
                        {t.rich("notEnabledAdmin", {
                            code: chunks => <code className="font-mono text-xs">{chunks}</code>,
                        })}
                    </p>
                ) : (
                    <p>{t("notEnabledMember")}</p>
                )}
                {status.connected ? (
                    <div className="border-line mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                        <p className="min-w-0 flex-1">
                            {t("notEnabledStillConnected", {
                                account: status.accountEmail ?? t("disconnectAccountFallback"),
                            })}
                        </p>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setConfirmingDisconnect(true)}
                        >
                            {t("disconnect")}
                        </Button>
                    </div>
                ) : null}
                {disconnectDialog}
            </div>
        );
    }

    if (!status.connected || status.status !== "active") {
        const reconnect = status.connected && status.status !== "active";
        return (
            <div>
                <div className="bg-line-2 mb-4 flex items-center gap-3.5 rounded-xl px-4 py-4">
                    <div className="border-line bg-panel text-brand flex size-11 shrink-0 items-center justify-center rounded-[10px] border">
                        <Icon size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-ink text-[15px] font-semibold">
                            {reconnect ? t("reconnectTitle") : t("connectTitle")}
                        </div>
                        <div className="text-ink-3 text-[13px]">
                            {reconnect
                                ? status.statusDetail
                                    ? t("reconnectBodyDetail", { detail: status.statusDetail })
                                    : t("reconnectBody")
                                : t("connectBody")}
                        </div>
                    </div>
                </div>
                {reconnect ? null : (
                    <ul className="mb-4 flex flex-col gap-2.5">
                        {PERKS.map(perk => (
                            <li
                                key={perk}
                                className="text-ink-2 flex items-center gap-2.5 text-[13px]"
                            >
                                <Check className="text-brand size-3.5 shrink-0" aria-hidden />
                                {tm(`connect.perks.${perk}`)}
                            </li>
                        ))}
                    </ul>
                )}
                {status.canConnect ? (
                    <Button asChild className="w-full">
                        <a href={status.connectUrl ?? OUTLOOK_CONNECT_URL}>
                            {reconnect ? t("reconnectButton") : t("connectButton")}
                        </a>
                    </Button>
                ) : (
                    <p className="text-ink-3 text-[12.5px]">{t("noPermission")}</p>
                )}
                {reconnect ? (
                    <div className="mt-3 flex justify-end">
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setConfirmingDisconnect(true)}
                        >
                            {t("disconnect")}
                        </Button>
                    </div>
                ) : null}
                {disconnectDialog}
            </div>
        );
    }

    const scope = status.scope ?? [];
    const syncingFolders = new Set(
        scope.filter(item => item.kind === "folder").map(item => item.value)
    );
    const syncing = phase === "running";
    const starting = phase === "starting";
    const report = status.lastSyncReport;
    const deltaExpired = report?.deltaExpired === true;
    const canSync = status.canConnect;

    return (
        <div>
            <div className="bg-line-2 mb-2.5 flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[13px]">
                <span className="text-brand flex">
                    <Icon size={16} />
                </span>
                <span className="text-ink min-w-0 truncate font-semibold">
                    {status.accountEmail ?? tc("status.connected")}
                </span>
                <span className="text-ink-3 ml-auto shrink-0 text-xs">
                    {syncStatusLabel(phase, status.lastSyncAt)}
                </span>
            </div>

            {phase === "stalled" ? <SyncStalledNotice /> : null}

            <p className="text-ink-3 mb-3 text-[12.5px]">
                {t.rich("syncedTo", {
                    folder: status.folder ?? "",
                    b: chunks => <strong className="text-ink-2">{chunks}</strong>,
                })}
            </p>

            {!canSync ? (
                <p className="border-line bg-warn-soft text-ink-2 mb-3 rounded-[10px] border px-3.5 py-2.5 text-[12.5px]">
                    {t("noPermissionConnected")}
                </p>
            ) : null}

            {status.lastSyncStatus === "error" && status.lastSyncError ? (
                <p
                    role="alert"
                    className="border-line text-danger mb-3 rounded-[10px] border px-3.5 py-2.5 text-[12.5px]"
                >
                    {t("lastSyncFailed", { error: status.lastSyncError })}
                </p>
            ) : null}

            {report && !syncing && !report.noScope ? (
                <p className="text-ink-3 mb-3 text-[12.5px]">
                    {t(deltaExpired ? "lastRunDeltaExpired" : "lastRun", {
                        conversations: reportCount(report, "conversations"),
                        attachments: reportCount(report, "attachments"),
                        unchanged: reportCount(report, "unchanged"),
                        failed: reportCount(report, "failed"),
                    })}
                </p>
            ) : null}

            <div className="text-ink-3 mb-2 text-xs font-semibold">
                {t("syncedHeading", { count: scope.length })}
            </div>
            <ul className="mb-3 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                {scope.length === 0 ? (
                    <li className="text-ink-3 text-[13px]">{t("nothingSelected")}</li>
                ) : (
                    scope.map(item => (
                        <li
                            key={item.id}
                            className="border-line flex items-center gap-2 rounded-lg border py-1 pl-3 pr-1 text-[13px]"
                        >
                            <span className="text-ink-3 flex shrink-0 items-center gap-1 text-[11px] font-semibold">
                                {item.kind === "folder" ? (
                                    <FolderClosed className="size-3.5" aria-hidden />
                                ) : (
                                    <Search className="size-3.5" aria-hidden />
                                )}
                                {item.kind === "folder" ? t("kindFolder") : t("kindSearch")}
                            </span>
                            <span
                                className={cn(
                                    "text-ink min-w-0 flex-1 truncate",
                                    item.kind === "query" && "font-mono"
                                )}
                            >
                                {item.name}
                            </span>
                            {canSync ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-ink-3 size-7"
                                    aria-label={t("stopSyncing", { name: item.name })}
                                    title={t("stopSyncing", { name: item.name })}
                                    onClick={() => void removeItem(item.id)}
                                >
                                    <X className="size-3.5" aria-hidden />
                                </Button>
                            ) : null}
                        </li>
                    ))
                )}
            </ul>

            {picking ? (
                <div className="border-line mb-3 rounded-[10px] border p-3">
                    <div className="text-ink text-[12.5px] font-semibold">
                        {t("chooseFoldersTitle")}
                    </div>
                    <p className="text-ink-3 mb-2 text-xs">{t("chooseFoldersHint")}</p>
                    <div className="mb-2.5 max-h-56 overflow-y-auto">
                        {!folderList || folderList.state === "loading" ? (
                            <div className="text-ink-3 flex items-center gap-2 py-1 text-[12.5px]">
                                <Spinner className="size-3.5" /> {t("loadingFolders")}
                            </div>
                        ) : folderList.state === "error" ? (
                            <div className="flex flex-wrap items-center gap-2 py-1">
                                <span role="alert" className="text-danger text-[12.5px]">
                                    {t("foldersLoadFailed")}
                                </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void loadFolders()}
                                >
                                    {t("retry")}
                                </Button>
                            </div>
                        ) : folderList.folders.length === 0 ? (
                            <div className="text-ink-3 py-1 text-[12.5px]">{t("noFolders")}</div>
                        ) : (
                            <FolderTree
                                parent={null}
                                depth={0}
                                folders={folderList.folders}
                                expanded={expanded}
                                selected={selected}
                                syncing={syncingFolders}
                                onToggleOpen={toggleOpen}
                                onToggleSelected={toggleSelected}
                                t={t}
                            />
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            disabled={busy || selected.size === 0}
                            onClick={() => void addFolders()}
                        >
                            {t("addFolders", { count: selected.size })}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={closePicker}>
                            {tc("actions.cancel")}
                        </Button>
                    </div>
                </div>
            ) : null}

            {canSync ? (
                <>
                    <form
                        onSubmit={event => {
                            event.preventDefault();
                            void addQuery();
                        }}
                        className="mb-1 flex gap-2"
                    >
                        <Input
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder={t("searchPlaceholder")}
                            aria-label={t("searchAria")}
                            className="flex-1 font-mono text-[13px]"
                        />
                        <Button
                            type="submit"
                            variant="outline"
                            disabled={busy || query.trim().length < 2}
                        >
                            {t("addSearch")}
                        </Button>
                    </form>
                    <p className="text-ink-3 mb-3 text-xs">{t("searchHint")}</p>
                </>
            ) : null}

            <div className="flex flex-wrap gap-2">
                {canSync ? (
                    <>
                        <Button disabled={busy || picking} onClick={openPicker}>
                            <FolderClosed aria-hidden />
                            {t("chooseFolders")}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={busy || syncing || starting || scope.length === 0}
                            onClick={() => void syncNow()}
                        >
                            <RefreshCw aria-hidden />
                            {syncing ? t("syncing") : starting ? t("starting") : t("syncNow")}
                        </Button>
                    </>
                ) : null}
                <Button
                    variant="ghost"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => setConfirmingDisconnect(true)}
                >
                    {t("disconnect")}
                </Button>
            </div>
            {disconnectDialog}
        </div>
    );
}
