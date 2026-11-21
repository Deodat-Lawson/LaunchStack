/**
 * Outlook sync: the only place a mailbox sync executes (ADR-003: the worker
 * is the sole executor of durable work; web routes just send the event).
 *
 * Two functions:
 * - outlookSyncJob: one connection's sync run, serialized per connection.
 * - outlookSyncCron: every 15 minutes, fan out one event per active Outlook
 *   connection. A run starts from each folder's delta link, so an idle
 *   mailbox costs the profile and one empty page per chosen folder.
 */

import { inngest } from "../client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listActiveConnectionsForProvider } from "~/server/services/connectors/connection-store";
import { runOutlookSync } from "~/server/services/connectors/outlook/sync-service";

export const outlookSyncJob = inngest.createFunction(
    {
        id: "outlook-sync",
        // The DB lease is the belt to this suspender: the delta links must
        // only ever advance under one runner per connection.
        concurrency: { key: "event.data.connectionId", limit: 1 },
        retries: 2,
    },
    { event: "outlook/sync.requested" },
    async ({ event, step }) => {
        const connectionId = Number(event.data.connectionId);

        const result = await step.run("sync", () =>
            runOutlookSync(connectionId, { force: event.data.force })
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
            deltaExpired: result.report.deltaExpired,
        };
    }
);

export const outlookSyncCron = inngest.createFunction(
    { id: "outlook-sync-cron", retries: 1 },
    // Offset from the Drive and Gmail crons so the fan-outs never land on one tick.
    { cron: "9,24,39,54 * * * *" },
    async ({ step }) => {
        if (!isConnectorConfigured("outlook")) return { dispatched: 0 };

        const connections = await step.run("list-connections", async () => {
            const rows = await listActiveConnectionsForProvider("outlook");
            return rows.map(row => ({
                connectionId: row.id.toString(),
                companyId: row.companyId.toString(),
            }));
        });

        if (connections.length > 0) {
            await step.sendEvent(
                "fan-out",
                connections.map(connection => ({
                    name: "outlook/sync.requested" as const,
                    data: { ...connection, force: false },
                }))
            );
        }

        return { dispatched: connections.length };
    }
);
