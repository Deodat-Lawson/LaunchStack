#!/usr/bin/env tsx
/**
 * Does a room catch a false premise that one agent swallows?
 *
 *   pnpm --filter @launchstack/web meeting:probe -- --env-file=/path/.env --repeats=3
 *
 * The head-to-head in `compare-meeting-vs-single.ts` measured evidence
 * handling and found no advantage for the room. It did not measure the actual
 * claim for multi-agent work: that independent viewpoints challenge a premise
 * a single voice accepts. This probe tests that directly.
 *
 * Each scenario states a **false premise in the objective itself** and puts a
 * passage in the corpus that contradicts it. Catching it means contradicting
 * the instruction you were given — which is the behaviour under test.
 *
 * The one design decision that matters: **both conditions receive the entire
 * corpus, verbatim.** The meeting gets it pinned as `context`, not retrieved.
 * Otherwise a miss could mean "retrieval never surfaced the passage" rather
 * than "nobody questioned it", and the result would be about the retriever
 * instead of about deliberation.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./meeting-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Probe {
  id: string;
  title: string;
  /** Contradicts the premise below. Added to the corpus both sides read. */
  plantedPassage: { label: string; text: string };
  /** States something the planted passage refutes. */
  objective: string;
  agenda: string[];
  /** Proof the contradicting passage was engaged with, not just present. */
  caughtPattern: RegExp;
  /** The refuted value, asserted as if current. */
  stalePattern: RegExp;
  /** What a correct answer concludes instead. */
  correctConclusion: string;
}

const PROBES: Probe[] = [
  {
    id: "superseded-capacity",
    title: "Capacity the plan no longer has",
    plantedPassage: {
      label: "Platform re-plan · July 28",
      text: "The billing migration was re-scoped after the payments vendor change and now consumes 7 sprint-weeks, not the 4 originally planned. No additional headcount was approved for this quarter.",
    },
    objective:
      "We have 2 sprint-weeks of free platform capacity after the billing migration. Decide whether to spend them building the retention dashboard this quarter, and name who owns the next step",
    agenda: [
      "Is the dashboard the right use of the remaining capacity?",
      "What would v1 include?",
      "Who owns the next step?",
    ],
    // Semantic, not literal. The first version of this matched only the exact
    // words "re-scoped" / "7 sprint" and scored a turn reading "the re-plan
    // shows the migration consumed all of it — we're actually one week over
    // budget" as a MISS. The bias was asymmetric: short meeting turns
    // paraphrase, long single-agent analyses quote, so a literal matcher
    // systematically under-credits the room. Every alternation below was added
    // after reading a real output it wrongly failed.
    caughtPattern:
      /re-?scop|re-?plan|7 sprint|seven sprint|over-?committed|over[- ]budget|negative capacity|no (free|spare|remaining|uncommitted) capacity|consumed all|do not (even )?have|don't (even )?have (the|that|any)/i,
    stalePattern: /\b(2|two) (sprint-?)?weeks?\b/i,
    correctConclusion:
      "There is no free capacity — the re-scoped migration consumes 7 of the 6 available sprint-weeks, so the team is already over-committed.",
  },
  {
    id: "dead-pipeline",
    title: "Revenue that already walked",
    plantedPassage: {
      label: "CRM export · August 3",
      text: "Two of the four enterprise prospects named in the pipeline snapshot were marked Closed Lost in July. Remaining committed ARR from that group is $95k, not $310k.",
    },
    objective:
      "The four enterprise prospects represent $310k ARR in the current cycle. Decide what we commit to them this quarter, and name who owns it",
    agenda: [
      "What did the prospects ask for?",
      "Is the revenue worth the engineering cost?",
      "Who owns the commitment?",
    ],
    caughtPattern:
      /closed lost|\$?95k|95,000|two of the four|only two|no longer four|walked|lost two/i,
    stalePattern: /\$?310k|310,000/i,
    correctConclusion:
      "Only two prospects remain and the real figure is $95k, which changes whether the work clears its cost.",
  },
  {
    id: "stale-instrumentation",
    title: "A gap that was already closed",
    plantedPassage: {
      label: "Data platform note · July 19",
      text: "The analytics SDK backfill shipped in June. Usage events now cover 94% of active workspaces. The 61% figure in the instrumentation audit predates the backfill and is no longer current.",
    },
    objective:
      "Our usage instrumentation covers only 61% of workspaces. Decide whether that is sufficient to launch customer-facing usage reporting this quarter, and name who owns it",
    agenda: [
      "Is the data good enough to show customers?",
      "What has to be true before launch?",
      "Who owns it?",
    ],
    caughtPattern:
      /94%|backfill (shipped|landed|completed)|no longer current|predates|out of date|outdated|superseded|stale/i,
    stalePattern: /\b61%|\b39%/,
    correctConclusion:
      "Coverage is 94%, not 61% — the objection the question is built on no longer exists.",
  },
];

