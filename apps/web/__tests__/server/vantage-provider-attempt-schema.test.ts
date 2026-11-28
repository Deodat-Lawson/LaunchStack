import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as weeklyReviewSchema from "~/server/db/schema/vantage-weekly-review";
import * as v2Schema from "~/server/db/schema/vantage-v2";

it("keeps the owned Vantage table snapshot identical to the exported Drizzle schema", () => {
    const current = generateDrizzleJson({ ...weeklyReviewSchema, ...v2Schema });
    const snapshot = JSON.parse(
        readFileSync(resolve(process.cwd(), "drizzle/meta/20261128051438_snapshot.json"), "utf8")
    );
    for (const [key, table] of Object.entries(current.tables)) {
        expect({ key, table }).toEqual({ key, table: snapshot.tables[key] });
    }
});
