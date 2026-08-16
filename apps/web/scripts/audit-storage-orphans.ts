import {
    backfillHighConfidenceManifest,
    buildOrphanInventoryReport,
} from "../src/server/storage/orphan-inventory";

function getOption(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
    const value = getOption(name);
    if (!value) throw new Error(`Missing required option ${name}`);
    return value;
}

function serializeBigInts(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}

async function main(): Promise<void> {
    const adapter = requiredOption("--adapter");
    if (
        adapter !== "s3" &&
        adapter !== "vercel-blob" &&
        adapter !== "database" &&
        adapter !== "uploadthing"
    ) {
        throw new Error(`Unsupported adapter: ${adapter}`);
    }

    const report = await buildOrphanInventoryReport({
        adapter,
        storageLocationId: getOption("--storage-location-id"),
        prefix: getOption("--prefix"),
    });
    console.log(JSON.stringify(report, serializeBigInts, 2));

    if (process.argv.includes("--backfill")) {
        if (!report.listing.available) {
            throw new Error("Refusing backfill while provider inventory is unavailable.");
        }
        const result = await backfillHighConfidenceManifest(report.backfillCandidates);
        console.log(JSON.stringify({ backfill: result }, serializeBigInts, 2));
    }

    if (!report.listing.available) process.exitCode = 2;
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
