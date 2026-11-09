#!/usr/bin/env node
/**
 * Supplement the EMPTY TypeScript-built parity database with PostgreSQL objects
 * Drizzle cannot express. The immutable migration remains production authority;
 * both databases still undergo the same complete pg_dump structural comparison.
 * This is not a general SQL parser or an exception for arbitrary procedural SQL.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION = "apps/web/drizzle/20261109200000_vantage_weekly_reviews.sql";
const REVIEWED_SHA256 = "b1ac76d88378a86fa8e31d471de63efa8e8373a8c25c96b9152ce31496e25386";
const signature = block =>
    block
        .trim()
        .replace(/^(?:--[^\n]*(?:\n|$)\s*)+/, "")
        .trim();
export function extractReviewedGuardDDL(body) {
    const normalized = body.replace(/\r\n/g, "\n");
    if (createHash("sha256").update(normalized).digest("hex") !== REVIEWED_SHA256)
        throw new Error("Vantage authority migration differs from its reviewed immutable SHA256");
    const blocks = normalized.split("--> statement-breakpoint").map(signature).filter(Boolean);
    const functions = blocks.filter(block =>
        /^CREATE FUNCTION pdr_ai_v2_vantage_bump_authority\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$/.test(
            block
        )
    );
    const triggers = blocks.filter(block => /^DO \$\$ DECLARE tab text; BEGIN/.test(block));
    if (functions.length !== 1 || triggers.length !== 1 || blocks.length !== 9)
        throw new Error("Unexpected Vantage authority DDL statement boundary");
    const triggerBlock = triggers[0];
    if (
        !triggerBlock.includes(
            "CREATE TRIGGER vantage_authority_change BEFORE INSERT OR UPDATE OR DELETE"
        ) ||
        !triggerBlock.includes("EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority()") ||
        [...triggerBlock.matchAll(/'pdr_ai_v2_[a-z_]+'/g)].length !== 15
    )
        throw new Error("Unexpected Vantage authority trigger coverage");
    const remainder = blocks.filter(block => block !== functions[0] && block !== triggerBlock);
    if (remainder.some(block => !/^CREATE (TABLE|INDEX)\b/.test(block)))
        throw new Error("Unreviewed non-table DDL in Vantage authority migration");
    return {
        guardDDL: functions[0] + "\n" + triggerBlock + "\n",
        ddlRemainder: remainder.join("\n--> statement-breakpoint\n") + "\n",
    };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [mode, path = MIGRATION] = process.argv.slice(2);
        if (
            !["--emit", "--ddl-remainder"].includes(mode) ||
            path !== MIGRATION ||
            process.argv.length > 4
        )
            throw new Error(
                "Usage: vantage-guard-ddl.mjs --emit|--ddl-remainder [reviewed migration path]"
            );
        const result = extractReviewedGuardDDL(await readFile(MIGRATION, "utf8"));
        process.stdout.write(mode === "--emit" ? result.guardDDL : result.ddlRemainder);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
