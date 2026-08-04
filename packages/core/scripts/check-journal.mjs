#!/usr/bin/env node
/**
 * Journal integrity check. Runs in CI with no database and no secrets, so it
 * is safe on fork PRs.
 *
 * `drizzle-kit check` validates the snapshot chain; this validates the things
 * it does not: that the journal, the snapshots and the .sql files on disk are
 * a consistent set, and that a botched merge of _journal.json is caught here
 * rather than as a silently skipped migration in production.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "drizzle");
const META = join(DIR, "meta");

const problems = [];
const fail = (m) => problems.push(m);

const journal = JSON.parse(await readFile(join(META, "_journal.json"), "utf8"));
const entries = [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);

if (entries.length === 0) fail("journal contains no entries");

entries.forEach((e, i) => {
  if (e.idx !== i) fail(`idx not contiguous: expected ${i}, found ${e.idx} (${e.tag})`);
  if (i > 0 && e.when <= entries[i - 1].when) {
    fail(`timestamps not strictly increasing: ${e.tag} is not after ${entries[i - 1].tag}`);
  }
  if (e.dialect && journal.dialect && e.dialect !== journal.dialect) {
    fail(`${e.tag}: dialect ${e.dialect} != journal dialect ${journal.dialect}`);
  }
});

const dupes = entries.map((e) => e.tag).filter((t, i, a) => a.indexOf(t) !== i);
if (dupes.length) fail(`duplicate tags in journal: ${[...new Set(dupes)].join(", ")}`);

const sqlOnDisk = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4));
const tagged = new Set(entries.map((e) => e.tag));

for (const tag of tagged) {
  if (!sqlOnDisk.includes(tag)) fail(`journal lists ${tag} but ${tag}.sql is missing`);
}
for (const f of sqlOnDisk) {
  if (!tagged.has(f)) {
    fail(`${f}.sql exists but is not in the journal — it will never be applied`);
  }
}

const snapshots = (await readdir(META)).filter((f) => f.endsWith("_snapshot.json"));
if (snapshots.length !== entries.length) {
  fail(`${entries.length} journal entries but ${snapshots.length} snapshots`);
}

// A migration may only be edited before it is applied anywhere. We cannot see
// databases from here, but we can catch the most common local mistake: a .sql
// file with no trailing newline / empty body.
for (const tag of tagged) {
  const body = await readFile(join(DIR, `${tag}.sql`), "utf8");
  if (body.trim().length === 0) fail(`${tag}.sql is empty`);
}

if (problems.length > 0) {
  console.error("[check-journal] migration directory is inconsistent:\n");
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error(
    "\nNever hand-merge _journal.json. Delete your .sql and its snapshot, take\n" +
      "main's journal, then re-run `pnpm --filter @launchstack/core db:generate`.",
  );
  process.exit(1);
}

console.log(`[check-journal] ok — ${entries.length} migration(s), journal and disk agree`);
