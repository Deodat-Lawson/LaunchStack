/** Which connector syncs the Processing queue shows, and how. */

import { connectorSyncSummary, type ConnectorSyncRow } from "~/lib/processing-queue/connectors";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function row(overrides: Partial<ConnectorSyncRow> = {}): ConnectorSyncRow {
    return {
        provider: "google-drive",
        account: "ops@acme.test",
        lastSyncStatus: "ok",
        lastSyncAt: minutesAgo(2),
        lastSyncError: null,
        lastSyncReport: {
            discovered: 12,
            stored: 3,
            skipped: 1,
            unchanged: 8,
            failed: 0,
            missing: 0,
            accessLost: 0,
            durationMs: 900,
        },
        syncLockedAt: null,
        ...overrides,
    };
}

describe("connectorSyncSummary", () => {
    it("shows a sync that finished in the last 15 minutes, with its counts", () => {
        expect(connectorSyncSummary(row(), NOW)).toEqual({
            provider: "google-drive",
            account: "ops@acme.test",
            status: "ok",
            lastSyncAt: minutesAgo(2).toISOString(),
            report: { discovered: 12, stored: 3, unchanged: 8, skipped: 1, failed: 0 },
            error: null,
        });
    });

    it("hides a sync that finished longer ago", () => {
        expect(connectorSyncSummary(row({ lastSyncAt: minutesAgo(16) }), NOW)).toBeNull();
        expect(connectorSyncSummary(row({ lastSyncAt: null }), NOW)).toBeNull();
        expect(connectorSyncSummary(row({ lastSyncStatus: null }), NOW)).toBeNull();
    });

    it("carries the error of a failed sync", () => {
        expect(
            connectorSyncSummary(
                row({ provider: "gmail", lastSyncStatus: "error", lastSyncError: "invalid_grant" }),
                NOW
            )
        ).toMatchObject({ provider: "gmail", status: "error", error: "invalid_grant" });
    });

    it("a running sync is dated by its lease and keeps the last run's counts", () => {
        expect(
            connectorSyncSummary(
                row({
                    lastSyncStatus: "running",
                    syncLockedAt: minutesAgo(1),
                    lastSyncAt: minutesAgo(90),
                }),
                NOW
            )
        ).toMatchObject({
            status: "running",
            lastSyncAt: minutesAgo(1).toISOString(),
            report: { stored: 3 },
            error: null,
        });
    });

    it("a 'running' row whose lease went stale is a sync that died — not shown", () => {
        expect(
            connectorSyncSummary(
                row({ lastSyncStatus: "running", syncLockedAt: minutesAgo(11) }),
                NOW
            )
        ).toBeNull();
        expect(
            connectorSyncSummary(row({ lastSyncStatus: "running", syncLockedAt: null }), NOW)
        ).toBeNull();
    });

    it("tolerates a report missing counts", () => {
        expect(
            connectorSyncSummary(row({ lastSyncReport: { discovered: 2, noScope: true } }), NOW)
                ?.report
        ).toEqual({ discovered: 2, stored: 0, unchanged: 0, skipped: 0, failed: 0 });
        expect(connectorSyncSummary(row({ lastSyncReport: null }), NOW)?.report).toBeNull();
    });
});
