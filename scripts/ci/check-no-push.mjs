#!/usr/bin/env node
/**
 * Fails if `drizzle-kit push` can reach a real database.
 *
 * push rewrites a live schema to match the current TypeScript, unreviewed and
 * unrecorded, and will DROP columns to do it. This repo previously ran push in
 * local dev, CI and Docker while Vercel production ran SQL migrations — two
 * strategies that produced provably different databases. This check keeps them
 * from diverging again.
 *
 * Rules:
 *   - Deploy surfaces (Dockerfiles, vercel.json, compose) may not mention it.
 *   - Workflows may use it only with LAUNCHSTACK_ALLOW_PUSH=1 nearby — the
 *     schema-parity job pushes into a throwaway empty database on purpose.
 *
 * Lives outside the scanned paths so it cannot match its own source.
 *
 *   node scripts/ci/check-no-push.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DEPLOY_SURFACES = [
  "apps/web/Dockerfile",
  "apps/web/Dockerfile.prebuilt",
  "apps/web/vercel.json",
  "apps/landing/vercel.json",
  "docker-compose.yml",
  "docker-compose.prebuilt.yml",
];
const WORKFLOW_DIR = ".github/workflows";

// `db:push:danger` is the deliberately-renamed local escape hatch; it routes
// through guard-push.mjs and is allowed to appear.
const PUSH = /drizzle-kit\s+push|db:push(?!:danger)/;
const isComment = (l) => /^\s*(#|\/\/|--)/.test(l);
// A YAML step title or an echo is prose, not an invocation.
const isProse = (l) => /^\s*-?\s*name:\s/.test(l) || /^\s*echo\s/.test(l);

const violations = [];

async function lines(path) {
  try {
    return (await readFile(path, "utf8")).split("\n");
  } catch {
    return null;
  }
}

for (const path of DEPLOY_SURFACES) {
  const ls = await lines(path);
  if (!ls) continue;
  ls.forEach((line, i) => {
    if (!isComment(line) && PUSH.test(line)) {
      violations.push(`${path}:${i + 1}: ${line.trim()}`);
    }
  });
}

let workflows = [];
try {
  workflows = (await readdir(WORKFLOW_DIR))
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => join(WORKFLOW_DIR, f));
} catch {
  /* no workflows */
}

for (const path of workflows) {
  const ls = await lines(path);
  if (!ls) continue;
  ls.forEach((line, i) => {
    if (isComment(line) || isProse(line) || !PUSH.test(line)) return;
    // The env var is typically on the preceding continuation line.
    const window = ls.slice(Math.max(0, i - 3), i + 1).join(" ");
    if (!window.includes("LAUNCHSTACK_ALLOW_PUSH")) {
      violations.push(`${path}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(
    "::error::drizzle-kit push must never run where it can reach a real database. Use db:migrate.",
  );
  violations.forEach((v) => console.error(`  ${v}`));
  process.exit(1);
}

console.log("[check-no-push] ok — no unguarded drizzle-kit push on any deploy path");
