#!/usr/bin/env tsx
/**
 * Runs a REAL meeting against a REAL model, then scores it.
 *
 *   pnpm --filter @launchstack/web meeting:live
 *   pnpm --filter @launchstack/web meeting:live -- --route=fast --turns=8
 *   pnpm --filter @launchstack/web meeting:live -- --ground --json
 *
 * This is the gap the rest of the suite cannot close. `evals:meetings` scores
 * *orchestration* with scripted utterances, which is what makes it
 * deterministic and free — but it means the preset prompts have never been
 * observed steering an actual model. A prompt that reads well and produces six
 * agreeable paraphrases passes every existing test.
 *
 * So: no Postgres (the channel is in-memory), no Clerk, no HTTP. Just the
 * roster, the orchestrator, and the deployment's configured chat models.
 *
 * Exits non-zero when the meeting misses the evaluation thresholds, so this can
 * gate a prompt change rather than merely illustrate one.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./meeting-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Options {
  packId: string;
  route: string | null;
  turns: number;
  ground: boolean;
  json: boolean;
  envFile: string | null;
  policy: "round_robin" | "moderated" | "reactive" | null;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`));
    return hit ? hit.slice(flag.length + 3) : null;
  };
  const turns = Number(value("turns"));

  const rawPolicy = value("policy");
  const POLICIES = ["round_robin", "moderated", "reactive"] as const;
  if (rawPolicy !== null && !(POLICIES as readonly string[]).includes(rawPolicy)) {
    console.error(`--policy must be one of ${POLICIES.join(", ")} (got "${rawPolicy}")`);
    process.exit(2);
  }

  return {
    packId: value("pack") ?? "startup-core",
    route: value("route"),
    turns: Number.isFinite(turns) && turns > 0 ? turns : 12,
    ground: argv.includes("--ground"),
    json: argv.includes("--json"),
    envFile: value("env-file"),
    policy: (rawPolicy as Options["policy"]) ?? null,
  };
}

/**
 * Loads the environment *before* anything that reads it is imported.
 *
 * Every module on the chat path pulls `~/env`, which validates at import time —
 * so a static import of the model layer would evaluate the schema against an
 * empty environment and fail before this ever ran. Hence the dynamic imports
 * further down; the ordering is load-bearing, not stylistic.
 */
async function loadEnvironment(explicit: string | null): Promise<string | null> {
  const candidates = explicit
    ? [resolve(explicit)]
    : [
        // apps/web/.env, then the repo root — a worktree often has neither,
        // in which case --env-file points at the checkout that does.
        join(HERE, "..", ".env"),
        join(HERE, "..", "..", "..", ".env"),
      ];

  const found = candidates.find((path) => existsSync(path));
  if (!found) return null;

  const dotenv = await import("dotenv");
  dotenv.config({ path: found, quiet: true });
  return found;
}

// ---------------------------------------------------------------------------
// Grounding fixture
// ---------------------------------------------------------------------------

