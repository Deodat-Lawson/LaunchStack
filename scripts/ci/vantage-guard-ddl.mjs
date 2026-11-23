import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const MIGRATION = "apps/web/drizzle/20261123171354_vantage_topic_first.sql";
const SHA256 = "43bcbca5b25a24e1cc611a2cc616fea4c39b2ae68c0d49225c0b241d33c754af";
export function extractReviewedGuardDDL(body, path = MIGRATION) {
    const normalized = body.replace(/\r\n/g, "\n");
    if (path !== MIGRATION || createHash("sha256").update(normalized).digest("hex") !== SHA256)
        throw new Error("Unreviewed authority migration");
    const marker = "-- VANTAGE AUTHORITY OBJECTS\n";
    const boundary = normalized.indexOf(marker);
    if (boundary < 0) throw new Error("Missing authority object boundary");
    return {
        guardDDL: normalized.slice(boundary + marker.length),
        ddlRemainder: normalized.slice(0, boundary),
    };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [mode, path = MIGRATION] = process.argv.slice(2);
    if (!["--emit", "--ddl-remainder"].includes(mode) || process.argv.length > 4)
        throw new Error("Usage: --emit|--ddl-remainder [migration]");
    const result = extractReviewedGuardDDL(readFileSync(path, "utf8"), path);
    process.stdout.write(mode === "--emit" ? result.guardDDL : result.ddlRemainder);
}
