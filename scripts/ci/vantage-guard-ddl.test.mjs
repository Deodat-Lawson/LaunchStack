import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractReviewedGuardDDL, MIGRATION, GUARD_UPGRADE } from "./vantage-guard-ddl.mjs";
const body = await readFile(MIGRATION, "utf8");
test("extracts only reviewed authority function and trigger creation, never table DDL", () => {
    const { guardDDL, ddlRemainder } = extractReviewedGuardDDL(body);
    assert.match(guardDDL, /^CREATE FUNCTION pdr_ai_v2_vantage_bump_authority/);
    assert.match(guardDDL, /CREATE TRIGGER vantage_authority_change/);
    assert.doesNotMatch(guardDDL, /CREATE TABLE/);
    assert.match(ddlRemainder, /CREATE TABLE/);
    assert.doesNotMatch(ddlRemainder, /CREATE FUNCTION|CREATE TRIGGER|DO \$\$/);
});
test("rejects tampered, incomplete, or appended SQL rather than broadening the exception", () => {
    for (const value of [
        body + "\nDROP TABLE users;",
        body.replace("BEFORE INSERT", "AFTER INSERT"),
        body.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
        body.slice(0, -20),
    ])
        assert.throws(() => extractReviewedGuardDDL(value), /immutable SHA256/);
});
test("handles Windows line endings without modifying the applied SQL file", () => {
    assert.deepEqual(
        extractReviewedGuardDDL(body.replace(/\r?\n/g, "\r\n")),
        extractReviewedGuardDDL(body)
    );
});

const upgrade = await readFile(GUARD_UPGRADE, "utf8");
test("extracts the immutable additive AFTER-write upgrade without table DDL", () => {
    const result = extractReviewedGuardDDL(upgrade, GUARD_UPGRADE);
    assert.match(result.guardDDL, /DROP TRIGGER vantage_authority_change ON %I/);
    assert.match(
        result.guardDDL,
        /CREATE TRIGGER vantage_authority_change AFTER INSERT OR UPDATE OR DELETE/
    );
    assert.doesNotMatch(result.guardDDL, /CREATE TABLE|CREATE FUNCTION/);
    assert.equal(result.ddlRemainder.trim(), "");
    assert.deepEqual(
        extractReviewedGuardDDL(upgrade.replace(/\r?\n/g, "\r\n"), GUARD_UPGRADE),
        result
    );
});
test("rejects a changed upgrade or an unreviewed migration path", () => {
    for (const changed of [
        upgrade.replace("AFTER INSERT", "BEFORE INSERT"),
        upgrade + "\nDELETE FROM users;",
        upgrade.slice(0, -20),
    ])
        assert.throws(() => extractReviewedGuardDDL(changed, GUARD_UPGRADE), /immutable SHA256/);
    assert.throws(
        () => extractReviewedGuardDDL(upgrade, "apps/web/drizzle/unreviewed.sql"),
        /Unreviewed/
    );
});
test("CLI emits original function/guards before the AFTER-write upgrade", async () => {
    const { execFileSync } = await import("node:child_process");
    const sql = execFileSync(process.execPath, ["scripts/ci/vantage-guard-ddl.mjs", "--emit"], {
        encoding: "utf8",
    });
    assert.equal(
        sql,
        extractReviewedGuardDDL(body).guardDDL +
            extractReviewedGuardDDL(upgrade, GUARD_UPGRADE).guardDDL
    );
    assert(sql.indexOf("BEFORE INSERT") < sql.indexOf("AFTER INSERT"));
});