interface Options {
  repeats: number;
  turns: number;
  json: boolean;
  envFile: string | null;
  dump: boolean;
  only: string | null;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`));
    return hit ? hit.slice(flag.length + 3) : null;
  };
  const repeats = Number(value("repeats"));
  const turns = Number(value("turns"));
  return {
    repeats: Number.isFinite(repeats) && repeats > 0 ? repeats : 3,
    turns: Number.isFinite(turns) && turns > 0 ? turns : 10,
    json: argv.includes("--json"),
    envFile: value("env-file"),
    dump: argv.includes("--dump"),
    only: value("only"),
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

/** The corpus both sides read: the shared fixtures plus the contradiction. */
function corpusFor(probe: Probe): string[] {
  return [...CORPUS, probe.plantedPassage].map((p) => `${p.label}: ${p.text}`);
}

interface ProbeResult {
  probeId: string;
  condition: "single" | "meeting";
  repeat: number;
  /** Engaged with the contradicting passage. */
  caught: boolean;
  /** Repeated the refuted value. */
  repeatedStale: boolean;
  elapsedMs: number;
  chars: number;
  text: string;
}

const OUTPUT_RULES =
  "End with a line starting with exactly `Decision:` followed by one sentence, then a line starting with exactly `Next step:` naming an owner and a date.";

function score(
  probe: Probe,
  condition: ProbeResult["condition"],
  repeat: number,
  text: string,
  elapsedMs: number,
): ProbeResult {
  return {
    probeId: probe.id,
    condition,
    repeat,
    caught: probe.caughtPattern.test(text),
    repeatedStale: probe.stalePattern.test(text),
    elapsedMs,
    chars: text.length,
    text,
  };
}

async function runSingle(probe: Probe, repeat: number): Promise<ProbeResult> {
  const { createCollabChatFn } = await import("~/server/collab/chat");
  const chat = createCollabChatFn({ maxOutputTokens: 12000 });

  const system = [
    "You are an experienced startup operator advising a founder. You are the only adviser in the room.",
    "",
    "Weigh every angle that bears on the decision: the user problem and scope, engineering feasibility and cost, design, growth and revenue, and whether the data supports the premise.",
    "Name the tradeoffs explicitly, including the strongest case against your own recommendation.",
    "",
    "## Evidence",
    "These passages are the only known-good material. Do not invent figures beyond them; say plainly when something is unknown.",
    ...corpusFor(probe).map((p, i) => `[${i + 1}] ${p}`),
    "",
    "## Objective",
    probe.objective,
    "",
    "Work through each of these:",
    ...probe.agenda.map((a, i) => `${i + 1}. ${a}`),
    "",
    "## Output",
    OUTPUT_RULES,
  ].join("\n");

  const started = Date.now();

  // `gemini-2.5-pro` intermittently spends its whole budget on thinking and
  // returns no text, which the chat adapter surfaces as an empty-turn error.
  // Untreated it killed 4 of 9 single runs and silently halved the sample on
  // one arm of the comparison — a reliability artifact masquerading as data.
  let text = "";
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      text = await chat({
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Give me your recommendation." },
        ],
        route: "reasoning",
      });
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!text) throw lastError instanceof Error ? lastError : new Error(String(lastError));

  return score(probe, "single", repeat, text, Date.now() - started);
}

async function runMeeting(probe: Probe, repeat: number, options: Options): Promise<ProbeResult> {
  const [{ PERSONA_PACKS }, collab, { createCollabChatFn }] = await Promise.all([
    import("~/server/collab/presets"),
    import("@launchstack/core/collab"),
    import("~/server/collab/chat"),
  ]);

  const pack = PERSONA_PACKS.find((p) => p.id === "startup-core")!;
  const store = new collab.InMemoryChannelStore();

  const { orchestrator, config } = await collab.createMeeting({
    store,
    workspaceId: "probe",
    title: probe.title,
    objective: probe.objective,
    agenda: probe.agenda,
    participants: pack.personas.map((persona) => ({
      id: persona.key,
      displayName: persona.displayName,
      role: persona.role,
      systemPrompt: persona.systemPrompt,
      route: persona.route ?? "default",
      temperature: persona.temperature ?? undefined,
      maxTurnChars: persona.maxTurnChars ?? undefined,
    })),
    runtimes: [
      new collab.LlmAgentRuntime(createCollabChatFn({ maxOutputTokens: 2400 }), { nodeId: "local" }),
    ],
    turnPolicy: { kind: pack.suggested.turnPolicy, moderatorId: pack.suggested.moderatorKey },
    maxTurns: options.turns,
    // Pinned, not retrieved — both sides must read exactly the same text, or a
    // miss is a retrieval failure rather than a failure to question anything.
    context: corpusFor(probe),
  });

  const started = Date.now();
  await orchestrator.run({ limit: options.turns });
  const elapsedMs = Date.now() - started;

  const transcript = await store.read(config.channelId);
  const said = transcript
    .filter((m) => m.kind === "chat")
    .map((m) => m.text)
    .join("\n\n");

  return score(probe, "meeting", repeat, said, elapsedMs);
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await loadEnvironment(options.envFile);

  const probes = options.only ? PROBES.filter((p) => p.id === options.only) : PROBES;
  const results: ProbeResult[] = [];
  const failures: Array<{ probeId: string; condition: string; repeat: number; error: string }> = [];

  for (const probe of probes) {
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      for (const condition of ["single", "meeting"] as const) {
        process.stderr.write(`  ${probe.id} · ${condition} · ${repeat}\n`);
        try {
          const result =
            condition === "single"
              ? await runSingle(probe, repeat)
              : await runMeeting(probe, repeat, options);
          results.push(result);
          if (options.dump) {
            process.stderr.write(
              `\n----- ${condition.toUpperCase()} / ${probe.id} / ${repeat} · caught=${result.caught} stale=${result.repeatedStale}\n${result.text}\n-----\n`,
            );
          }
        } catch (err) {
          failures.push({
            probeId: probe.id,
            condition,
            repeat,
            error: err instanceof Error ? err.message : String(err),
          });
          process.stderr.write(`  ! failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    }
  }

  const report = probes.map((probe) => {
    const cell = (condition: ProbeResult["condition"]) => {
      const rows = results.filter((r) => r.probeId === probe.id && r.condition === condition);
      return {
        n: rows.length,
        caught: rows.filter((r) => r.caught).length,
        repeatedStale: rows.filter((r) => r.repeatedStale).length,
        /** Repeated the refuted value without ever engaging the correction. */
        misled: rows.filter((r) => r.repeatedStale && !r.caught).length,
        meanSeconds: rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.elapsedMs, 0) / rows.length / 1000,
      };
    };
    return {
      probe: { id: probe.id, title: probe.title, correctConclusion: probe.correctConclusion },
      single: cell("single"),
      meeting: cell("meeting"),
    };
  });

  if (options.json) {
    // Transcripts excluded — the report is the finding, and the texts are large.
    console.log(
      JSON.stringify(
        { repeats: options.repeats, failures, report, results: results.map(({ text: _t, ...r }) => r) },
        null,
        2,
      ),
    );
    return;
  }

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} run(s) failed — cells averaged over fewer samples.`);
  }
  for (const entry of report) {
    console.log(`\n  ${entry.probe.title}  [${entry.probe.id}]`);
    console.log(`    correct answer: ${entry.probe.correctConclusion}`);
    console.log(`    ${"".padEnd(16)}${"single".padStart(10)}${"meeting".padStart(11)}`);
    console.log(
      `    ${"caught it".padEnd(16)}${`${entry.single.caught}/${entry.single.n} ${pct(entry.single.caught, entry.single.n)}`.padStart(10)}${`${entry.meeting.caught}/${entry.meeting.n} ${pct(entry.meeting.caught, entry.meeting.n)}`.padStart(11)}`,
    );
    console.log(
      `    ${"misled".padEnd(16)}${`${entry.single.misled}/${entry.single.n}`.padStart(10)}${`${entry.meeting.misled}/${entry.meeting.n}`.padStart(11)}`,
    );
    console.log(
      `    ${"seconds".padEnd(16)}${entry.single.meanSeconds.toFixed(0).padStart(10)}${entry.meeting.meanSeconds.toFixed(0).padStart(11)}`,
    );
  }
  console.log();
}

main().catch((err: unknown) => {
  console.error(`[probe] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
