/**
 * Notion sync — the only place a Notion sync executes (ADR-003: the worker
 * is the sole executor of durable work; web routes just send the event).
 *
 * Two functions:
 * - notionSyncJob: one connection's sync run, serialized per connection.
 * - notionSyncCron: every 15 minutes, fan out one event per active Notion
 *   connection. A run lists page metadata first and fetches only pages
 *   edited since the last run, so an idle workspace costs a few searches.
 */

import { inngest } from "../client";
import { isConnectorConfigured } from "~/server/services/connectors/config";
import { listActiveConnectionsForProvider } from "~/server/services/connectors/connection-store";
import { runNotionSync } from "~/server/services/connectors/notion/sync-service";

export const notionSyncJob = inngest.createFunction(
    {
        id: "notion-sync",
        // The DB lease is the belt to this suspender: one runner per connection.
        concurrency: { key: "event.data.connectionId", limit: 1 },
        retries: 2,
    },
    { event: "notion/sync.requested" },
    async ({ event, step }) => {
        const connectionId = Number(event.data.connectionId);

        const result = await step.run("sync", () =>
            runNotionSync(connectionId, { force: event.data.force })
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
            missing: result.report.missingSourceIds.length,
        };
    }
);

export const notionSyncCron = inngest.createFunction(
    { id: "notion-sync-cron", retries: 1 },
    // Offset from the Drive (:00) and Gmail (:07) crons so no two fan-outs share a tick.
    { cron: "11,26,41,56 * * * *" },
    async ({ step }) => {
        if (!isConnectorConfigured("notion")) return { dispatched: 0 };

        const connections = await step.run("list-connections", async () => {
            const rows = await listActiveConnectionsForProvider("notion");
            return rows.map(row => ({
                connectionId: row.id.toString(),
                companyId: row.companyId.toString(),
            }));
        });

        if (connections.length > 0) {
            await step.sendEvent(
                "fan-out",
                connections.map(connection => ({
                    name: "notion/sync.requested" as const,
                    data: { ...connection, force: false },
                }))
            );
        }

        return { dispatched: connections.length };
    }
);
