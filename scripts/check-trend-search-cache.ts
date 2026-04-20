import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { count } from "drizzle-orm";

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env");
  const envText = readFileSync(envPath, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadLocalEnv();
  const [{ db }, { trendSearchCache }] = await Promise.all([
    import("../src/server/db"),
    import("../src/server/db/schema"),
  ]);
  const rows = await db.select({ rowCount: count() }).from(trendSearchCache);
  const rowCount = rows[0]?.rowCount ?? 0;

  console.log(
    JSON.stringify(
      {
        table: "pdr_ai_v2_trend_search_cache",
        rowCount,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
