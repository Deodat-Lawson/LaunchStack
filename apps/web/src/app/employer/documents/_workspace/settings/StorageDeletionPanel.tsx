"use client";

import { useCallback, useEffect, useState } from "react";

interface StorageMetrics {
    generatedAt: string;
    flags: {
        lifecycleEnabled: boolean;
        workerEnabled: boolean;
    };
    backlog: {
        requests: number;
        oldestAgeSeconds: number | null;
        retries: number;
        blockedRequests: number;
        quarantinedRequests: number;
    };
    providerCleanup: {
        pendingItems: number;
        completedItems: number;
        blockedItems: number;
    };
    sqlPurge: {
        completedRequests: number;
        pendingRequests: number;
    };
    estimatedOrphanBytes: {
        bytes: number;
        source: string;
    };
}

function formatAge(seconds: number | null): string {
    if (seconds === null) return "—";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3_600)}h`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1_024) return `${bytes} B`;
    if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
    return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function StorageDeletionPanel() {
    const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const loadMetrics = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/storage/deletion-metrics");
            const body = (await response.json().catch(() => ({}))) as {
                success?: boolean;
                error?: string;
            } & Partial<StorageMetrics>;
            if (!response.ok || !body.success) {
                throw new Error(body.error ?? `Failed (${response.status})`);
            }
            setMetrics(body as StorageMetrics);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Failed to load deletion metrics");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMetrics();
    }, [loadMetrics]);

    if (loading && !metrics)
        return <p style={{ color: "var(--ink-3)" }}>Loading storage operations…</p>;
    if (error && !metrics) {
        return <p style={{ color: "var(--danger)" }}>{error}</p>;
    }
    if (!metrics) return null;

    return (
        <div style={{ maxWidth: 760 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                    marginBottom: 22,
                }}
            >
                <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 13, lineHeight: 1.55 }}>
                    Read-only operational view of the deletion outbox, provider cleanup, and
                    relational purge. A disabled flag pauses that stage; it does not discard queued
                    work.
                </p>
                <button
                    type="button"
                    onClick={() => void loadMetrics()}
                    disabled={loading}
                    style={{
                        flexShrink: 0,
                        border: "1px solid var(--line)",
                        borderRadius: 7,
                        background: "var(--panel)",
                        padding: "7px 11px",
                        color: "var(--ink-2)",
                        cursor: loading ? "wait" : "pointer",
                    }}
                >
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
            </div>

            {error && <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p>}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 1,
                    border: "1px solid var(--line)",
                    background: "var(--line)",
                }}
            >
                <Metric
                    label="Lifecycle flag"
                    value={metrics.flags.lifecycleEnabled ? "enabled" : "off"}
                />
                <Metric
                    label="Worker flag"
                    value={metrics.flags.workerEnabled ? "enabled" : "off"}
                />
                <Metric label="Requests in backlog" value={String(metrics.backlog.requests)} />
                <Metric
                    label="Oldest request"
                    value={formatAge(metrics.backlog.oldestAgeSeconds)}
                />
                <Metric label="Items retried" value={String(metrics.backlog.retries)} />
                <Metric label="Manual review" value={String(metrics.backlog.blockedRequests)} />
                <Metric
                    label="Quarantined requests"
                    value={String(metrics.backlog.quarantinedRequests)}
                />
                <Metric
                    label="Provider items pending"
                    value={String(metrics.providerCleanup.pendingItems)}
                />
                <Metric
                    label="Provider items blocked"
                    value={String(metrics.providerCleanup.blockedItems)}
                />
                <Metric
                    label="SQL purges complete"
                    value={String(metrics.sqlPurge.completedRequests)}
                />
                <Metric
                    label="Estimated orphan bytes"
                    value={formatBytes(metrics.estimatedOrphanBytes.bytes)}
                />
            </div>

            <p style={{ margin: "14px 0 0", color: "var(--ink-3)", fontSize: 11 }}>
                Last updated {new Date(metrics.generatedAt).toLocaleString()}. Orphan estimate
                source: {metrics.estimatedOrphanBytes.source.replaceAll("_", " ")}.
            </p>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ padding: "14px 15px", background: "var(--panel)" }}>
            <div style={{ color: "var(--ink-3)", fontSize: 11, marginBottom: 5 }}>{label}</div>
            <div className="mono" style={{ color: "var(--ink)", fontSize: 16 }}>
                {value}
            </div>
        </div>
    );
}
