/**
 * Gmail sync — the only place a mailbox sync executes (ADR-003: the worker
 * is the sole executor of durable work; web routes just send the event).
 *
 * Two functions:
 * - gmailSyncJob: one connection's sync run, serialized per connection.
 * - gmailSyncCron: every 15 minutes, fan out one event per active Gmail
 *   connection. The run's first act is a history dirty-check, so an idle
 *   mailbox costs two Gmail API calls per tick.
 */

import { inngest } from "../client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listActiveConnectionsForProvider } from "~/server/services/connectors/connection-store";
import { runGmailSync } from "~/server/services/connectors/gmail/sync-service";

export const gmailSyncJob = inngest.createFunction(
    {
        id: "gmail-sync",
        // The DB lease is the belt to this suspender: the history cursor
        // must only ever advance under one runner per connection.
        concurrency: { key: "event.data.connectionId", limit: 1 },
        retries: 2,
    },
    { event: "gmail/sync.requested" },
    async ({ event, step }) => {
        const connectionId = Number(event.data.connectionId);

        const result = await step.run("sync", () =>
            runGmailSync(connectionId, { force: event.data.force })
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
            historyExpired: result.report.historyExpired,
        };
    }
);

export const gmailSyncCron = inngest.createFunction(
    { id: "gmail-sync-cron", retries: 1 },
    // Offset from the Drive cron so the two fan-outs never land on one tick.
    { cron: "7,22,37,52 * * * *" },
    async ({ step }) => {
        if (!isConnectorConfigured("gmail")) return { dispatched: 0 };

        const connections = await step.run("list-connections", async () => {
            const rows = await listActiveConnectionsForProvider("gmail");
            return rows.map(row => ({
                connectionId: row.id.toString(),
                companyId: row.companyId.toString(),
            }));
        });

        if (connections.length > 0) {
            await step.sendEvent(
                "fan-out",
                connections.map(connection => ({
                    name: "gmail/sync.requested" as const,
                    data: { ...connection, force: false },
                }))
            );
        }

        return { dispatched: connections.length };
    }
);
