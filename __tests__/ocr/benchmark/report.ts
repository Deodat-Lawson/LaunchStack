/**
 * Reads results/launchstack.json and results/onyx.json, prints a side-by-side
 * comparison grouped by category. Run after `run.ts` has populated both.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "results");

interface Row {
  category: string;
  fixture: string;
  target: "launchstack" | "onyx";
  levenshtein: number;
  tableF1: number;
  coverage: 0 | 1;
  latencyMs: number;
  error?: string;
}

async function loadResults(target: "launchstack" | "onyx"): Promise<Row[]> {
  try {
    const raw = await readFile(join(RESULTS_DIR, `${target}.json`), "utf8");
    return JSON.parse(raw) as Row[];
  } catch {
    console.warn(`[report] Missing results/${target}.json — run run.ts --target=${target} first`);
    return [];
  }
}

function avg(rows: Row[], key: "levenshtein" | "tableF1" | "coverage" | "latencyMs"): number {
  const vals = rows.filter((r) => !r.error).map((r) => r[key] as number);
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

async function main() {
  const [lsRows, onyxRows] = await Promise.all([loadResults("launchstack"), loadResults("onyx")]);

  const categories = Array.from(new Set([...lsRows, ...onyxRows].map((r) => r.category)));
  categories.sort();

  console.log("\nCategory avg scores — higher is better for lev / tableF1 / coverage; lower is better for latency\n");
  const header = ["category", "LS lev", "OX lev", "LS tableF1", "OX tableF1", "LS cov", "OX cov", "LS ms", "OX ms"];
  console.log(header.join("\t"));

  for (const cat of categories) {
    const ls = lsRows.filter((r) => r.category === cat);
    const ox = onyxRows.filter((r) => r.category === cat);
    const row = [
      cat,
      avg(ls, "levenshtein").toFixed(3),
      avg(ox, "levenshtein").toFixed(3),
      avg(ls, "tableF1").toFixed(3),
      avg(ox, "tableF1").toFixed(3),
      avg(ls, "coverage").toFixed(2),
      avg(ox, "coverage").toFixed(2),
      Math.round(avg(ls, "latencyMs")).toString(),
      Math.round(avg(ox, "latencyMs")).toString(),
    ];
    console.log(row.join("\t"));
  }

  console.log("\nOverall (all fixtures)");
  console.log(
    [
      "launchstack",
      `lev=${avg(lsRows, "levenshtein").toFixed(3)}`,
      `tableF1=${avg(lsRows, "tableF1").toFixed(3)}`,
      `cov=${avg(lsRows, "coverage").toFixed(2)}`,
      `latency=${Math.round(avg(lsRows, "latencyMs"))}ms`,
      `errors=${lsRows.filter((r) => r.error).length}/${lsRows.length}`,
    ].join("  "),
  );
  console.log(
    [
      "onyx       ",
      `lev=${avg(onyxRows, "levenshtein").toFixed(3)}`,
      `tableF1=${avg(onyxRows, "tableF1").toFixed(3)}`,
      `cov=${avg(onyxRows, "coverage").toFixed(2)}`,
      `latency=${Math.round(avg(onyxRows, "latencyMs"))}ms`,
      `errors=${onyxRows.filter((r) => r.error).length}/${onyxRows.length}`,
    ].join("  "),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
