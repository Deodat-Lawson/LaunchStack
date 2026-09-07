/**
 * Google Drive sync — the only place a sync executes (ADR-003: the worker is
 * the sole executor of durable work; web routes just send the event).
 *
 * Two functions:
 * - googleDriveSyncJob: one connection's sync run, serialized per connection.
 * - googleDriveSyncCron: every 15 minutes, fan out one event per active
 *   connection. The run's first act is a changes-feed dirty-check, so an idle
 *   workspace costs one Drive API call per tick.
 */

import { inngest } from "../client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listActiveConnectionsForProvider } from "~/server/services/connectors/connection-store";
import { runGoogleDriveSync } from "~/server/services/connectors/google-drive/sync-service";

export const googleDriveSyncJob = inngest.createFunction(
    {
        id: "google-drive-sync",
        // The DB lease is the belt to this suspender: startPageToken must
        // only ever advance under one runner per connection.
        concurrency: { key: "event.data.connectionId", limit: 1 },
        retries: 2,
    },
    { event: "google-drive/sync.requested" },
    async ({ event, step }) => {
        const connectionId = Number(event.data.connectionId);

        const result = await step.run("sync", () =>
            runGoogleDriveSync(connectionId, { force: event.data.force })
        );

        if (result.outcome === "skipped") {
            return { outcome: result.outcome, reason: result.reason };
        }
        return {
            outcome: result.outcome,
            discovered: result.report.discovered,
            stored: result.report.stored.length,
            skipped: result.report.skipped.length,
            failed: result.report.failed.length,
            accessLost: result.report.accessLost.length,
        };
    }
);

export const googleDriveSyncCron = inngest.createFunction(
    { id: "google-drive-sync-cron", retries: 1 },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        if (!isConnectorConfigured("google-drive")) return { dispatched: 0 };

        const connections = await step.run("list-connections", async () => {
            const rows = await listActiveConnectionsForProvider("google-drive");
            return rows.map(row => ({
                connectionId: row.id.toString(),
                companyId: row.companyId.toString(),
            }));
        });

        if (connections.length > 0) {
            await step.sendEvent(
                "fan-out",
                connections.map(connection => ({
                    name: "google-drive/sync.requested" as const,
                    data: { ...connection, force: false },
                }))
            );
        }

        return { dispatched: connections.length };
    }
);
