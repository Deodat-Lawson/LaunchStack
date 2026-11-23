import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIGRATION, extractReviewedGuardDDL } from "./vantage-guard-ddl.mjs";
test("emits the final filtered AFTER authority guards", () => {
    const body = readFileSync(MIGRATION, "utf8");
    const { guardDDL, ddlRemainder } = extractReviewedGuardDDL(body);
    assert.match(guardDDL, /vantage_authority_update AFTER UPDATE ON pdr_ai_v2_users/);
    assert.match(
        guardDDL,
        /vantage_authority_update AFTER UPDATE ON pdr_ai_v2_user_company_memberships/
    );
    assert.match(guardDDL, /IS DISTINCT FROM/);
    assert.doesNotMatch(guardDDL, /BEFORE INSERT/);
    assert.doesNotMatch(ddlRemainder, /CREATE FUNCTION/);
    assert.throws(() => extractReviewedGuardDDL(body + "-- changed"));
    assert.throws(() => extractReviewedGuardDDL(body, "unreviewed.sql"));
});
