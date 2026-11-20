/**
 * Microsoft 365 sync: the only place a OneDrive or SharePoint sync executes
 * (ADR-003: the worker is the sole executor of durable work; web routes just
 * send the event).
 *
 * Two functions:
 * - microsoft365SyncJob: one connection's sync run, serialized per connection.
 * - microsoft365SyncCron: every 15 minutes (offset from Drive's tick), fan
 *   out one event per active connection. A run walks what was picked and
 *   compares listing fingerprints, so an idle workspace costs listings only.
 */

import { inngest } from "../client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listActiveConnectionsForProvider } from "~/server/services/connectors/connection-store";
import { runMicrosoft365Sync } from "~/server/services/connectors/microsoft-365/sync-service";

export const microsoft365SyncJob = inngest.createFunction(
    {
        id: "microsoft-365-sync",
        // The DB lease is the belt to this suspender: one runner per connection.
        concurrency: { key: "event.data.connectionId", limit: 1 },
        retries: 2,
    },
    { event: "microsoft-365/sync.requested" },
    async ({ event, step }) => {
        const connectionId = Number(event.data.connectionId);

        const result = await step.run("sync", () =>
            runMicrosoft365Sync(connectionId, { force: event.data.force })
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

export const microsoft365SyncCron = inngest.createFunction(
    { id: "microsoft-365-sync-cron", retries: 1 },
    { cron: "4,19,34,49 * * * *" },
    async ({ step }) => {
        if (!isConnectorConfigured("microsoft-365")) return { dispatched: 0 };

        const connections = await step.run("list-connections", async () => {
            const rows = await listActiveConnectionsForProvider("microsoft-365");
            return rows.map(row => ({
                connectionId: row.id.toString(),
                companyId: row.companyId.toString(),
            }));
        });

        if (connections.length > 0) {
            await step.sendEvent(
                "fan-out",
                connections.map(connection => ({
                    name: "microsoft-365/sync.requested" as const,
                    data: { ...connection, force: false },
                }))
            );
        }

        return { dispatched: connections.length };
    }
);
