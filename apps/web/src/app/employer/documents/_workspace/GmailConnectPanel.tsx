"use client";

/**
 * The Gmail connect panel — replaces the generic connect card for `gmail` in
 * AddSourceModal's Connect group.
 *
 * Gmail is personal: the connection is the signed-in member's own, and the
 * synced threads land in a folder only they (and folder admins) can see.
 *
 * States: loading → not-configured → not-connected → connected (chosen
 * labels and searches, label picker, search input, sync now, disconnect) →
 * syncing (polls status) → revoked (reconnect). All data comes from
 * /api/connectors/gmail.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X as IconX } from "lucide-react";

import type { AddSourceTab } from "./types";

interface ScopeRow {
    readonly id: string;
    readonly kind: "label" | "query";
    readonly value: string;
    readonly name: string;
}

interface GmailStatus {
    readonly configured: boolean;
    readonly connected: boolean;
    readonly canConnect: boolean;
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

interface LabelOption {
    readonly id: string;
    readonly name: string;
    readonly system: boolean;
}

const BASE = "/api/connectors/gmail";
const CONNECT_URL = "/api/connectors/google/oauth/start?provider=gmail";

async function fetchStatus(): Promise<GmailStatus | null> {
    const res = await fetch(BASE);
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: GmailStatus };
    return payload.data ?? null;
}

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

export function GmailConnectPanel({ tab }: { tab: AddSourceTab }) {
    const Icon = tab.Icon;
    const [status, setStatus] = useState<GmailStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
    const [labels, setLabels] = useState<LabelOption[] | null>(null);
    const [labelsError, setLabelsError] = useState<string | null>(null);
    const [pickingLabels, setPickingLabels] = useState(false);
    const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
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

    const startSync = useCallback(async (): Promise<boolean> => {
        const res = await postJson(`${BASE}/sync`, "POST", {});
        if (res.ok) {
            setStatus(prev => (prev ? { ...prev, lastSyncStatus: "running" } : prev));
            return true;
        }
        return false;
    }, []);

    const openLabelPicker = useCallback(async () => {
        setPickingLabels(true);
        setLabelsError(null);
        if (labels) return;
        const res = await fetch(`${BASE}/labels`);
        if (!res.ok) {
            setLabelsError("Could not load your labels — try reconnecting Gmail.");
            return;
        }
        const payload = (await res.json()) as { data?: { labels?: LabelOption[] } };
        setLabels(payload.data?.labels ?? []);
    }, [labels]);

    const addLabels = useCallback(async () => {
        if (!labels || selectedLabelIds.size === 0) return;
        setBusy(true);
        try {
            const items = labels
                .filter(label => selectedLabelIds.has(label.id))
                .map(label => ({ kind: "label" as const, value: label.id, name: label.name }));
            const res = await postJson(`${BASE}/items`, "POST", { items });
            if (!res.ok) {
                toast.error("Could not save the selection");
                return;
            }
            toast.success(`${items.length} label(s) added — syncing`);
            setSelectedLabelIds(new Set());
            setPickingLabels(false);
            await refresh();
            await startSync();
        } finally {
            setBusy(false);
        }
    }, [labels, selectedLabelIds, refresh, startSync]);

    const addQuery = useCallback(async () => {
        const value = query.trim();
        if (value.length < 2) return;
        setBusy(true);
        try {
            const res = await postJson(`${BASE}/items`, "POST", {
                items: [{ kind: "query", value }],
            });
            if (!res.ok) {
                toast.error("Could not save the search");
                return;
            }
            toast.success("Search added — syncing");
            setQuery("");
            await refresh();
            await startSync();
        } finally {
            setBusy(false);
        }
    }, [query, refresh, startSync]);

    const removeItem = useCallback(
        async (id: string) => {
            await postJson(`${BASE}/items`, "DELETE", { ids: [id] });
            void refresh();
        },
        [refresh]
    );

    const syncNow = useCallback(async () => {
        setBusy(true);
        try {
            if (await startSync()) toast.success("Sync started");
            else toast.error("Could not start the sync");
        } finally {
            setBusy(false);
        }
    }, [startSync]);

    const disconnect = useCallback(async () => {
        setBusy(true);
        try {
            const res = await fetch(BASE, { method: "DELETE" });
            if (res.ok) toast.success("Gmail disconnected — synced emails were kept");
            else toast.error("Disconnect failed");
            setConfirmingDisconnect(false);
            setLabels(null);
            void refresh();
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    if (loading) {
        return (
            <div style={{ padding: 24, fontSize: 13, color: "var(--ink-3)" }}>Checking Gmail…</div>
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
                    Gmail is not enabled on this server
                </div>
                Ask your operator to set <code>GMAIL_CONNECTOR_ENABLED=true</code> alongside the
                Google OAuth client — the steps, including the Gmail scope on the consent screen,
                are in <code>.env.example</code> under &ldquo;Gmail&rdquo;.
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
                            {reconnect ? "Reconnect your Gmail" : "Connect your Gmail"}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                            {reconnect
                                ? `Google access was revoked or expired${status.statusDetail ? ` (${status.statusDetail})` : ""} — connect again to resume syncing.`
                                : "Read-only. Pick labels or searches afterwards; threads land in a folder only you can see."}
                        </div>
                    </div>
                </div>
                {status.canConnect ? (
                    <button
                        onClick={() => {
                            window.location.href = status.connectUrl ?? CONNECT_URL;
                        }}
                        style={{ ...buttonStyle("primary", false), width: "100%", padding: 12 }}
                    >
                        {reconnect ? "Reconnect Gmail" : "Connect Gmail"}
                    </button>
                ) : (
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                        Your role can&rsquo;t add sources to this workspace, so it can&rsquo;t
                        connect a mailbox. Ask an admin for upload access.
                    </div>
                )}
            </div>
        );
    }

    const scope = status.scope ?? [];
    const syncing = status.lastSyncStatus === "running";
    const report = status.lastSyncReport;
    const historyExpired = report?.historyExpired === true;

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
                    marginBottom: 10,
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

            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>
                Synced threads go to{" "}
                <strong style={{ color: "var(--ink-2)" }}>{status.folder}</strong>, a folder only
                you and folder admins can see. Every 15 minutes, read-only.
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

            {report && !syncing && !report.noScope ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>
                    Last run: {reportCount(report, "threads")} thread(s) and{" "}
                    {reportCount(report, "attachments")} attachment(s) imported,{" "}
                    {reportCount(report, "unchanged")} unchanged, {reportCount(report, "failed")}{" "}
                    failed.
                    {historyExpired
                        ? " Gmail's change history had expired, so everything was re-checked."
                        : ""}
                </div>
            ) : null}

            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 8 }}>
                SYNCED FROM GMAIL ({scope.length})
            </div>
            <ul
                style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginBottom: 12,
                    maxHeight: 160,
                    overflowY: "auto",
                }}
            >
                {scope.length === 0 ? (
                    <li style={{ fontSize: 13, color: "var(--ink-3)" }}>
                        Nothing selected yet — choose labels or add a search to start syncing.
                    </li>
                ) : (
                    scope.map(item => (
                        <li
                            key={item.id}
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
                            <span
                                style={{
                                    color: "var(--ink-3)",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    letterSpacing: 0.3,
                                    textTransform: "uppercase",
                                }}
                            >
                                {item.kind === "label" ? "Label" : "Search"}
                            </span>
                            <span
                                style={{
                                    flex: 1,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontFamily:
                                        item.kind === "query" ? "var(--font-mono)" : undefined,
                                }}
                            >
                                {item.name}
                            </span>
                            <button
                                onClick={() => void removeItem(item.id)}
                                title="Stop syncing (keeps imported emails)"
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

            {pickingLabels ? (
                <div
                    style={{
                        border: "1px solid var(--line)",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 12,
                    }}
                >
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
                        Choose labels to sync
                    </div>
                    {labelsError ? (
                        <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{labelsError}</div>
                    ) : !labels ? (
                        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Loading labels…</div>
                    ) : labels.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                            No labels found in this mailbox.
                        </div>
                    ) : (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                maxHeight: 180,
                                overflowY: "auto",
                                marginBottom: 10,
                            }}
                        >
                            {labels.map(label => {
                                const already = scope.some(
                                    item => item.kind === "label" && item.value === label.id
                                );
                                const checked = already || selectedLabelIds.has(label.id);
                                return (
                                    <label
                                        key={label.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            fontSize: 13,
                                            color: already ? "var(--ink-3)" : "var(--ink)",
                                            cursor: already ? "default" : "pointer",
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={already}
                                            onChange={event => {
                                                setSelectedLabelIds(prev => {
                                                    const next = new Set(prev);
                                                    if (event.target.checked) next.add(label.id);
                                                    else next.delete(label.id);
                                                    return next;
                                                });
                                            }}
                                        />
                                        <span>{label.name}</span>
                                        {label.system ? (
                                            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                                                system
                                            </span>
                                        ) : null}
                                        {already ? (
                                            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                                                syncing
                                            </span>
                                        ) : null}
                                    </label>
                                );
                            })}
                        </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            disabled={busy || selectedLabelIds.size === 0}
                            onClick={() => void addLabels()}
                            style={buttonStyle("primary", busy || selectedLabelIds.size === 0)}
                        >
                            Add {selectedLabelIds.size > 0 ? `${selectedLabelIds.size} ` : ""}
                            label{selectedLabelIds.size === 1 ? "" : "s"}
                        </button>
                        <button
                            onClick={() => {
                                setPickingLabels(false);
                                setSelectedLabelIds(new Set());
                            }}
                            style={buttonStyle("quiet", false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}

            <form
                onSubmit={event => {
                    event.preventDefault();
                    void addQuery();
                }}
                style={{ display: "flex", gap: 8, marginBottom: 12 }}
            >
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Gmail search, e.g. from:investor@fund.com newer_than:1y"
                    aria-label="Gmail search to sync"
                    style={{
                        flex: 1,
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        color: "var(--ink)",
                        fontSize: 13,
                        fontFamily: "var(--font-mono)",
                    }}
                />
                <button
                    type="submit"
                    disabled={busy || query.trim().length < 2}
                    style={buttonStyle("quiet", busy || query.trim().length < 2)}
                >
                    Add search
                </button>
            </form>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                    disabled={busy || pickingLabels}
                    onClick={() => void openLabelPicker()}
                    style={buttonStyle("primary", busy || pickingLabels)}
                >
                    Choose labels
                </button>
                <button
                    disabled={busy || syncing || scope.length === 0}
                    onClick={() => void syncNow()}
                    style={buttonStyle("quiet", busy || syncing || scope.length === 0)}
                >
                    {syncing ? "Syncing…" : "Sync now"}
                </button>
                {confirmingDisconnect ? (
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                            Disconnect? Imported emails are kept.
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
