"use client";

/**
 * The real Google Drive connect panel — replaces the generic connect card for
 * `drive` in AddSourceModal's Connect group.
 *
 * States: loading → not-configured → not-connected → connected (picked list,
 * pick more, paste a folder link, sync now, disconnect) → syncing (polls
 * status) → revoked (reconnect). A sync that was requested but never starts
 * says so (see useConnectorSync). All data comes from
 * /api/connectors/google-drive/status; the Picker's public config rides on
 * the status payload, so no client env inlining. With several Drive accounts
 * connected, this panel manages the primary (oldest) connection; the rest
 * are listed under Settings → Integrations.
 *
 * Whether a picked folder brings its contents depends on the grant
 * (`folderAccess`, see driveStatus.ts): with drive.readonly it imports whole;
 * a connection made before folder import was turned on needs one reconnect;
 * and where the operator hasn't turned it on, only files picked one by one
 * come in — the panel says so rather than letting a folder import nothing.
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Folder, FolderOpen, Info, Link2, TriangleAlert, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { driveIdFromLink } from "~/lib/integrations/google-drive-link";

import {
    emptyFolderNames,
    folderAccessState,
    listNames,
    pickedItemDestination,
    reportCount,
    type DriveStatus,
    type FolderAccessState,
} from "./driveStatus";
import { SyncStalledNotice } from "./SyncStalledNotice";
import type { AddSourceTab } from "./types";
import { syncStatusLabel, useConnectorSync } from "./useConnectorSync";
import { useGooglePicker, type PickedDoc } from "./useGooglePicker";

const BASE = "/api/connectors/google-drive";
const CONNECT_URL = "/api/connectors/google/oauth/start";

async function fetchStatus(): Promise<DriveStatus | null> {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: DriveStatus };
    return payload.data ?? null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { message?: string };
        return body.message ?? fallback;
    } catch {
        return fallback;
    }
}

function Notice({
    tone,
    children,
}: {
    tone: "info" | "warn" | "danger";
    children: React.ReactNode;
}) {
    const Icon = tone === "info" ? Info : TriangleAlert;
    const tones = {
        info: "border-line bg-panel-2 text-ink-2",
        warn: "border-warn bg-warn-soft text-ink",
        danger: "border-danger bg-danger-soft text-ink",
    } as const;
    return (
        <div
            className={`mb-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${tones[tone]}`}
        >
            <Icon
                className={`mt-0.5 size-4 shrink-0 ${tone === "info" ? "text-ink-3" : tone === "warn" ? "text-warn" : "text-danger"}`}
            />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

export function DriveConnectPanel({
    tab,
    onFolderAccess,
    onImported,
}: {
    tab: AddSourceTab;
    /**
     * Something was picked, a link pasted, or a sync started by hand — files
     * are on their way in. The workspace closes the dialog and opens the
     * Processing tab, which follows the sync and each file. A background
     * sync (the 15-minute schedule) never calls this.
     */
    onImported?: () => void;
    /**
     * Whether a picked folder can import right now (null until known, or
     * while not connected): the modal's destination bar only promises a
     * folder of its own when it can.
     */
    onFolderAccess?: (state: FolderAccessState | null) => void;
}) {
    const Icon = tab.Icon;
    const [status, setStatus] = useState<DriveStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
    const [link, setLink] = useState("");
    const [linkError, setLinkError] = useState<string | null>(null);
    const [addingLink, setAddingLink] = useState(false);
    const { openPicker, opening } = useGooglePicker();

    const refresh = useCallback(async () => {
        const next = await fetchStatus().catch(() => null);
        if (next) setStatus(next);
        // A failed check is not "not configured": keep the last good status
        // and say the check failed.
        setLoadFailed(next === null);
        setLoading(false);
        return next;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const liveAccess =
        status?.configured && status.connected && status.status === "active"
            ? folderAccessState(status)
            : null;
    useEffect(() => {
        onFolderAccess?.(liveAccess);
    }, [liveAccess, onFolderAccess]);

    // Polls while a sync is starting or running, so the counts land without
    // a manual refresh.
    const { phase, requestSync } = useConnectorSync(status, refresh, `${BASE}/sync`);

    /** After something was added: request the sync; the hook follows it. */
    const syncAfterAdd = useCallback(async () => {
        if (!(await requestSync())) toast.error("Added, but the sync didn't start — try Sync now");
        void refresh();
    }, [refresh, requestSync]);

    const handlePicked = useCallback(
        async (docs: readonly PickedDoc[]) => {
            const res = await fetch(`${BASE}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: docs }),
            });
            if (res.ok) {
                toast.success(
                    docs.length === 1
                        ? `“${docs[0]!.name}” added — syncing`
                        : `${docs.length} items added — syncing`
                );
                await syncAfterAdd();
                onImported?.();
            } else {
                toast.error(await errorMessage(res, "Could not save the selection"));
                void refresh();
            }
        },
        [refresh, syncAfterAdd, onImported]
    );

    const addLink = useCallback(async () => {
        const value = link.trim();
        if (!driveIdFromLink(value)) {
            setLinkError("That isn't a Google Drive link. In Drive, use Share › Copy link.");
            return;
        }
        setAddingLink(true);
        setLinkError(null);
        try {
            const res = await fetch(`${BASE}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ link: value }),
            });
            if (!res.ok) {
                setLinkError(await errorMessage(res, "Could not add that link"));
                return;
            }
            const payload = (await res.json()) as { message?: string };
            toast.success(`${payload.message ?? "Added."} Syncing now.`);
            setLink("");
            await syncAfterAdd();
            onImported?.();
        } finally {
            setAddingLink(false);
        }
    }, [link, syncAfterAdd, onImported]);

    const choose = useCallback(async () => {
        if (!status?.picker.apiKey || !status.picker.appId) {
            toast.error(
                "Picker is not configured — set NEXT_PUBLIC_GOOGLE_API_KEY and NEXT_PUBLIC_GOOGLE_APP_ID"
            );
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(`${BASE}/picker-token`);
            if (!res.ok) {
                toast.error("Could not get Drive access — try reconnecting");
                return;
            }
            const payload = (await res.json()) as { data?: { accessToken?: string } };
            const accessToken = payload.data?.accessToken;
            if (!accessToken) {
                toast.error("Could not get Drive access — try reconnecting");
                return;
            }
            await openPicker({
                scriptUrl: status.picker.scriptUrl,
                apiKey: status.picker.apiKey,
                appId: status.picker.appId,
                accessToken,
                onPicked: docs => void handlePicked(docs),
            });
        } catch {
            toast.error("Google's picker didn't load — check your connection and try again");
        } finally {
            setBusy(false);
        }
    }, [status, openPicker, handlePicked]);

    const syncNow = useCallback(async () => {
        setBusy(true);
        try {
            if (await requestSync()) {
                toast.success("Sync requested");
                onImported?.();
            } else toast.error("Could not start the sync");
        } finally {
            setBusy(false);
        }
    }, [requestSync, onImported]);

    const removeItem = useCallback(
        async (fileId: string) => {
            await fetch(`${BASE}/items`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fileIds: [fileId] }),
            });
            void refresh();
        },
        [refresh]
    );

    const disconnect = useCallback(async () => {
        if (!status?.connectionId) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/connectors/connections/${status.connectionId}`, {
                method: "DELETE",
            });
            if (res.ok) toast.success("Google Drive disconnected — documents were kept");
            else toast.error("Disconnect failed");
            setConfirmingDisconnect(false);
            void refresh();
        } finally {
            setBusy(false);
        }
    }, [refresh, status?.connectionId]);

    if (loading) {
        return <div className="text-ink-3 p-6 text-[13px]">Checking Google Drive…</div>;
    }

    if (!status && loadFailed) {
        return (
            <Notice tone="danger">
                Couldn&rsquo;t check Google Drive just now.
                <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => void refresh()}>
                        Try again
                    </Button>
                </div>
            </Notice>
        );
    }

    if (!status?.configured) {
        return (
            <div className="bg-panel-2 text-ink-2 rounded-xl px-4 py-4 text-[13px] leading-relaxed">
                <div className="text-ink mb-1.5 font-semibold">
                    Google Drive is not configured on this server
                </div>
                Ask your operator to set <code>GOOGLE_OAUTH_CLIENT_ID</code>,{" "}
                <code>GOOGLE_OAUTH_CLIENT_SECRET</code> and the Picker keys — the steps are in{" "}
                <code>.env.example</code> under &ldquo;Workspace connections&rdquo;.
            </div>
        );
    }

    if (!status.connected || status.status !== "active") {
        const reconnect = status.connected && status.status !== "active";
        const folderImport = status.folderAccess?.enabled ?? false;
        return (
            <div>
                <div className="bg-panel-2 mb-4 flex items-center gap-3.5 rounded-xl px-4 py-4">
                    <div className="bg-panel border-line text-brand flex size-11 shrink-0 items-center justify-center rounded-lg border">
                        <Icon size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-ink text-[15px] font-semibold">
                            {reconnect ? "Reconnect Google Drive" : "Connect Google Drive"}
                        </div>
                        <div className="text-ink-3 text-[13px]">
                            {reconnect
                                ? "Google access was revoked or expired — connect again to resume syncing."
                                : folderImport
                                  ? "LaunchStack can read what this Google account can open, and imports only the files and folders you pick or paste."
                                  : "Pick files in Google's picker; only what you pick is shared."}
                        </div>
                    </div>
                </div>
                <Button
                    className="w-full"
                    size="lg"
                    onClick={() => {
                        window.location.href = CONNECT_URL;
                    }}
                >
                    {reconnect ? "Reconnect Google Drive" : "Connect Google Drive"}
                </Button>
            </div>
        );
    }

    const picked = status.pickedItems ?? [];
    const syncing = phase === "running";
    const starting = phase === "starting";
    const report = status.lastSyncReport;
    const accessLost = reportCount(report, "accessLost");
    const access = folderAccessState(status);
    const empty = syncing ? [] : emptyFolderNames(status);

    return (
        <div>
            <div className="bg-panel-2 mb-3.5 flex flex-wrap items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px]">
                <span className="text-brand flex">
                    <Icon size={16} />
                </span>
                <span className="text-ink min-w-0 truncate font-semibold">
                    {status.accountEmail ?? "Connected"}
                </span>
                <span className="text-ink-3 ml-auto text-xs">
                    {syncStatusLabel(phase, status.lastSyncAt)}
                </span>
            </div>

            {phase === "stalled" ? <SyncStalledNotice /> : null}

            {access === "allow" ? (
                <Notice tone="warn">
                    <div className="text-ink font-semibold">
                        Allow folder access to import folders
                    </div>
                    This connection can only open files picked one by one, so a folder brings
                    nothing from inside it. Reconnect once and allow LaunchStack to read your Drive;
                    then folders come in whole, subfolders and later additions included.
                    <div className="mt-2">
                        <Button
                            size="sm"
                            onClick={() => {
                                window.location.href = CONNECT_URL;
                            }}
                        >
                            Allow folder access
                        </Button>
                    </div>
                </Notice>
            ) : access === "files-only" ? (
                <Notice tone="info">
                    Only files you pick one by one come in. Picking a folder brings nothing from
                    inside it, because this server hasn&rsquo;t turned on folder import — open the
                    folder in the picker and select its files instead. Operators: see{" "}
                    <code>GOOGLE_DRIVE_FOLDER_ACCESS_ENABLED</code> in <code>.env.example</code>.
                </Notice>
            ) : null}

            {status.lastSyncStatus === "error" && status.lastSyncError ? (
                <Notice tone="danger">Last sync failed: {status.lastSyncError}</Notice>
            ) : null}

            {report && !syncing ? (
                <div className="text-ink-3 mb-3 text-[12.5px]">
                    Last run: {reportCount(report, "stored")} imported,{" "}
                    {reportCount(report, "unchanged")} unchanged, {reportCount(report, "failed")}{" "}
                    failed.
                </div>
            ) : null}

            {empty.length > 0 ? (
                <Notice tone="warn">
                    {access === "ready"
                        ? `Nothing came in from ${listNames(empty)} — Drive lists ${empty.length === 1 ? "it" : "them"} as empty.`
                        : `Nothing came in from ${listNames(empty)}: this connection can't see inside folders.`}
                </Notice>
            ) : null}

            {accessLost > 0 ? (
                <Notice tone="warn">
                    {accessLost} file(s) can no longer be opened — deleted, unshared, or (for files
                    picked one by one) the grant is gone. Pick them again to refresh access.
                </Notice>
            ) : null}

            {access === "ready" ? (
                <form
                    className="mb-4"
                    onSubmit={event => {
                        event.preventDefault();
                        void addLink();
                    }}
                >
                    <label
                        htmlFor="drive-folder-link"
                        className="text-ink-3 mb-1.5 block text-xs font-semibold"
                    >
                        Paste a folder link
                    </label>
                    <div className="flex gap-2 max-sm:flex-col">
                        <div className="relative min-w-0 flex-1">
                            <Link2 className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                            <Input
                                id="drive-folder-link"
                                value={link}
                                onChange={event => {
                                    setLink(event.target.value);
                                    setLinkError(null);
                                }}
                                placeholder="https://drive.google.com/drive/folders/…"
                                aria-invalid={linkError ? true : undefined}
                                aria-describedby={linkError ? "drive-folder-link-error" : undefined}
                                className="pl-8"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <Button
                            type="submit"
                            variant="outline"
                            disabled={addingLink || !link.trim()}
                        >
                            {addingLink ? "Adding…" : "Add folder"}
                        </Button>
                    </div>
                    {linkError ? (
                        <p id="drive-folder-link-error" className="text-danger mt-1.5 text-xs">
                            {linkError}
                        </p>
                    ) : (
                        <p className="text-ink-3 mt-1.5 text-xs">
                            Works for any folder {status.accountEmail ?? "this account"} can open,
                            including ones shared with it and shared drives.
                        </p>
                    )}
                </form>
            ) : null}

            <div className="text-ink-3 mb-2 text-xs font-semibold">
                SYNCED FROM DRIVE ({picked.length})
            </div>
            <ul className="mb-4 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {picked.length === 0 ? (
                    <li className="text-ink-3 text-[13px]">
                        Nothing yet — choose files or folders to start syncing.
                    </li>
                ) : (
                    picked.map(item => {
                        const ItemIcon =
                            item.kind === "folder"
                                ? item.folderPath
                                    ? FolderOpen
                                    : Folder
                                : FileText;
                        return (
                            <li
                                key={item.fileId}
                                className="border-line flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]"
                            >
                                <ItemIcon className="text-ink-3 size-4 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block truncate">{item.name}</span>
                                    <span className="text-ink-3 block truncate text-[11.5px]">
                                        {pickedItemDestination(item, access)}
                                    </span>
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => void removeItem(item.fileId)}
                                    title="Stop syncing (keeps imported documents)"
                                    aria-label={`Stop syncing ${item.name}`}
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </li>
                        );
                    })
                )}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy || opening} onClick={() => void choose()}>
                    {opening ? "Opening picker…" : "Choose in Google Drive"}
                </Button>
                <Button
                    variant="outline"
                    disabled={busy || syncing || starting || picked.length === 0}
                    onClick={() => void syncNow()}
                >
                    {syncing ? "Syncing…" : starting ? "Starting…" : "Sync now"}
                </Button>
                {confirmingDisconnect ? (
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-2 text-[12.5px]">
                            Disconnect? Imported documents are kept.
                        </span>
                        <Button
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void disconnect()}
                        >
                            Disconnect
                        </Button>
                        <Button variant="outline" onClick={() => setConfirmingDisconnect(false)}>
                            Cancel
                        </Button>
                    </span>
                ) : (
                    <Button
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => setConfirmingDisconnect(true)}
                    >
                        Disconnect
                    </Button>
                )}
            </div>
        </div>
    );
}
