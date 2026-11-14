import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { users, userCompanyMemberships } from "~/server/db/schema/identity";

const migration = readFileSync(
    resolve(process.cwd(), "drizzle/20261114000000_vantage_identity_authority_updates.sql"),
    "utf8"
);

describe("identity authority column classification", () => {
    it.each([
        ["users", users],
        ["memberships", userCompanyMemberships],
    ] as const)(
        "explicitly classifies every %s schema column and compares authority values",
        (name, table) => {
            const columns = Object.values(getTableColumns(table))
                .map(column => column.name)
                .sort();
            const classified = (kind: string) => {
                const match = new RegExp(`-- ${name} ${kind}: ([^\\r\\n]+)`).exec(migration);
                expect(match).not.toBeNull();
                return match![1]!.split(",");
            };
            const authority = classified("authority");
            const incidental = classified("incidental");
            expect([...authority, ...incidental].sort()).toEqual(columns);
            expect(new Set([...authority, ...incidental]).size).toBe(columns.length);
            const tableName =
                name === "users" ? "pdr_ai_v2_users" : "pdr_ai_v2_user_company_memberships";
            const trigger = migration
                .split(`AFTER UPDATE ON ${tableName}`)[1]!
                .split("--> statement-breakpoint")[0]!;
            for (const row of ["OLD", "NEW"]) {
                const compared = [
                    ...trigger.matchAll(new RegExp(`${row}\\.(?:"([^"]+)"|(\\w+))`, "g")),
                ]
                    .map(match => match[1] ?? match[2])
                    .sort();
                expect(compared).toEqual([...authority].sort());
            }
            expect(trigger).toContain("IS DISTINCT FROM");
        }
    );
});
