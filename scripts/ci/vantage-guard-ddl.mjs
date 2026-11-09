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
export const GUARD_UPGRADE = "apps/web/drizzle/20261109230000_vantage_authority_after_write.sql";
const REVIEWED_SHA256 = {
    [MIGRATION]: "b1ac76d88378a86fa8e31d471de63efa8e8373a8c25c96b9152ce31496e25386",
    [GUARD_UPGRADE]: "5701f197f680532600b3e6b6abdb0dbd77c5ce0b3d7a07758d0cbc5b3ea40c73",
};
const signature = block =>
    block
        .trim()
        .replace(/^(?:--[^\n]*(?:\n|$)\s*)+/, "")
        .trim();
export function extractReviewedGuardDDL(body, path = MIGRATION) {
    if (!Object.hasOwn(REVIEWED_SHA256, path))
        throw new Error("Unreviewed authority migration path");
    const normalized = body.replace(/\r\n/g, "\n");
    if (createHash("sha256").update(normalized).digest("hex") !== REVIEWED_SHA256[path])
        throw new Error("Vantage authority migration differs from its reviewed immutable SHA256");
    const blocks = normalized.split("--> statement-breakpoint").map(signature).filter(Boolean);
    if (path === GUARD_UPGRADE) {
        if (
            blocks.length !== 1 ||
            !/^DO \$\$ DECLARE tab text; BEGIN/.test(blocks[0]) ||
            !blocks[0].includes("DROP TRIGGER vantage_authority_change ON %I") ||
            !blocks[0].includes(
                "CREATE TRIGGER vantage_authority_change AFTER INSERT OR UPDATE OR DELETE"
            ) ||
            !blocks[0].includes("EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority()") ||
            [...blocks[0].matchAll(/'pdr_ai_v2_[a-z_]+'/g)].length !== 15
        )
            throw new Error("Unexpected Vantage AFTER-trigger upgrade boundary");
        return { guardDDL: blocks[0] + "\n", ddlRemainder: "\n" };
    }
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
        const [mode, path] = process.argv.slice(2);
        if (
            !["--emit", "--ddl-remainder"].includes(mode) ||
            (path !== undefined && !Object.hasOwn(REVIEWED_SHA256, path)) ||
            process.argv.length > 4
        )
            throw new Error(
                "Usage: vantage-guard-ddl.mjs --emit|--ddl-remainder [reviewed migration path]"
            );
        // Order matters: recreate the original immutable guards, then apply the
        // additive AFTER-write upgrade exactly as the forward journal does.
        const paths =
            mode === "--emit" && path === undefined
                ? [MIGRATION, GUARD_UPGRADE]
                : [path ?? MIGRATION];
        for (const item of paths) {
            const result = extractReviewedGuardDDL(await readFile(item, "utf8"), item);
            process.stdout.write(mode === "--emit" ? result.guardDDL : result.ddlRemainder);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
