#!/usr/bin/env tsx
/**
 * Head-to-head: one agent versus a room, on identical evidence.
 *
 *   pnpm --filter @launchstack/web meeting:compare -- --env-file=/path/.env
 *   pnpm --filter @launchstack/web meeting:compare -- --repeats=3 --json
 *
 * The question this answers is "when is a meeting actually worth it", and the
 * only way to answer it honestly is to give the single agent every advantage:
 *
 * - **It gets the whole corpus up front.** The meeting retrieves a few
 *   passages per turn; the single agent is handed all of them, which is what
 *   you would really do in a chat. It has strictly more information.
 * - **It gets the same output instructions.** Both sides are told to write
 *   `Decision:` and `Next step:` lines, so the decision metric measures
 *   whether a decision was reached — not who was told how to phrase one.
 * - **It is prompted to do the thing a room does.** It is explicitly asked to
 *   weigh product, engineering, design, growth and data angles.
 *
 * And the scenario set contains a case the room is expected to LOSE. A
 * comparison containing only questions the tool is good at is marketing.
 *
 * Metrics are computed identically over both outputs, by the same code:
 * numeric claims traceable to the corpus, how many distinct source passages
 * were demonstrably drawn on, and whether a decision with an owner came out —
 * the last via the product's own deterministic minutes extractor.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORPUS,
  SCENARIOS,
  reportEvidence,
  type Scenario,
} from "./meeting-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Options {
  repeats: number;
  turns: number;
  route: string | null;
  json: boolean;
  envFile: string | null;
  only: string | null;
  /** Print each side's raw output — the only way to check the baseline is fair. */
  dump: boolean;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`));
    return hit ? hit.slice(flag.length + 3) : null;
  };
  const repeats = Number(value("repeats"));
  const turns = Number(value("turns"));

  return {
    repeats: Number.isFinite(repeats) && repeats > 0 ? repeats : 2,
    turns: Number.isFinite(turns) && turns > 0 ? turns : 12,
    route: value("route"),
    json: argv.includes("--json"),
    envFile: value("env-file"),
    only: value("only"),
    dump: argv.includes("--dump"),
  };
}

async function loadEnvironment(explicit: string | null): Promise<string | null> {
  const candidates = explicit
    ? [resolve(explicit)]
    : [join(HERE, "..", ".env"), join(HERE, "..", "..", "..", ".env")];
  const found = candidates.find((path) => existsSync(path));
  if (!found) return null;
  const dotenv = await import("dotenv");
  dotenv.config({ path: found, quiet: true });
  return found;
}

// ---------------------------------------------------------------------------

interface RunResult {
  scenarioId: string;
  condition: "single" | "meeting";
  repeat: number;
  elapsedMs: number;
  turns: number;
  outputChars: number;
  figuresUsed: number;
  traceable: number;
  untraceable: number;
  passagesUsed: number;
  decisions: number;
  ownedActionItems: number;
}

/** Both sides are judged on the same text-shaped thing: everything that was said. */
function summarise(
  scenario: Scenario,
  condition: RunResult["condition"],
  repeat: number,
  text: string,
  elapsedMs: number,
  turns: number,
  decisions: number,
  ownedActionItems: number,
): RunResult {
  const evidence = reportEvidence(text, CORPUS);
  return {
    scenarioId: scenario.id,
    condition,
    repeat,
    elapsedMs,
    turns,
    outputChars: text.length,
    figuresUsed: evidence.figuresUsed,
    traceable: evidence.traceable,
    untraceable: evidence.untraceable.length,
    passagesUsed: evidence.passagesUsed.length,
    decisions,
    ownedActionItems,
  };
}

const SHARED_OUTPUT_RULES = [
  "End with a line starting with exactly `Decision:` followed by one sentence stating what will happen.",
  "Then a line starting with exactly `Next step:` naming the owner and a date.",
].join("\n");

async function runSingle(
  scenario: Scenario,
  repeat: number,
  options: Options,
): Promise<RunResult> {
  const { createCollabChatFn } = await import("~/server/collab/chat");
  const collab = await import("@launchstack/core/collab");
  // Far higher than the meeting's per-turn cap, and deliberately so. The room
  // gets 12 turns of 2400; the single agent gets one shot and must fit the
  // whole analysis in it. An equal per-call cap is not a fair fight — it
  // truncated the baseline mid-sentence and silently flattered the room.
  // Total budget still favours the meeting by a wide margin; that asymmetry is
  // inherent to the method and is reported as cost rather than equalised away.
  const chat = createCollabChatFn({ maxOutputTokens: 12000 });

  const system = [
    "You are an experienced startup operator advising a founder. You are the only adviser in the room.",
    "",
    "Weigh every angle that bears on the decision: the user problem and scope, engineering feasibility and cost, design and usability, growth and revenue, and whether the data actually supports the premise.",
    "Name the tradeoffs explicitly, including the strongest case against your own recommendation.",
    "",
    "## Evidence",
    "These passages are the only known-good material. Do not invent figures beyond them; say plainly when something is unknown.",
    ...CORPUS.map((p, i) => `[${i + 1}] ${p.label}: ${p.text}`),
    "",
    "## Objective",
    scenario.objective,
    ...(scenario.agenda.length > 0
      ? ["", "Work through each of these:", ...scenario.agenda.map((a, i) => `${i + 1}. ${a}`)]
      : []),
    "",
    "## Output",
    SHARED_OUTPUT_RULES,
  ].join("\n");

  const started = Date.now();
  const text = await chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: "Give me your recommendation." },
    ],
    route: options.route ?? "reasoning",
  });
  const elapsedMs = Date.now() - started;

  if (options.dump) {
    process.stderr.write(`\n----- SINGLE / ${scenario.id} / run ${repeat} (${text.length} chars)\n${text}\n-----\n`);
  }

  // Judge the single answer with the product's own extractor, by wrapping it
  // as a one-message channel. Identical code path to the meeting's minutes.
  const minutes = collab.buildMinutes(
    {
      id: "single",
      channelId: "c",
      workspaceId: "w",
      title: scenario.title,
      objective: scenario.objective,
      agenda: scenario.agenda,
      participants: [
        { id: "adviser", displayName: "Adviser", role: "Operator", systemPrompt: "" },
      ],
      turnPolicy: { kind: "round_robin" },
      maxTurns: 1,
    },
    { meetingId: "single", status: "completed", turnIndex: 1, nextSpeakerId: null },
    [
      {
        id: "m1",
        channelId: "c",
        seq: 1,
        ts: new Date(0).toISOString(),
        author: { kind: "agent", id: "adviser", displayName: "Adviser" },
        text,
        kind: "chat",
      },
    ],
  );

  return summarise(
    scenario,
    "single",
    repeat,
    text,
    elapsedMs,
    1,
    minutes.decisions.length,
    minutes.actionItems.filter((a) => a.owner).length,
  );
}

async function runMeeting(
  scenario: Scenario,
  repeat: number,
  options: Options,
): Promise<RunResult> {
  const [{ PERSONA_PACKS }, collab, { createCollabChatFn }] = await Promise.all([
    import("~/server/collab/presets"),
    import("@launchstack/core/collab"),
    import("~/server/collab/chat"),
  ]);

  const pack = PERSONA_PACKS.find((p) => p.id === "startup-core")!;
  const participants = pack.personas.map((persona) => ({
    id: persona.key,
    displayName: persona.displayName,
    role: persona.role,
    systemPrompt: persona.systemPrompt,
    route: options.route ?? persona.route ?? "default",
    temperature: persona.temperature ?? undefined,
    maxTurnChars: persona.maxTurnChars ?? undefined,
  }));

  const store = new collab.InMemoryChannelStore();
  const { buildGroundingQuery, toExcerpt } = collab;

  const tokenize = (t: string) =>
    new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

  const { orchestrator, config } = await collab.createMeeting({
    store,
    workspaceId: "compare",
    title: scenario.title,
    objective: scenario.objective,
    agenda: scenario.agenda,
    participants,
    runtimes: [
      new collab.LlmAgentRuntime(createCollabChatFn({ maxOutputTokens: 2400 }), {
        nodeId: "local",
      }),
    ],
    turnPolicy: { kind: pack.suggested.turnPolicy, moderatorId: pack.suggested.moderatorKey },
    maxTurns: options.turns,
    groundingProvider: {
      retrieve: async (request) => {
        const query = tokenize(buildGroundingQuery(request));
        const ranked = CORPUS.map((entry) => {
          const words = tokenize(entry.text);
          let hits = 0;
          for (const word of query) if (words.has(word)) hits++;
          return { entry, score: hits / Math.max(query.size, 1) };
        })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        return {
          passages: ranked.map((r) => `${r.entry.label}: ${r.entry.text}`),
          sources: ranked.map((r) => ({ label: r.entry.label, excerpt: toExcerpt(r.entry.text) })),
        };
      },
    },
  });

  const started = Date.now();
  await orchestrator.run({ limit: options.turns });
  const elapsedMs = Date.now() - started;

  const transcript = await store.read(config.channelId);
  const state = orchestrator.getState();
  const minutes = collab.buildMinutes(config, state, transcript);
  const said = transcript
    .filter((m) => m.kind === "chat")
    .map((m) => m.text)
    .join("\n\n");

  return summarise(
    scenario,
    "meeting",
    repeat,
    said,
    elapsedMs,
    state.turnIndex,
    minutes.decisions.length,
    minutes.actionItems.filter((a) => a.owner).length,
  );
}

// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function aggregate(results: RunResult[], scenarioId: string, condition: RunResult["condition"]) {
  const rows = results.filter((r) => r.scenarioId === scenarioId && r.condition === condition);
  return {
    runs: rows.length,
    passagesUsed: mean(rows.map((r) => r.passagesUsed)),
    traceable: mean(rows.map((r) => r.traceable)),
    untraceable: mean(rows.map((r) => r.untraceable)),
    decisions: mean(rows.map((r) => r.decisions)),
    ownedActionItems: mean(rows.map((r) => r.ownedActionItems)),
    elapsedMs: mean(rows.map((r) => r.elapsedMs)),
    outputChars: mean(rows.map((r) => r.outputChars)),
    turns: mean(rows.map((r) => r.turns)),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvironment(options.envFile);

  const scenarios = options.only
    ? SCENARIOS.filter((s) => s.id === options.only)
    : SCENARIOS;

  const results: RunResult[] = [];
  const failures: Array<{
    scenarioId: string;
    condition: string;
    repeat: number;
    error: string;
  }> = [];

  for (const scenario of scenarios) {
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      for (const condition of ["single", "meeting"] as const) {
        if (!options.json) {
          process.stderr.write(`  ${scenario.id} · ${condition} · run ${repeat}\n`);
        }
        try {
          const result =
            condition === "single"
              ? await runSingle(scenario, repeat, options)
              : await runMeeting(scenario, repeat, options);
          results.push(result);
        } catch (err) {
          // Recorded, not just logged. A dropped run silently shrinks a cell's
          // sample size, and an average over one run reads identically to an
          // average over five unless the report says otherwise.
          failures.push({
            scenarioId: scenario.id,
            condition,
            repeat,
            error: err instanceof Error ? err.message : String(err),
          });
          process.stderr.write(
            `  ! ${scenario.id}/${condition}/${repeat} failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    }
  }

  const report = scenarios.map((scenario) => ({
    scenario: {
      id: scenario.id,
      title: scenario.title,
      hypothesis: scenario.hypothesis,
      expectMeetingWins: scenario.expectMeetingWins,
    },
    single: aggregate(results, scenario.id, "single"),
    meeting: aggregate(results, scenario.id, "meeting"),
  }));

  if (options.json) {
    console.log(JSON.stringify({ repeats: options.repeats, failures, results, report }, null, 2));
    return;
  }

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} run(s) failed — cells below are averaged over fewer samples:`);
    for (const f of failures) {
      console.log(`    ${f.scenarioId}/${f.condition}/${f.repeat}: ${f.error}`);
    }
  }

  for (const entry of report) {
    console.log(`\n  ${entry.scenario.title}  [${entry.scenario.id}]`);
    console.log(`  n: single ${entry.single.runs}, meeting ${entry.meeting.runs}`);
    console.log(`  expectation: ${entry.scenario.expectMeetingWins ? "room wins" : "room should NOT win"}`);
    console.log(
      `    ${"".padEnd(22)}${"single".padStart(9)}${"meeting".padStart(10)}`,
    );
    const row = (label: string, a: number, b: number, digits = 1) =>
      console.log(
        `    ${label.padEnd(22)}${a.toFixed(digits).padStart(9)}${b.toFixed(digits).padStart(10)}`,
      );
    row("source passages used", entry.single.passagesUsed, entry.meeting.passagesUsed);
    row("traceable figures", entry.single.traceable, entry.meeting.traceable);
    row("untraceable figures", entry.single.untraceable, entry.meeting.untraceable);
    row("decisions recorded", entry.single.decisions, entry.meeting.decisions);
    row("owned action items", entry.single.ownedActionItems, entry.meeting.ownedActionItems);
    row("seconds", entry.single.elapsedMs / 1000, entry.meeting.elapsedMs / 1000);
    row("output chars", entry.single.outputChars, entry.meeting.outputChars, 0);
  }
  console.log();
}

main().catch((err: unknown) => {
  console.error(`[compare] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