/**
 * The corpus lives in `./meeting-fixtures` so this harness and the
 * single-agent comparison read from exactly the same evidence — otherwise a
 * difference between them could be a difference in what each was allowed to
 * see rather than in method.
 *
 * The point of `--ground` here is to exercise the retrieval *port* and see
 * whether the agents actually cite what they are handed — not to test the
 * ensemble retriever, which has its own tests and needs a database. Scoring is
 * plain token overlap: deterministic, and good enough to put the right passage
 * in front of the right persona.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
}

async function buildFixtureGrounding(passagesPerTurn = 3) {
  const { buildGroundingQuery, toExcerpt } = await import("@launchstack/core/collab");
  type Request = Parameters<typeof buildGroundingQuery>[0];

  return {
    retrieve: async (request: Request) => {
      const query = tokenize(buildGroundingQuery(request));
      const ranked = CORPUS.map((entry) => {
        const words = tokenize(entry.text);
        let hits = 0;
        for (const word of query) if (words.has(word)) hits++;
        return { entry, score: hits / Math.max(query.size, 1) };
      })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, passagesPerTurn);

      return {
        passages: ranked.map((r) => `${r.entry.label}: ${r.entry.text}`),
        sources: ranked.map((r) => ({
          label: r.entry.label,
          score: Math.round(r.score * 1000) / 1000,
          excerpt: toExcerpt(r.entry.text),
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const BAR_WIDTH = 18;

function bar(score: number): string {
  const filled = Math.round(score * BAR_WIDTH);
  return `${"█".repeat(filled)}${"·".repeat(BAR_WIDTH - filled)}`;
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join("\n");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const envPath = await loadEnvironment(options.envFile);

  // Everything below is imported dynamically so the environment above is in
  // place first. See loadEnvironment().
  const [{ PERSONA_PACKS }, collab, models] = await Promise.all([
    import("~/server/collab/presets"),
    import("@launchstack/core/collab"),
    import("~/lib/models"),
  ]);

  const pack = PERSONA_PACKS.find((p) => p.id === options.packId);
  if (!pack) {
    console.error(
      `Unknown pack "${options.packId}". Available: ${PERSONA_PACKS.map((p) => p.id).join(", ")}`,
    );
    process.exit(2);
  }

  // Resolve the endpoint before spending anything, and downgrade any persona
  // route this deployment does not serve rather than dying on turn one.
  //
  // `routes` always carries all four keys — `reasoning` and `vision` can come
  // back `{ available: false }` when no model is assigned and the default
  // declares no such capability. Key presence proves nothing; read the flag.
  let available: Set<string>;
  try {
    const publicConfig = models.getConfiguredPublicChatConfig();
    available = new Set(
      Object.entries(publicConfig.routes)
        .filter(([, info]) => info.available)
        .map(([route]) => route),
    );
  } catch (err) {
    console.error(
      `Could not resolve the chat configuration: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      envPath
        ? `Environment loaded from ${envPath}. Check CHAT_API_KEY / CHAT_BASE_URL.`
        : "No .env file was found. Pass --env-file=/path/to/.env.",
    );
    process.exit(2);
  }

  const downgraded: string[] = [];
  const participants = pack.personas.map((persona) => {
    const wanted = options.route ?? persona.route ?? "default";
    const route = available.has(wanted) ? wanted : "default";
    if (route !== wanted) downgraded.push(`@${persona.key} ${wanted}→default`);
    return {
      id: persona.key,
      displayName: persona.displayName,
      role: persona.role,
      systemPrompt: persona.systemPrompt,
      route,
      temperature: persona.temperature ?? undefined,
      maxTurnChars: persona.maxTurnChars ?? undefined,
      accent: persona.accent ?? undefined,
    };
  });

  const store = new collab.InMemoryChannelStore();
  const runtime = new collab.LlmAgentRuntime(
    // Generous on purpose: the reasoning route spends this budget on thinking
    // tokens before it emits any text, so a tight cap truncates the visible
    // turn mid-sentence. Per-persona `maxTurnChars` is what actually keeps
    // turns short, and it trims after the fact.
    (await import("~/server/collab/chat")).createCollabChatFn({ maxOutputTokens: 2400 }),
    { nodeId: "local" },
  );

  const policy = options.policy ?? pack.suggested.turnPolicy;
  const { orchestrator, config } = await collab.createMeeting({
    store,
    workspaceId: "live-harness",
    title: "Retention dashboard — build or defer",
    objective:
      "Decide whether to build the customer-facing retention dashboard this quarter, and name who owns the next step",
    agenda: [
      "Is churn actually the problem the data describes?",
      "What would v1 have to include, and what is explicitly cut?",
      "What does it cost in engineering weeks, and what does it displace?",
      "Does it unblock revenue this quarter?",
    ],
    participants,
    runtimes: [runtime],
    turnPolicy: { kind: policy, moderatorId: pack.suggested.moderatorKey },
    maxTurns: options.turns,
    groundingProvider: options.ground ? await buildFixtureGrounding() : undefined,
  });

  if (!options.json) {
    console.log(`\n  ${pack.name} · ${policy} · up to ${options.turns} turns`);
    console.log(`  ${participants.map((p) => `@${p.id}(${p.route})`).join("  ")}`);
    console.log(`  grounding: ${options.ground ? `${CORPUS.length} fixture passages` : "off"}`);
    console.log(`  env: ${envPath ?? "process environment only"}`);
    if (downgraded.length > 0) {
      // Said out loud: a reasoning persona quietly served by the flash model is
      // a different experiment from the one the preset describes.
      console.log(`  routes unavailable — ${downgraded.join(", ")}`);
    }
    console.log();
    console.log("  " + "─".repeat(72) + "\n");
  }

  const startedAt = Date.now();
  await orchestrator.run({
    limit: options.turns,
    onStep: (result) => {
      if (options.json || !result.message) return;
      const { message } = result;
      const grounding = Array.isArray(message.meta?.grounding)
        ? (message.meta.grounding as Array<{ label?: string }>)
        : null;

      console.log(`  @${message.author.id}`);
      console.log(`  ${wrap(message.text, 70, "  ")}`);
      if (grounding && grounding.length > 0) {
        console.log(`  ↳ read: ${grounding.map((g) => g.label).join(" · ")}`);
      }
      console.log();
    },
  });

  const elapsedMs = Date.now() - startedAt;
  const transcript = await store.read(config.channelId);
  const state = orchestrator.getState();
  const minutes = collab.buildMinutes(config, state, transcript);
  const evaluation = collab.evaluateMeeting(config, state, transcript);

  if (options.json) {
    console.log(
      JSON.stringify(
        { pack: pack.id, policy, route: options.route, grounded: options.ground, elapsedMs, state, minutes, evaluation },
        null,
        2,
      ),
    );
  } else {
    console.log("  " + "─".repeat(72));
    console.log(`\n  Ended ${state.status} after ${state.turnIndex} turns (${Math.round(elapsedMs / 1000)}s)\n`);

    console.log("  Decisions");
    if (minutes.decisions.length === 0) console.log("    (none recorded)");
    for (const d of minutes.decisions) console.log(`    · ${wrap(d.text, 66, "      ")}  [seq ${d.sourceSeq}]`);

    console.log("\n  Action items");
    if (minutes.actionItems.length === 0) console.log("    (none recorded)");
    for (const a of minutes.actionItems) {
      console.log(`    · ${wrap(a.text, 62, "      ")}${a.owner ? `  → @${a.owner}` : "  → unowned"}`);
    }

    console.log("\n  Scores");
    for (const dimension of evaluation.dimensions) {
      const flag = dimension.weight === 0 ? " (abstained)" : "";
      console.log(
        `    ${dimension.id.padEnd(15)} ${bar(dimension.score)} ${dimension.score.toFixed(2)}  ${dimension.detail}${flag}`,
      );
    }
    console.log(
      `\n  overall ${evaluation.overall.toFixed(3)} — ${evaluation.passed ? "PASS" : "FAIL"}${
        evaluation.failures.length > 0 ? ` (floors missed: ${evaluation.failures.join(", ")})` : ""
      }\n`,
    );
  }

  if (!evaluation.passed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`[live-meeting] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
