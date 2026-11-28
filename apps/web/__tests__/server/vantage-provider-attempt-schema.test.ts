import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as weeklyReviewSchema from "~/server/db/schema/vantage-weekly-review";
import * as v2Schema from "~/server/db/schema/vantage-v2";

it("keeps the owned Vantage table snapshot identical to the exported Drizzle schema", () => {
    const current = generateDrizzleJson({ ...weeklyReviewSchema, ...v2Schema });
    const meta = resolve(process.cwd(), "drizzle/meta");
    const journal: { entries: { tag: string }[] } = JSON.parse(
        readFileSync(resolve(meta, "_journal.json"), "utf8")
    );
    const latest = journal.entries.at(-1);
    if (!latest) throw new Error("Product migration journal is empty");
    const snapshot = JSON.parse(
        readFileSync(resolve(meta, latest.tag.split("_")[0] + "_snapshot.json"), "utf8")
    );
    for (const [key, table] of Object.entries(current.tables)) {
        expect({ key, table }).toEqual({ key, table: snapshot.tables[key] });
    }
});
