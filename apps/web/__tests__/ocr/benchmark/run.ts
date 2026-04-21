/**
 * OCR Benchmark Runner — LaunchStack vs Onyx
 *
 * Iterates fixtures in __tests__/ocr/benchmark/fixtures/<category>/, hits the
 * configured target's ingestion endpoint, records metrics vs ground-truth
 * markdown, and writes results to results/<target>.json.
 *
 * Usage:
 *   bun __tests__/ocr/benchmark/run.ts --target=launchstack
 *   bun __tests__/ocr/benchmark/run.ts --target=onyx --onyx-url=http://localhost:8080
 */

import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { normalizedLevenshtein, tableCellF1, formatCoverage } from "./metrics";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "fixtures");
const GROUND_TRUTH_DIR = join(HERE, "ground-truth");
const RESULTS_DIR = join(HERE, "results");

type Target = "launchstack" | "onyx";

interface CliArgs {
  target: Target;
  launchstackUrl: string;
  onyxUrl: string;
}

interface FixtureResult {
  category: string;
  fixture: string;
  target: Target;
  levenshtein: number;
  tableF1: number;
  coverage: 0 | 1;
  latencyMs: number;
  error?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (k: string, fallback?: string) => {
    const hit = args.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : fallback;
  };
  const target = get("target") as Target | undefined;
  if (target !== "launchstack" && target !== "onyx") {
    throw new Error("--target=launchstack|onyx is required");
  }
  return {
    target,
    launchstackUrl: get("launchstack-url", "http://localhost:3000")!,
    onyxUrl: get("onyx-url", "http://localhost:8080")!,
  };
}

async function main() {
  const cli = parseArgs();
  await mkdir(RESULTS_DIR, { recursive: true });

  const fixtures = await collectFixtures();
  if (fixtures.length === 0) {
    console.warn(
      `[benchmark] No fixtures found under ${FIXTURES_DIR}. Drop files into scanned-pdf/, digital-pdf/, office/, mixed/ and add a matching ground-truth/<name>.md.`,
    );
    return;
  }

  console.log(`[benchmark] Running ${fixtures.length} fixtures against ${cli.target}`);
  const results: FixtureResult[] = [];

  for (const f of fixtures) {
    try {
      const truth = await safeReadText(join(GROUND_TRUTH_DIR, `${basename(f.path, extOf(f.path))}.md`));
      const started = Date.now();
      const pred = await runTarget(cli, f.path);
      const latencyMs = Date.now() - started;

      const lev = normalizedLevenshtein(pred.text, truth);
      const tableMetrics = tableCellF1(pred.tables, extractTablesFromMd(truth));
      const cov = formatCoverage(pred.text);

      results.push({
        category: f.category,
        fixture: basename(f.path),
        target: cli.target,
        levenshtein: lev,
        tableF1: tableMetrics.f1,
        coverage: cov,
        latencyMs,
      });
      console.log(
        `  ✓ ${f.category}/${basename(f.path)} — lev=${lev.toFixed(3)} tableF1=${tableMetrics.f1.toFixed(3)} cov=${cov} ${latencyMs}ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        category: f.category,
        fixture: basename(f.path),
        target: cli.target,
        levenshtein: 0,
        tableF1: 0,
        coverage: 0,
        latencyMs: 0,
        error: message,
      });
      console.error(`  ✗ ${f.category}/${basename(f.path)} — ${message}`);
    }
  }

  const out = join(RESULTS_DIR, `${cli.target}.json`);
  await writeFile(out, JSON.stringify(results, null, 2));
  console.log(`[benchmark] Wrote ${out}`);
}

interface Fixture {
  category: string;
  path: string;
}

async function collectFixtures(): Promise<Fixture[]> {
  const categories = ["scanned-pdf", "digital-pdf", "office", "mixed"];
  const out: Fixture[] = [];
  for (const cat of categories) {
    const dir = join(FIXTURES_DIR, cat);
    try {
      const entries = await readdir(dir);
      for (const e of entries) {
        if (e.startsWith(".")) continue;
        const p = join(dir, e);
        const s = await stat(p);
        if (s.isFile()) out.push({ category: cat, path: p });
      }
    } catch {
      // Category dir may not exist yet
    }
  }
  return out;
}

async function safeReadText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx) : "";
}

interface TargetOutput {
  text: string;
  tables: string[];
}

async function runTarget(cli: CliArgs, fixturePath: string): Promise<TargetOutput> {
  if (cli.target === "launchstack") return runLaunchstack(cli.launchstackUrl, fixturePath);
  return runOnyx(cli.onyxUrl, fixturePath);
}

/**
 * LaunchStack path: POST the file to an internal debug/benchmark endpoint that
 * runs the full ingestion pipeline and returns the normalized document inline.
 * This endpoint is expected to be implemented separately (it should wrap the
 * existing processor.normalizeDocument + ingestion router). Kept as a simple
 * multipart POST so it can be swapped for a different transport easily.
 */
async function runLaunchstack(baseUrl: string, fixturePath: string): Promise<TargetOutput> {
  const buf = await readFile(fixturePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)]), basename(fixturePath));
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ocr/benchmark`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`launchstack ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    pages: { textBlocks: string[]; tables: { markdown: string }[] }[];
  };
  return flatten(data.pages);
}

/**
 * Onyx path: upload to the Onyx ingestion API and fetch the parsed document.
 * The default Onyx port is 8080 (backend). See
 * https://docs.onyx.app/developers/guides/index_files_ingestion_api
 */
async function runOnyx(baseUrl: string, fixturePath: string): Promise<TargetOutput> {
  const buf = await readFile(fixturePath);
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buf)]), basename(fixturePath));
  const ingestRes = await fetch(`${baseUrl.replace(/\/$/, "")}/manage/admin/connector/file/upload`, {
    method: "POST",
    body: form,
  });
  if (!ingestRes.ok) throw new Error(`onyx upload ${ingestRes.status}: ${await ingestRes.text()}`);
  const { file_paths } = (await ingestRes.json()) as { file_paths: string[] };
  if (!file_paths?.length) throw new Error("onyx returned no file_paths");

  // Onyx doesn't expose extracted text directly — we poll its document API by
  // the filename-derived doc id. If this shape changes, adjust here.
  const docId = encodeURIComponent(file_paths[0]!);
  await waitFor(async () => {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/document/${docId}`);
    return r.ok;
  });
  const docRes = await fetch(`${baseUrl.replace(/\/$/, "")}/document/${docId}`);
  const doc = (await docRes.json()) as { chunks?: { content: string }[]; content?: string };
  const text = doc.chunks?.map((c) => c.content).join("\n\n") ?? doc.content ?? "";
  return { text, tables: extractTablesFromMd(text) };
}

async function waitFor(fn: () => Promise<boolean>, attempts = 30, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("waitFor timed out");
}

function flatten(pages: { textBlocks: string[]; tables: { markdown: string }[] }[]): TargetOutput {
  const text = pages.flatMap((p) => p.textBlocks).join("\n\n");
  const tables = pages.flatMap((p) => p.tables.map((t) => t.markdown));
  return { text, tables };
}

function extractTablesFromMd(md: string): string[] {
  const tables: string[] = [];
  const lines = md.split("\n");
  let block: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      block.push(line);
    } else if (block.length > 0) {
      tables.push(block.join("\n"));
      block = [];
    }
  }
  if (block.length > 0) tables.push(block.join("\n"));
  return tables;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
