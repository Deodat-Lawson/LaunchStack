import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDb } from "@launchstack/store/client";

import {
    getStorageDeletionSummary,
    listStorageDeletionRequests,
    requeueStorageDeletionRequest,
    showStorageDeletionRequest,
    waiveStorageDeletionItem,
} from "../src/server/storage/deletion/admin";

// Match the application's root .env location without booting its engine.
process.env.DOTENV_CONFIG_QUIET = "true";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const usage = `Usage: pnpm --filter @launchstack/web exec tsx scripts/storage-deletion.ts <command>
  summary
  list --status blocked|pending [--company <id>] [--limit <N>]
  show <requestId>
  requeue <requestId> --actor <name> [--note <text>]
  waive <itemId> --actor <name> --note <text>

Read-only by default. A dead outbox delivery is listed as blocked even if its request is pending.`;

function positiveId(raw: string | undefined, name: string): number {
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)
        throw new Error(`${name} must be a positive safe integer`);
    return Number(raw);
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            status: { type: "string" },
            company: { type: "string" },
            limit: { type: "string" },
            actor: { type: "string" },
            note: { type: "string" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help) {
        console.log(usage);
        return;
    }
    const [command, rawId, ...extra] = positionals;
    if (!command || !["summary", "list", "show", "requeue", "waive"].includes(command))
        throw new Error(usage);
    if (extra.length || ((command === "summary" || command === "list") && rawId))
        throw new Error(usage);
    const id =
        command === "show" || command === "requeue" || command === "waive"
            ? positiveId(rawId, "id")
            : undefined;
    if (command === "list" && values.status !== "blocked" && values.status !== "pending")
        throw new Error("--status must be blocked or pending");
    const actor = values.actor?.trim();
    if ((command === "requeue" || command === "waive") && (!actor || actor.length > 256))
        throw new Error("--actor is required and must be at most 256 characters");
    if (command === "waive" && !values.note?.trim())
        throw new Error("--note is required for waive");
    let companyId: bigint | undefined;
    if (values.company !== undefined) {
        if (!/^\d+$/.test(values.company) || BigInt(values.company) <= 0n)
            throw new Error("--company must be a positive integer");
        companyId = BigInt(values.company);
    }
    const limit = values.limit === undefined ? undefined : positiveId(values.limit, "--limit");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    // Operator repair must not require chat endpoints, storage credentials or engine boot.
    const handle = createDb({ url, maxConnections: 1 });
    try {
        let result: unknown;
        switch (command) {
            case "summary":
                result = await getStorageDeletionSummary(handle.db);
                break;
            case "list":
                result = await listStorageDeletionRequests(handle.db, {
                    status: values.status as "blocked" | "pending",
                    companyId,
                    limit,
                });
                break;
            case "show":
                result = await showStorageDeletionRequest(handle.db, id!);
                break;
            case "requeue":
                result = await requeueStorageDeletionRequest(handle.db, id!, {
                    actor: actor!,
                    note: values.note,
                });
                break;
            case "waive":
                result = await waiveStorageDeletionItem(handle.db, id!, {
                    actor: actor!,
                    note: values.note!,
                });
                break;
        }
        console.log(
            JSON.stringify(
                result,
                (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
                2
            )
        );
    } finally {
        await handle.close();
    }
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
