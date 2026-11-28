import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrations = join(__dirname, "../../drizzle");
const plansAt59 = readFileSync(join(migrations, "20261128051438_vantage_v2.sql"), "utf8")
    .split("--> statement-breakpoint")[0]!
    .replace(/^CREATE TABLE /, "CREATE TEMP TABLE ");
const upgrade = readFileSync(
    join(migrations, "20261128162614_vantage_v2_complete_approval.sql"),
    "utf8"
).split("--> statement-breakpoint");
const checkViolation = { code: "23514", constraint_name: "vantage_v2_plan_approval" };

const fixture = process.env.VANTAGE_ATTEMPT_PG_URL;
(fixture ? describe : describe.skip)("V2 plan approval migration", () => {
    let db: ReturnType<typeof postgres>;
    beforeAll(async () => {
        const { protocol, hostname, port, pathname, search } = new URL(fixture!);
        if (
            protocol !== "postgres:" ||
            hostname !== "127.0.0.1" ||
            port !== "55439" ||
            pathname !== "/vantage_followup_concurrency" ||
            search !== ""
        )
            throw new Error("The approval migration test requires the disposable Vantage database");
        db = postgres(fixture!, { max: 1, idle_timeout: 0 });
        // Both migrations use unqualified names. Restrict the connection to its temp schema.
        await db`SET search_path = pg_temp`;
    });
    beforeEach(async () => {
        await db.unsafe(plansAt59);
    });
    afterEach(async () => {
        await db?.unsafe("DROP TABLE IF EXISTS pg_temp.pdr_ai_v2_vantage_v2_plans");
    });
    afterAll(async () => {
        await db?.end();
    });

    const insert = (version: number | null, hash: string | null) =>
        db`INSERT INTO pg_temp.pdr_ai_v2_vantage_v2_plans
           (id, review_id, company_id, owner_id, version, hash, approved_version, approved_hash, ciphertext)
           VALUES (${randomUUID()}, ${randomUUID()}, 1, 'fixture', 2, 'current', ${version}, ${hash}, 'fixture')`;
    const migrate = () =>
        db.begin(async tx => {
            for (const statement of upgrade) await tx.unsafe(statement);
        });

    it("refuses half-approved legacy rows without dropping the old guard or changing the evidence", async () => {
        await insert(2, null);
        await insert(null, "current");
        await insert(2, "current");
        await expect(migrate()).rejects.toMatchObject(checkViolation);
        await expect(insert(1, "stale")).rejects.toMatchObject(checkViolation);
        const approvals = () =>
            db`SELECT approved_version, approved_hash, ciphertext FROM pg_temp.pdr_ai_v2_vantage_v2_plans
               ORDER BY approved_version NULLS FIRST, approved_hash NULLS FIRST`;
        expect(await approvals()).toEqual([
            { approved_version: null, approved_hash: "current", ciphertext: "fixture" },
            { approved_version: 2, approved_hash: null, ciphertext: "fixture" },
            { approved_version: 2, approved_hash: "current", ciphertext: "fixture" },
        ]);
        // Simulate authorized remediation: remove partial approval, never complete it implicitly.
        await db`UPDATE pg_temp.pdr_ai_v2_vantage_v2_plans SET approved_version = NULL, approved_hash = NULL
                 WHERE (approved_version IS NULL) <> (approved_hash IS NULL)`;
        await migrate();
        expect(await approvals()).toEqual([
            { approved_version: null, approved_hash: null, ciphertext: "fixture" },
            { approved_version: null, approved_hash: null, ciphertext: "fixture" },
            { approved_version: 2, approved_hash: "current", ciphertext: "fixture" },
        ]);
    });

    it.each<[number | null, string | null, boolean]>([
        [null, null, true],
        [2, "current", true],
        [null, "current", false],
        [2, null, false],
        [null, "stale", false],
        [1, null, false],
        [1, "current", false],
        [2, "stale", false],
        [1, "stale", false],
    ])("approved version %s and hash %s: accepted=%s", async (version, hash, accepted) => {
        await migrate();
        if (accepted) await insert(version, hash);
        else await expect(insert(version, hash)).rejects.toMatchObject(checkViolation);
    });
});
