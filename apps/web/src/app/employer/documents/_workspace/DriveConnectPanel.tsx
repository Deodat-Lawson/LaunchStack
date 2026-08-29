"use client";

/**
 * The real Google Drive connect panel — replaces the generic connect card for
 * `drive` in AddSourceModal's Connect group.
 *
 * States: loading → not-configured → not-connected → connected (picked list,
 * pick more, sync now, disconnect) → syncing (polls status) → revoked
 * (reconnect). All data comes from /api/connectors/google-drive/status; the
 * Picker's public config rides on the status payload, so no client env
 * inlining. With several Drive accounts connected, this panel manages the
 * primary (oldest) connection; the rest are listed under Settings →
 * Integrations.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X as IconX } from "lucide-react";

import type { AddSourceTab } from "./types";
import { useGooglePicker, type PickedDoc } from "./useGooglePicker";

interface PickedItem {
    readonly fileId: string;
    readonly kind: string;
    readonly name: string;
    readonly mimeType: string | null;
}

interface DriveStatus {
    readonly configured: boolean;
    readonly connected: boolean;
    readonly connectionId?: string;
    readonly status?: string;
    readonly accountEmail?: string | null;
    readonly pickedItems?: readonly PickedItem[];
    readonly lastSyncAt?: string | null;
    readonly lastSyncStatus?: string | null;
    readonly lastSyncError?: string | null;
    readonly lastSyncReport?: Record<string, unknown> | null;
    readonly picker: { readonly apiKey: string | null; readonly appId: string | null };
}

const BASE = "/api/connectors/google-drive";

async function fetchStatus(): Promise<DriveStatus | null> {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: DriveStatus };
    return payload.data ?? null;
}

function reportCount(report: Record<string, unknown> | null | undefined, key: string): number {
    const value = report?.[key];
    return typeof value === "number" ? value : 0;
}

const buttonStyle = (variant: "primary" | "quiet" | "danger", disabled: boolean) =>
    ({
        padding: "10px 16px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        border: variant === "quiet" ? "1px solid var(--line)" : "none",
        background: disabled
            ? "var(--line)"
            : variant === "primary"
              ? "var(--accent)"
              : variant === "danger"
                ? "var(--danger)"
                : "var(--panel)",
        color: disabled ? "var(--ink-3)" : variant === "quiet" ? "var(--ink-2)" : "white",
    }) as const;

export function DriveConnectPanel({ tab }: { tab: AddSourceTab }) {
    const Icon = tab.Icon;
    const [status, setStatus] = useState<DriveStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
    const { openPicker, opening } = useGooglePicker();
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const refresh = useCallback(async () => {
        const next = await fetchStatus();
        if (next) setStatus(next);
        setLoading(false);
        return next;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Poll while a sync is running so the counts land without a manual refresh.
    useEffect(() => {
        if (status?.lastSyncStatus === "running" && !pollRef.current) {
            pollRef.current = setInterval(() => void refresh(), 3000);
        }
        if (status?.lastSyncStatus !== "running" && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [status?.lastSyncStatus, refresh]);

    const handlePicked = useCallback(
        async (docs: readonly PickedDoc[]) => {
            const res = await fetch(`${BASE}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: docs }),
            });
            if (res.ok) {
                toast.success(`${docs.length} item(s) added — syncing`);
                await fetch(`${BASE}/sync`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
            } else {
                toast.error("Could not save the selection");
            }
            void refresh();
        },
        [refresh]
    );

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
                apiKey: status.picker.apiKey,
                appId: status.picker.appId,
                accessToken,
                onPicked: docs => void handlePicked(docs),
            });
        } finally {
            setBusy(false);
        }
    }, [status, openPicker, handlePicked]);

    const syncNow = useCallback(async () => {
        setBusy(true);
        try {
            const res = await fetch(`${BASE}/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (res.ok) {
                toast.success("Sync started");
                setStatus(prev => (prev ? { ...prev, lastSyncStatus: "running" } : prev));
            } else {
                toast.error("Could not start the sync");
            }
        } finally {
            setBusy(false);
        }
    }, []);

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
        return (
            <div style={{ padding: 24, fontSize: 13, color: "var(--ink-3)" }}>
                Checking Google Drive…
            </div>
        );
    }

    if (!status?.configured) {
        return (
            <div
                style={{
                    padding: "16px 18px",
                    background: "var(--line-2)",
                    borderRadius: 12,
                    fontSize: 13,
                    color: "var(--ink-2)",
                    lineHeight: 1.6,
                }}
            >
                <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
                    Google Drive is not configured on this server
                </div>
                Ask your operator to set <code>GOOGLE_DRIVE_CLIENT_ID</code>,{" "}
                <code>GOOGLE_DRIVE_CLIENT_SECRET</code> and the Picker keys — the steps are in{" "}
                <code>.env.example</code> under &ldquo;Workspace connections&rdquo;.
            </div>
        );
    }

    if (!status.connected || status.status !== "active") {
        const reconnect = status.connected && status.status !== "active";
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
                            color: "var(--accent)",
                        }}
                    >
                        <Icon size={22} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>
                            {reconnect ? "Reconnect Google Drive" : "Connect Google Drive"}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                            {reconnect
                                ? "Google access was revoked or expired — connect again to resume syncing."
                                : "Pick files and folders in Google's picker; only what you pick is shared."}
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => {
                        window.location.href = `${BASE}/oauth/start`;
                    }}
                    style={{ ...buttonStyle("primary", false), width: "100%", padding: 12 }}
                >
                    {reconnect ? "Reconnect Google Drive" : "Connect Google Drive"}
                </button>
            </div>
        );
    }

    const picked = status.pickedItems ?? [];
    const syncing = status.lastSyncStatus === "running";
    const report = status.lastSyncReport;
    const accessLost = reportCount(report, "accessLost");

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    background: "var(--line-2)",
                    borderRadius: 10,
                    marginBottom: 14,
                    fontSize: 13,
                }}
            >
                <span style={{ color: "var(--accent)", display: "flex" }}>
                    <Icon size={16} />
                </span>
                <span style={{ fontWeight: 600 }}>{status.accountEmail ?? "Connected"}</span>
                <span style={{ marginLeft: "auto", color: "var(--ink-3)", fontSize: 12 }}>
                    {syncing
                        ? "Syncing…"
                        : status.lastSyncAt
                          ? `Last sync ${new Date(status.lastSyncAt).toLocaleString()}`
                          : "Not synced yet"}
                </span>
            </div>

            {status.lastSyncStatus === "error" && status.lastSyncError ? (
                <div
                    style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid var(--line)",
                        color: "var(--danger)",
                        fontSize: 12.5,
                        marginBottom: 12,
                    }}
                >
                    Last sync failed: {status.lastSyncError}
                </div>
            ) : null}

            {report && !syncing ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>
                    Last run: {reportCount(report, "stored")} imported,{" "}
                    {reportCount(report, "unchanged")} unchanged, {reportCount(report, "failed")}{" "}
                    failed.
                </div>
            ) : null}

            {accessLost > 0 ? (
                <div
                    style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        background: "var(--line-2)",
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                        marginBottom: 12,
                    }}
                >
                    {accessLost} file(s) are no longer accessible — files added to a folder after
                    you picked it need re-picking. Open the picker and select the folder again to
                    refresh access.
                </div>
            ) : null}

            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 8 }}>
                SYNCED FROM DRIVE ({picked.length})
            </div>
            <ul
                style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginBottom: 16,
                    maxHeight: 180,
                    overflowY: "auto",
                }}
            >
                {picked.length === 0 ? (
                    <li style={{ fontSize: 13, color: "var(--ink-3)" }}>
                        Nothing picked yet — choose files or folders to start syncing.
                    </li>
                ) : (
                    picked.map(item => (
                        <li
                            key={item.fileId}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: "1px solid var(--line)",
                                fontSize: 13,
                            }}
                        >
                            <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                                {item.kind === "folder" ? "📁" : "📄"}
                            </span>
                            <span
                                style={{
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {item.name}
                            </span>
                            <button
                                onClick={() => void removeItem(item.fileId)}
                                title="Stop syncing (keeps imported documents)"
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--ink-3)",
                                    cursor: "pointer",
                                    display: "flex",
                                    padding: 2,
                                }}
                            >
                                <IconX size={14} />
                            </button>
                        </li>
                    ))
                )}
            </ul>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                    disabled={busy || opening}
                    onClick={() => void choose()}
                    style={buttonStyle("primary", busy || opening)}
                >
                    {opening ? "Opening picker…" : "Choose files & folders"}
                </button>
                <button
                    disabled={busy || syncing || picked.length === 0}
                    onClick={() => void syncNow()}
                    style={buttonStyle("quiet", busy || syncing || picked.length === 0)}
                >
                    {syncing ? "Syncing…" : "Sync now"}
                </button>
                {confirmingDisconnect ? (
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                            Disconnect? Imported documents are kept.
                        </span>
                        <button
                            disabled={busy}
                            onClick={() => void disconnect()}
                            style={buttonStyle("danger", busy)}
                        >
                            Disconnect
                        </button>
                        <button
                            onClick={() => setConfirmingDisconnect(false)}
                            style={buttonStyle("quiet", false)}
                        >
                            Cancel
                        </button>
                    </span>
                ) : (
                    <button
                        onClick={() => setConfirmingDisconnect(true)}
                        style={{ ...buttonStyle("quiet", false), marginLeft: "auto" }}
                    >
                        Disconnect
                    </button>
                )}
            </div>
        </div>
    );
}
