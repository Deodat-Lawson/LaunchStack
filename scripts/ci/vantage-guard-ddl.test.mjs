import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractReviewedGuardDDL, MIGRATION } from "./vantage-guard-ddl.mjs";
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
