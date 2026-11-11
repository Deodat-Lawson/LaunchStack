import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDb } from "@launchstack/store/client";

// Match the application's root .env location without booting its engine.
process.env.DOTENV_CONFIG_QUIET = "true";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

async function main() {
    const { values } = parseArgs({
        options: {
            "grace-days": { type: "string" },
            inventory: { type: "boolean", default: false },
            enqueue: { type: "boolean", default: false },
            actor: { type: "string" },
            note: { type: "string" },
            out: { type: "string" },
        },
        allowPositionals: false,
    });
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    const rawGrace = values["grace-days"];
    if (rawGrace !== undefined && !/^\d+$/.test(rawGrace))
        throw new Error("--grace-days must be a non-negative integer");
    const graceDays = rawGrace === undefined ? 7 : Number(rawGrace);
    if (!Number.isSafeInteger(graceDays)) throw new Error("--grace-days must be a safe integer");
    const actor = values.actor?.trim();
    if (values.enqueue && (!actor || actor.length > 256))
        throw new Error("--enqueue requires --actor of 1 to 256 characters");

    // The audit needs storage configuration only when it exists, not chat/auth
    // credentials. The location/client resolvers still use the usual env module.
    process.env.SKIP_ENV_VALIDATION = "true";
    // Static import would validate env before this database-only CLI can bypass it.
    const { auditStorageOrphans, StorageOrphanAuditError } = await import(
        "../src/server/storage/audit"
    );
    const handle = createDb({ url, maxConnections: 1 });
    try {
        const report = await auditStorageOrphans(handle.db, {
            graceDays,
            inventory: values.inventory,
            enqueue: values.enqueue,
            actor,
        });
        if (values.enqueue) {
            console.error(
                JSON.stringify({
                    event: "storage_orphan_audit_enqueue",
                    actor,
                    note: values.note?.trim().length
                        ? values.note.trim()
                        : "Operator enqueued orphan-audit candidates",
                    requestIds: report.ledger.requestIds,
                    at: new Date().toISOString(),
                })
            );
        }
        const json = `${JSON.stringify(report, null, 2)}\n`;
        if (values.out) await writeFile(values.out, json, "utf8");
        else process.stdout.write(json);
    } catch (error) {
        if (values.enqueue && error instanceof StorageOrphanAuditError) {
            process.stdout.write(
                `${JSON.stringify(
                    {
                        error: error.message,
                        committedRequestIds: error.report.ledger.requestIds,
                        partialReport: error.report,
                    },
                    null,
                    2
                )}\n`
            );
            console.error(
                JSON.stringify({
                    event: "storage_orphan_audit_enqueue_failed",
                    actor,
                    note: values.note?.trim().length
                        ? values.note.trim()
                        : "Operator enqueued orphan-audit candidates",
                    committedRequestIds: error.report.ledger.requestIds,
                    error: error.message,
                })
            );
        }
        throw error;
    } finally {
        await handle.close();
    }
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
